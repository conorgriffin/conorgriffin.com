// Free licences given from the admin page or CLI.
import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyLicense } from "../crypto.js";
import { adminHandler } from "../handlers.js";
import { findLicenses, getLicense, issueFreeLicense, reissueLicense, resendLicenses, retryUnsentEmails } from "../licensing.js";
import { activationLink } from "../email.js";
import { makeCtx, vectors } from "./helpers.js";

const SECRET = "admin-secret-0123456789abcdef0123456789abcdef";
const licenseKeys = { T1: vectors.keys.license.publicKeyBase64 };

const call = (ctx, body) =>
  adminHandler(() => ctx, new Request("https://www.conorgriffin.com/api/tessera/admin", {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));

test("issueFreeLicense: free record, no Stripe, indexed, emailed with the free copy and without the note", async () => {
  const ctx = makeCtx();
  const r = await issueFreeLicense(ctx, { email: "  Sam@Example.com ", note: "Sam from work", by: "me@example.com" });
  assert.equal(r.ok, true);
  const rec = r.record;
  assert.equal(rec.free, true);
  assert.equal(rec.freeNote, "Sam from work");
  assert.equal(rec.freeBy, "me@example.com");
  assert.equal(rec.email, "Sam@Example.com");
  assert.equal(rec.sessionId, `free:${rec.lid}`);
  assert.equal(rec.paymentIntent, null);
  assert.ok(rec.emailedAt && rec.indexedAt);
  assert.equal(verifyLicense(rec.license, licenseKeys).ok, true);
  assert.equal(ctx.stripe.state.metadata.length, 0);
  assert.equal(ctx.stripe.state.calls.length, 0);
  assert.equal(ctx.store.strings.get(`session:free:${rec.lid}`), undefined);

  assert.equal(ctx.mailer.sent.length, 1);
  const m = ctx.mailer.sent[0];
  assert.equal(m.to, "Sam@Example.com");
  assert.equal(m.subject, "Your free Tessera Pro license");
  for (const body of [m.text, m.html]) {
    assert.ok(body.includes(rec.license));
    assert.ok(body.includes("on me. Enjoy!"));
    assert.ok(!body.includes("Sam from work"));
    assert.ok(!body.includes("—"));
  }
  assert.ok(m.text.includes(activationLink(rec.license)));
  assert.ok(m.html.includes(activationLink(rec.license).replace(/&/g, "&amp;")));

  assert.deepEqual((await findLicenses(ctx, { email: "sam@example.com" })).map((x) => x.lid), [rec.lid]);
  ctx.mailer.sent.length = 0;
  assert.equal(await resendLicenses(ctx, "sam@example.com", "ip"), "sent");
  assert.ok(ctx.mailer.sent[0].text.includes(rec.license));
});

test("issueFreeLicense: invalid email is rejected and nothing is stored or sent", async () => {
  const ctx = makeCtx();
  for (const email of ["", "nope", "a@b", undefined, 42, `${"a".repeat(250)}@b.co`]) {
    assert.deepEqual(await issueFreeLicense(ctx, { email, by: "cli" }), { ok: false, reason: "invalid_email" });
  }
  assert.equal(ctx.mailer.sent.length, 0);
  assert.equal([...ctx.store.strings.keys()].filter((k) => k.startsWith("lic:")).length, 0);
});

test("issueFreeLicense: note is trimmed, stripped of control characters and capped at 200", async () => {
  const ctx = makeCtx();
  const a = await issueFreeLicense(ctx, { email: "a@example.com", note: "  hi\u0000 there\n\u0007  ", by: "cli" });
  assert.equal(a.record.freeNote, "hi  there");
  const b = await issueFreeLicense(ctx, { email: "b@example.com", note: "x".repeat(500), by: "cli" });
  assert.equal(b.record.freeNote.length, 200);
  for (const note of [undefined, "", "   ", null]) {
    assert.equal((await issueFreeLicense(ctx, { email: "c@example.com", note, by: "cli" })).record.freeNote, null);
  }
});

test("a failed free email is left for the nightly retry, which uses the free email", async () => {
  const ctx = makeCtx();
  ctx.mailer.fail = true;
  const r = await issueFreeLicense(ctx, { email: "a@example.com", by: "cli" });
  assert.equal(r.record.emailedAt, null);
  ctx.mailer.fail = false;
  assert.equal(await retryUnsentEmails(ctx), 1);
  assert.equal(ctx.mailer.sent[0].subject, "Your free Tessera Pro license");
});

test("reissuing a free licence keeps the free fields, sends the reissue email and creates no session key", async () => {
  const ctx = makeCtx();
  const { record } = await issueFreeLicense(ctx, { email: "a@example.com", note: "Friend", by: "me@example.com" });
  ctx.mailer.sent.length = 0;
  const r = await reissueLicense(ctx, record.lid);
  assert.equal(r.result, "reissued");
  const next = await getLicense(ctx, r.newLid);
  assert.equal(next.free, true);
  assert.equal(next.freeNote, "Friend");
  assert.equal(next.freeBy, "me@example.com");
  assert.equal(next.reissuedFrom, record.lid);
  assert.equal(ctx.mailer.sent.length, 1);
  assert.equal(ctx.mailer.sent[0].subject, "Your new Tessera Pro license");
  assert.ok(![...ctx.store.strings.keys()].some((k) => k.startsWith("session:")));
  assert.equal(ctx.stripe.state.metadata.length, 0);
});

test("admin issue_free (bearer): issues, returns the key, logs no email, note or key", async () => {
  const ctx = makeCtx();
  ctx.env.TESSERA_ADMIN_SECRET = SECRET;
  const res = await call(ctx, { action: "issue_free", email: "Friend@Example.com", note: "Secret friend note" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.result, "issued");
  assert.equal(body.emailed, true);
  assert.match(body.lid, /^[0-9a-f]{32}$/);
  assert.equal(verifyLicense(body.license, licenseKeys).ok, true);
  const rec = await getLicense(ctx, body.lid);
  assert.equal(rec.freeBy, "cli");
  assert.equal(rec.freeNote, "Secret friend note");
  const logged = JSON.stringify(ctx.logs);
  for (const secret of ["Friend@Example.com", "friend@example.com", "Secret friend note", body.license]) assert.ok(!logged.includes(secret));
  assert.deepEqual(ctx.logs.find((l) => l.action === "issue_free"), { level: "info", msg: "admin action", action: "issue_free", lid: body.lid, via: "bearer" });

  const found = await (await call(ctx, { action: "lookup", target: "friend@example.com" })).json();
  assert.equal(found.licenses[0].free, true);
  assert.equal(found.licenses[0].freeNote, "Secret friend note");
  assert.ok(!("license" in found.licenses[0]));
});

test("admin issue_free: bad email and bad note → 400", async () => {
  const ctx = makeCtx();
  ctx.env.TESSERA_ADMIN_SECRET = SECRET;
  for (const email of [undefined, "", "nope", 5, null]) {
    const res = await call(ctx, { action: "issue_free", email });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "bad_email");
  }
  for (const note of [5, {}, "x".repeat(201)]) {
    const res = await call(ctx, { action: "issue_free", email: "a@example.com", note });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "bad_note");
  }
  assert.equal(ctx.mailer.sent.length, 0);
});

test("admin issue_free: the 21st in a day → 429", async () => {
  const ctx = makeCtx();
  ctx.env.TESSERA_ADMIN_SECRET = SECRET;
  for (let i = 0; i < 20; i++) assert.equal((await call(ctx, { action: "issue_free", email: `f${i}@example.com` })).status, 200);
  const res = await call(ctx, { action: "issue_free", email: "f21@example.com" });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, "too_many_free");
  assert.equal(ctx.mailer.sent.length, 20);
});
