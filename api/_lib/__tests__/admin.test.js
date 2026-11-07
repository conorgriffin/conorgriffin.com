import assert from "node:assert/strict";
import { test } from "node:test";
import { safeEqual, verifyLicense, verifyRevocationList } from "../crypto.js";
import { adminHandler, parseAdminTarget } from "../handlers.js";
import { buildRevocationList, getLicense, handleEvent, issueLicense, reconcile } from "../licensing.js";
import { event, makeCtx, makeSession, vectors } from "./helpers.js";

const SECRET = "admin-secret-0123456789abcdef0123456789abcdef";
const licenseKeys = { T1: vectors.keys.license.publicKeyBase64 };
const revocationKeys = { TR1: vectors.keys.revocation.publicKeyBase64 };
const revokedSet = (ctx) => [...(ctx.store.sets.get("revoked") ?? [])];
const seq = (ctx) => Number(ctx.store.strings.get("revocations:seq") ?? 0);

/** A context with the admin secret set and one issued licence. */
async function setup(over = {}) {
  const ctx = makeCtx();
  ctx.env.TESSERA_ADMIN_SECRET = SECRET;
  const session = makeSession(over);
  ctx.stripe.state.sessions.set(session.id, session);
  const issued = await issueLicense(ctx, session.id);
  ctx.mailer.sent.length = 0; // the purchase email isn't under test here
  ctx.stripe.state.metadata.length = 0;
  return { ctx, session, rec: issued.record };
}

const call = (ctx, body, { auth = `Bearer ${SECRET}`, method = "POST", raw } = {}) =>
  adminHandler(() => ctx, new Request("https://www.conorgriffin.com/api/tessera/admin", {
    method,
    headers: { ...(auth === null ? {} : { authorization: auth }), "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: raw ?? JSON.stringify(body) }),
  }));

// ------------------------------------------------------------------ auth

test("admin: no TESSERA_ADMIN_SECRET (unset or empty) → 404 for everything, even with a header and any method", async () => {
  const { ctx, rec } = await setup();
  for (const value of [undefined, ""]) {
    ctx.env.TESSERA_ADMIN_SECRET = value;
    for (const auth of [`Bearer ${SECRET}`, "Bearer ", "Bearer", null]) {
      const res = await call(ctx, { action: "lookup", target: rec.lid }, { auth });
      assert.equal(res.status, 404);
      assert.equal(res.headers.get("cache-control"), "no-store");
    }
    assert.equal((await call(ctx, null, { method: "GET" })).status, 404);
  }
});

test("admin: wrong or missing credentials → 401; right → 200; always no-store", async () => {
  const { ctx, rec } = await setup();
  const body = { action: "lookup", target: rec.lid };
  for (const auth of [null, "", SECRET, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, `Bearer ${SECRET.slice(0, -1)}!`, `bearer ${SECRET}`, "Bearer wrong", `Bearer  ${SECRET}`]) {
    const res = await call(ctx, body, { auth });
    assert.equal(res.status, 401, `auth ${JSON.stringify(auth)}`);
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  const ok = await call(ctx, body);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
});

test("admin: the secret is compared with the constant-time helper (hashes first, so lengths never throw)", async () => {
  assert.equal(safeEqual("a", "a"), true);
  assert.equal(safeEqual("a", "ab"), false);
  assert.equal(safeEqual("", "Bearer x"), false);
  // A candidate of any length reaches the comparison without throwing a RangeError.
  const { ctx } = await setup();
  for (const n of [0, 1, 5, 500, 100000]) {
    const res = await call(ctx, { action: "lookup", target: "x" }, { auth: `Bearer ${"a".repeat(n)}` });
    assert.equal(res.status, 401);
  }
  const src = (await import("node:fs")).readFileSync(new URL("../handlers.js", import.meta.url), "utf8");
  const adminSrc = src.slice(src.indexOf("export async function adminHandler"));
  assert.match(adminSrc, /safeEqual\(request\.headers\.get\("authorization"\)/);
  assert.doesNotMatch(adminSrc.slice(0, adminSrc.indexOf("method_not_allowed")), /authorization"\)[^)]*(===|!==)/);
});

test("admin: an authenticated non-POST is 405; auth is checked before the body is read", async () => {
  const { ctx } = await setup();
  assert.equal((await call(ctx, null, { method: "GET" })).status, 405);
  assert.equal((await call(ctx, null, { method: "GET", auth: "Bearer no" })).status, 401);
  assert.equal((await call(ctx, null, { raw: "{not json", auth: "Bearer no" })).status, 401);
});

// ------------------------------------------------------------------ request parsing

test("parseAdminTarget: lid, license key with whitespace, email, junk", async () => {
  const { rec } = await setup();
  assert.deepEqual(parseAdminTarget(rec.lid), { lid: rec.lid });
  assert.deepEqual(parseAdminTarget(`  ${rec.lid}\n`), { lid: rec.lid });
  assert.deepEqual(parseAdminTarget(rec.license), { lid: rec.lid });
  const wrapped = rec.license.replace(/(.{40})/g, "$1\r\n  ");
  assert.ok(/\s/.test(wrapped));
  assert.deepEqual(parseAdminTarget(`\n ${wrapped}\n`), { lid: rec.lid });
  assert.deepEqual(parseAdminTarget(" Buyer@Example.com "), { email: "buyer@example.com" });
  // No signature check: a key with a mangled signature still yields the lid.
  assert.deepEqual(parseAdminTarget(rec.license.replace(/\.[^.]+$/, ".AAAA")), { lid: rec.lid });
  for (const junk of [
    "", "   ", "hello", 42, null, undefined, {}, "TSR1-", "TSR1-!!!.sig", "TSR1-e30.sig", // payload without a lid
    "0123456789ABCDEF0123456789ABCDEF", "0123456789abcdef0123456789abcde", "0123456789abcdef0123456789abcdef0",
    "a@b", "a b@c.de", "x".repeat(5000),
  ]) assert.equal(parseAdminTarget(junk), null, `junk ${String(junk).slice(0, 20)}`);
  const badLid = `TSR1-${Buffer.from(JSON.stringify({ lid: "../etc" })).toString("base64url")}.x`;
  assert.equal(parseAdminTarget(badLid), null);
});

test("admin: bad json, action, target, reason and email-for-mutation are 400", async () => {
  const { ctx, rec } = await setup();
  const status = async (body, opts) => (await call(ctx, body, opts)).status;
  assert.equal(await status(null, { raw: "{nope" }), 400);
  assert.equal(await status(null, { raw: "null" }), 400);
  assert.equal(await status(null, { raw: "x".repeat(9000) }), 400);
  assert.equal(await status({ target: rec.lid }), 400);
  assert.equal(await status({ action: "delete", target: rec.lid }), 400);
  assert.equal(await status({ action: "lookup" }), 400);
  assert.equal(await status({ action: "lookup", target: "junk" }), 400);
  assert.equal(await status({ action: "revoke", target: rec.lid, reason: "refund" }), 400);
  assert.equal(await status({ action: "revoke", target: rec.lid, reason: "reissued" }), 400);
  for (const action of ["revoke", "unrevoke", "reissue"]) {
    const res = await call(ctx, { action, target: "buyer@example.com" });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "email_only_for_lookup");
  }
  assert.equal(revokedSet(ctx).length, 0);
});

// ------------------------------------------------------------------ lookup

test("lookup by lid, by license key and by email returns admin fields and never the licence string", async () => {
  const { ctx, session, rec } = await setup();
  for (const target of [rec.lid, rec.license, "BUYER@example.com"]) {
    const res = await call(ctx, { action: "lookup", target });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes("TSR1-"), "no licence string in the response");
    const { licenses } = JSON.parse(text);
    assert.equal(licenses.length, 1);
    assert.deepEqual(
      { ...licenses[0], issuedAt: undefined, emailedAt: undefined },
      {
        lid: rec.lid, email: "Buyer@Example.com", issuedAt: undefined, revokedAt: null, revokeReason: null,
        sessionId: session.id, paymentIntent: "pi_1", emailedAt: undefined, replacedBy: null, reissuedFrom: null,
      },
    );
    assert.equal(typeof licenses[0].issuedAt, "number");
    assert.equal(typeof licenses[0].emailedAt, "number");
  }
  const none = await (await call(ctx, { action: "lookup", target: "0".repeat(32) })).json();
  assert.deepEqual(none, { licenses: [] });
  assert.deepEqual(await (await call(ctx, { action: "lookup", target: "nobody@example.com" })).json(), { licenses: [] });
});

// ------------------------------------------------------------------ revoke / unrevoke

test("revoke leaked: no email, seq bumps once, in the signed list, record and Stripe metadata updated; repeat is 'already'", async () => {
  const { ctx, rec } = await setup();
  const before = seq(ctx);
  const res = await call(ctx, { action: "revoke", target: rec.license });
  assert.deepEqual(await res.json(), { result: "revoked", lid: rec.lid });
  assert.equal(ctx.mailer.sent.length, 0, "no customer email");
  assert.equal(seq(ctx), before + 1);
  const stored = await getLicense(ctx, rec.lid);
  assert.equal(stored.revokeReason, "leaked");
  assert.ok(stored.revokedAt);
  assert.deepEqual(ctx.stripe.state.metadata.at(-1), {
    pi: "pi_1", metadata: { license_revoked_at: String(stored.revokedAt), license_revoke_reason: "leaked" },
  });
  const list = verifyRevocationList(await buildRevocationList(ctx), revocationKeys);
  assert.equal(list.ok, true);
  assert.deepEqual(list.payload.revoked, [rec.lid]);
  assert.equal(list.payload.seq, before + 2);

  assert.deepEqual(await (await call(ctx, { action: "revoke", target: rec.lid })).json(), { result: "already", lid: rec.lid });
  assert.equal(seq(ctx), before + 1);
  assert.equal(ctx.mailer.sent.length, 0);
});

test("revoke: default reason is leaked, 'manual' is accepted and silent, unknown lid → unknown", async () => {
  const { ctx, rec } = await setup();
  await call(ctx, { action: "revoke", target: rec.lid, reason: "manual" });
  assert.equal((await getLicense(ctx, rec.lid)).revokeReason, "manual");
  assert.equal(ctx.mailer.sent.length, 0);
  const unknown = "f".repeat(32);
  assert.deepEqual(await (await call(ctx, { action: "revoke", target: unknown })).json(), { result: "unknown", lid: unknown });
  assert.equal(seq(ctx), 1);
});

test("refund and dispute revocations still email the customer", async () => {
  const { ctx } = await setup();
  await handleEvent(ctx, event("charge.refunded", { id: "ch_1", amount: 999, amount_refunded: 999, payment_intent: "pi_1" }));
  assert.equal(ctx.mailer.sent.length, 1);
  assert.equal(ctx.mailer.sent[0].subject, "Your Tessera Pro license has been deactivated");
});

test("unrevoke restores leaked and manual: srem, seq bump, record and metadata cleared, no email", async () => {
  for (const reason of ["leaked", "manual"]) {
    const { ctx, rec } = await setup();
    await call(ctx, { action: "revoke", target: rec.lid, reason });
    const before = seq(ctx);
    const res = await call(ctx, { action: "unrevoke", target: rec.lid });
    assert.deepEqual(await res.json(), { lid: rec.lid, result: "restored" });
    assert.deepEqual(revokedSet(ctx), []);
    assert.equal(seq(ctx), before + 1);
    const stored = await getLicense(ctx, rec.lid);
    assert.equal(stored.revokedAt, null);
    assert.equal(stored.revokeReason, null);
    assert.deepEqual(ctx.stripe.state.metadata.at(-1).metadata, { license_revoked_at: "", license_revoke_reason: "" });
    assert.equal(ctx.mailer.sent.length, 0);
    assert.deepEqual(verifyRevocationList(await buildRevocationList(ctx), revocationKeys).payload.revoked, []);
  }
});

test("unrevoke is skipped for refund, dispute, reissued, replaced and not-revoked licences", async () => {
  const { ctx, rec } = await setup();
  const un = async () => (await call(ctx, { action: "unrevoke", target: rec.lid })).json();
  assert.deepEqual(await un(), { lid: rec.lid, result: "skipped", reason: "not_revoked" });
  assert.equal(seq(ctx), 0);

  await handleEvent(ctx, event("charge.refunded", { id: "ch_1", amount: 999, amount_refunded: 999, payment_intent: "pi_1" }));
  assert.deepEqual(await un(), { lid: rec.lid, result: "skipped", reason: "refund" });
  assert.deepEqual(revokedSet(ctx), [rec.lid]);

  const d = await setup();
  await handleEvent(d.ctx, event("charge.dispute.created", { id: "dp_1", status: "needs_response", payment_intent: "pi_1" }));
  assert.equal((await (await call(d.ctx, { action: "unrevoke", target: d.rec.lid })).json()).reason, "dispute");

  const r = await setup();
  await call(r.ctx, { action: "reissue", target: r.rec.lid });
  assert.equal((await (await call(r.ctx, { action: "unrevoke", target: r.rec.lid })).json()).reason, "reissued");

  // Revoked as leaked, then replaced: restoring it would leave two valid keys.
  const l = await setup();
  await call(l.ctx, { action: "revoke", target: l.rec.lid });
  await call(l.ctx, { action: "reissue", target: l.rec.lid });
  assert.deepEqual(await (await call(l.ctx, { action: "unrevoke", target: l.rec.lid })).json(), { lid: l.rec.lid, result: "skipped", reason: "replaced" });

  assert.deepEqual(await (await call(ctx, { action: "unrevoke", target: "f".repeat(32) })).json(), { lid: "f".repeat(32), result: "unknown" });
});

test("disputes still restore only dispute-revoked licences (existing behaviour)", async () => {
  const { ctx, rec } = await setup();
  await call(ctx, { action: "revoke", target: rec.lid }); // leaked
  await handleEvent(ctx, event("charge.dispute.closed", { id: "dp_1", status: "won", payment_intent: "pi_1" }));
  assert.deepEqual(revokedSet(ctx), [rec.lid], "a won dispute must not restore a leaked key");
});

// ------------------------------------------------------------------ reissue

test("reissue: new verifiable key for the same email, old revoked as 'reissued', indexes moved, one email", async () => {
  const { ctx, session, rec } = await setup();
  const before = seq(ctx);
  const res = await call(ctx, { action: "reissue", target: rec.license });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.result, "reissued");
  assert.equal(out.oldLid, rec.lid);
  assert.match(out.newLid, /^[0-9a-f]{32}$/);
  assert.notEqual(out.newLid, rec.lid);
  assert.equal(out.emailed, true);

  const v = verifyLicense(out.license, licenseKeys);
  assert.equal(v.ok, true);
  assert.equal(v.payload.lid, out.newLid);
  assert.equal(v.payload.email, "Buyer@Example.com");
  assert.equal(v.payload.kid, "T1");
  assert.deepEqual(Object.keys(v.payload), ["v", "kid", "lid", "email", "iat", "product"]);

  const oldRec = await getLicense(ctx, rec.lid);
  assert.equal(oldRec.revokeReason, "reissued");
  assert.ok(oldRec.revokedAt);
  assert.equal(oldRec.replacedBy, out.newLid);
  const newRec = await getLicense(ctx, out.newLid);
  assert.equal(newRec.revokedAt, null);
  assert.equal(newRec.sessionId, session.id);
  assert.equal(newRec.paymentIntent, "pi_1");
  assert.equal(newRec.reissuedFrom, rec.lid);
  assert.ok(newRec.indexedAt && newRec.emailedAt);

  assert.equal(await ctx.store.get(`session:${session.id}`), out.newLid);
  assert.equal(await ctx.store.get("pi:pi_1"), out.newLid);
  const { emailHash } = await import("../crypto.js");
  assert.deepEqual((await ctx.store.smembers(`email:${emailHash("buyer@example.com")}`)).sort(), [rec.lid, out.newLid].sort());

  // Revocation list: old lid only; seq rose; no revocation email, one new-key email.
  assert.deepEqual(revokedSet(ctx), [rec.lid]);
  assert.equal(seq(ctx), before + 1);
  assert.equal(ctx.mailer.sent.length, 1);
  const mail = ctx.mailer.sent[0];
  assert.equal(mail.to, "Buyer@Example.com");
  assert.equal(mail.subject, "Your new Tessera Pro license");
  assert.ok(mail.text.includes(out.license));
  assert.ok(mail.html.includes("Enter License"));
  assert.ok(mail.text.includes("tessera-direct://activate?key="));
  assert.ok(mail.text.includes("https://conorgriffin.com/tessera/license"));
  assert.ok(mail.text.includes("support@example.com"));
  assert.match(mail.text, /previous key has been replaced/);
  assert.ok(!mail.text.includes(rec.license), "the old key is not in the email");

  // Stripe metadata points at the new lid and clears the old revoked marks.
  const last = ctx.stripe.state.metadata.at(-1);
  assert.equal(last.pi, "pi_1");
  assert.equal(last.metadata.license_id, out.newLid);
  assert.equal(last.metadata.license_issued_at, String(newRec.issuedAt));
  assert.equal(last.metadata.license_revoked_at, "");
  assert.equal(last.metadata.license_revoke_reason, "");

  // The thanks page and "find my license" now see only the new key.
  const again = await issueLicense(ctx, session.id);
  assert.equal(again.ok, true);
  assert.equal(again.record.lid, out.newLid);
});

test("reissue after a leaked revoke works, keeps the old reason, and is idempotent", async () => {
  const { ctx, rec } = await setup();
  await call(ctx, { action: "revoke", target: rec.lid });
  const seqAfterRevoke = seq(ctx);
  const first = await (await call(ctx, { action: "reissue", target: rec.lid })).json();
  assert.equal(first.result, "reissued");
  assert.equal((await getLicense(ctx, rec.lid)).revokeReason, "leaked");
  assert.equal(seq(ctx), seqAfterRevoke, "already in the list: no extra bump");
  assert.equal(ctx.mailer.sent.length, 1);
});

test("reissue is idempotent: the second call returns the same replacement, no new key, no second email, no seq bump", async () => {
  const { ctx, rec } = await setup();
  const first = await (await call(ctx, { action: "reissue", target: rec.lid })).json();
  const seqAfter = seq(ctx);
  const second = await (await call(ctx, { action: "reissue", target: rec.license })).json();
  assert.equal(second.result, "already");
  assert.equal(second.newLid, first.newLid);
  assert.equal(second.license, first.license);
  assert.equal(seq(ctx), seqAfter);
  assert.equal(ctx.mailer.sent.length, 1);
  assert.deepEqual(revokedSet(ctx), [rec.lid]);
  const lics = [...ctx.store.strings.keys()].filter((k) => k.startsWith("lic:"));
  assert.equal(lics.length, 2);
});

test("concurrent reissues produce a single replacement", async () => {
  const { ctx, rec } = await setup();
  const results = await Promise.all([1, 2, 3].map(() => call(ctx, { action: "reissue", target: rec.lid }).then((r) => r.json())));
  assert.equal(new Set(results.map((r) => r.newLid)).size, 1);
  assert.equal(results.filter((r) => r.result === "reissued").length, 1);
  assert.equal([...ctx.store.strings.keys()].filter((k) => k.startsWith("lic:")).length, 2);
  assert.equal(ctx.mailer.sent.length, 1);
});

test("reissue is retry-safe: a crash after the claim is finished by the next call", async () => {
  const { ctx, session, rec } = await setup();
  const realRevoke = ctx.store.sadd;
  let boom = true;
  ctx.store.sadd = async (key, member) => {
    if (boom && key === "revoked") { boom = false; throw new Error("redis hiccup"); }
    return realRevoke.call(ctx.store, key, member);
  };
  const failed = await call(ctx, { action: "reissue", target: rec.lid });
  assert.equal(failed.status, 500);
  assert.ok(!JSON.stringify(ctx.logs).includes("Buyer@Example.com"));
  const retry = await (await call(ctx, { action: "reissue", target: rec.lid })).json();
  assert.equal(retry.result, "already");
  assert.deepEqual(revokedSet(ctx), [rec.lid]);
  assert.equal(await ctx.store.get(`session:${session.id}`), retry.newLid);
  assert.equal(ctx.mailer.sent.length, 1);
  assert.equal([...ctx.store.strings.keys()].filter((k) => k.startsWith("lic:")).length, 2);
});

test("reissue is refused for refunded and disputed licences, and for an unknown lid", async () => {
  const a = await setup();
  await handleEvent(a.ctx, event("charge.refunded", { id: "ch_1", amount: 999, amount_refunded: 999, payment_intent: "pi_1" }));
  a.ctx.mailer.sent.length = 0;
  const refused = await call(a.ctx, { action: "reissue", target: a.rec.lid });
  assert.equal(refused.status, 200);
  assert.deepEqual(await refused.json(), { result: "refused", oldLid: a.rec.lid, reason: "refund" });
  assert.equal(a.ctx.mailer.sent.length, 0);
  assert.equal([...a.ctx.store.strings.keys()].filter((k) => k.startsWith("lic:")).length, 1);

  const b = await setup();
  await handleEvent(b.ctx, event("charge.dispute.created", { id: "dp_1", status: "needs_response", payment_intent: "pi_1" }));
  assert.equal((await (await call(b.ctx, { action: "reissue", target: b.rec.lid })).json()).result, "refused");

  assert.deepEqual(await (await call(b.ctx, { action: "reissue", target: "e".repeat(32) })).json(), { result: "unknown", oldLid: "e".repeat(32) });
});

test("reissue is refused when the replacement has itself been revoked", async () => {
  const { ctx, rec } = await setup();
  const first = await (await call(ctx, { action: "reissue", target: rec.lid })).json();
  await call(ctx, { action: "revoke", target: first.newLid });
  const again = await (await call(ctx, { action: "reissue", target: rec.lid })).json();
  assert.deepEqual(again, { result: "refused", oldLid: rec.lid, reason: "replacement_revoked" });
});

test("after a reissue, a later full refund revokes the NEW licence (and emails), not the old one twice", async () => {
  const { ctx, rec } = await setup();
  const out = await (await call(ctx, { action: "reissue", target: rec.lid })).json();
  ctx.mailer.sent.length = 0;
  await handleEvent(ctx, event("charge.refunded", { id: "ch_1", amount: 999, amount_refunded: 999, payment_intent: "pi_1" }));
  assert.deepEqual(revokedSet(ctx).sort(), [rec.lid, out.newLid].sort());
  assert.equal((await getLicense(ctx, out.newLid)).revokeReason, "refund");
  assert.equal((await getLicense(ctx, rec.lid)).revokeReason, "reissued");
  assert.equal(ctx.mailer.sent.length, 1);
  assert.equal(ctx.mailer.sent[0].subject, "Your Tessera Pro license has been deactivated");
  // And the list the app polls carries both.
  const list = verifyRevocationList(await buildRevocationList(ctx), revocationKeys);
  assert.deepEqual(list.payload.revoked, [rec.lid, out.newLid].sort());
});

test("after a reissue, a dispute (found via the PaymentIntent or the session) revokes the new licence", async () => {
  const { ctx, session, rec } = await setup();
  const out = await (await call(ctx, { action: "reissue", target: rec.lid })).json();
  await ctx.store.del("pi:pi_1"); // force the session fallback path
  await handleEvent(ctx, event("charge.dispute.created", { id: "dp_1", status: "needs_response", payment_intent: "pi_1" }));
  assert.equal((await getLicense(ctx, out.newLid)).revokeReason, "dispute");
  assert.equal(await ctx.store.get(`session:${session.id}`), out.newLid);
});

test("after a reissue, reconcile does not issue another licence for the session", async () => {
  const { ctx, rec } = await setup();
  const out = await (await call(ctx, { action: "reissue", target: rec.lid })).json();
  ctx.mailer.sent.length = 0;
  const r = await reconcile(ctx);
  assert.equal(r.issued, 0);
  assert.equal(r.errors, 0);
  assert.equal(ctx.mailer.sent.length, 0);
  assert.equal([...ctx.store.strings.keys()].filter((k) => k.startsWith("lic:")).length, 2);
  assert.equal(await ctx.store.get(`session:${(await getLicense(ctx, out.newLid)).sessionId}`), out.newLid);
});

test("reissue: an email failure still succeeds, returns the key, and the daily retry sends it once", async () => {
  const { ctx, rec } = await setup();
  ctx.mailer.fail = true;
  const out = await (await call(ctx, { action: "reissue", target: rec.lid })).json();
  assert.equal(out.result, "reissued");
  assert.equal(out.emailed, false);
  assert.equal(verifyLicense(out.license, licenseKeys).ok, true);
  assert.equal(ctx.mailer.sent.length, 0);
  ctx.mailer.fail = false;
  await reconcile(ctx);
  assert.equal(ctx.mailer.sent.length, 1);
  assert.equal(ctx.mailer.sent[0].subject, "Your new Tessera Pro license");
  await reconcile(ctx);
  assert.equal(ctx.mailer.sent.length, 1);
});

test("reissue works without a PaymentIntent (Managed Payments sessions)", async () => {
  const { ctx, session, rec } = await setup({ payment_intent: null, id: "cs_test_nopi12345" });
  const out = await (await call(ctx, { action: "reissue", target: rec.lid })).json();
  assert.equal(out.result, "reissued");
  assert.equal(await ctx.store.get(`session:${session.id}`), out.newLid);
  assert.equal(ctx.stripe.state.metadata.length, 0);
});

test("admin: logs never contain emails or licence keys", async () => {
  const { ctx, rec } = await setup();
  ctx.mailer.fail = true;
  ctx.stripe.state.failMetadata = true;
  const out = await (await call(ctx, { action: "reissue", target: rec.license })).json();
  assert.equal(out.result, "reissued", "Stripe metadata and email failures do not fail a reissue");
  assert.equal(ctx.logs.some((l) => l.msg === "stripe metadata update failed"), true);
  await call(ctx, { action: "revoke", target: out.license });
  await call(ctx, { action: "lookup", target: "buyer@example.com" });
  await call(ctx, { action: "lookup", target: "garbage" });
  const logged = JSON.stringify(ctx.logs);
  assert.ok(logged.length > 2);
  assert.ok(!/example\.com|TSR1-/.test(logged));
});
