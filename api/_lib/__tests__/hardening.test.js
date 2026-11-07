// Tests for the admin security review fixes: payment revocation that survives an admin revoke, reissue vs the public
// session endpoint, refund/reissue races, the admin host pin, and the bearer secret rules + failed-auth rate limit.
import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256Hex, verifyLicense, verifyRevocationList } from "../crypto.js";
import { adminCallback, adminHandler, adminLogin, adminLogout, adminSession, licenseForSession } from "../handlers.js";
import { buildRevocationList, getLicense, handleEvent, issueLicense, reissueLicense, revokeLicense } from "../licensing.js";
import { NOW_MS, event, makeCtx, makeSession, vectors } from "./helpers.js";

const SECRET = "admin-secret-0123456789abcdef0123456789abcdef";
const keys = { T1: vectors.keys.license.publicKeyBase64 };
const rkeys = { TR1: vectors.keys.revocation.publicKeyBase64 };
const DAY_MS = 86400 * 1000;
const refund = () => event("charge.refunded", { id: "ch_1", amount: 999, amount_refunded: 999, payment_intent: "pi_1" });
const disputeOpened = () => event("charge.dispute.created", { id: "dp_1", status: "needs_response", payment_intent: "pi_1" });
const disputeWon = () => event("charge.dispute.closed", { id: "dp_1", status: "won", payment_intent: "pi_1" });
const revokedSet = (ctx) => [...(ctx.store.sets.get("revoked") ?? [])].sort();
const seq = (ctx) => Number(ctx.store.strings.get("revocations:seq") ?? 0);
const revokedEmails = (ctx) => ctx.mailer.sent.filter((m) => m.subject === "Your Tessera Pro license has been deactivated");

async function setup(over = {}) {
  const ctx = makeCtx();
  ctx.env.TESSERA_ADMIN_SECRET = SECRET;
  const session = makeSession(over);
  ctx.stripe.state.sessions.set(session.id, session);
  const rec = (await issueLicense(ctx, session.id)).record;
  ctx.mailer.sent.length = 0;
  ctx.stripe.state.metadata.length = 0;
  return { ctx, session, rec };
}

const call = (ctx, body, { auth = `Bearer ${SECRET}`, url = "https://www.conorgriffin.com/api/tessera/admin", headers = {} } = {}) =>
  adminHandler(() => ctx, new Request(url, {
    method: "POST",
    headers: { ...(auth === null ? {} : { authorization: auth }), "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
const admin = async (ctx, body) => (await call(ctx, body)).json();
const publicLicense = async (ctx, sessionId) =>
  licenseForSession(() => ctx, new Request(`https://www.conorgriffin.com/api/tessera/license?session_id=${sessionId}`));

// ------------------------------------------------------------------ 1. payment revocation survives an admin revoke

for (const adminReason of ["leaked", "manual"]) {
  test(`refund after an admin revoke (${adminReason}) is recorded: one email, no extra seq bump, unrevoke and reissue refused`, async () => {
    const { ctx, rec } = await setup();
    await admin(ctx, { action: "revoke", target: rec.lid, reason: adminReason });
    const seqBefore = seq(ctx);
    ctx.mailer.sent.length = 0;
    ctx.stripe.state.metadata.length = 0;

    assert.equal(await handleEvent(ctx, refund()), "revoked");
    const stored = await getLicense(ctx, rec.lid);
    assert.equal(stored.revokeReason, adminReason, "the admin reason is kept");
    assert.equal(stored.paymentRevokeReason, "refund");
    assert.equal(stored.paymentRevokedAt, Math.floor(NOW_MS / 1000));
    assert.equal(seq(ctx), seqBefore, "the revoked set did not change, so the list's seq does not move");
    assert.deepEqual(revokedSet(ctx), [rec.lid]);
    assert.equal(revokedEmails(ctx).length, 1, "the customer is told once");
    assert.equal(revokedEmails(ctx)[0].idempotencyKey, `tessera-revoked-${rec.lid}`);
    assert.equal(ctx.stripe.state.metadata.at(-1).metadata.license_revoke_reason, "refund");

    // Repeats (Stripe retry, reconcile) change nothing and send nothing.
    assert.equal(await handleEvent(ctx, refund()), "already");
    assert.equal(revokedEmails(ctx).length, 1);
    assert.equal(seq(ctx), seqBefore);

    // The admin can't undo it.
    assert.deepEqual(await admin(ctx, { action: "unrevoke", target: rec.lid }), { lid: rec.lid, result: "skipped", reason: "refund" });
    assert.deepEqual(await admin(ctx, { action: "reissue", target: rec.lid }), { result: "refused", oldLid: rec.lid, reason: "refund" });
    assert.deepEqual(revokedSet(ctx), [rec.lid]);
    assert.equal((await getLicense(ctx, rec.lid)).replacedBy, undefined);

    // Lookup shows it.
    const [view] = (await admin(ctx, { action: "lookup", target: rec.lid })).licenses;
    assert.equal(view.paymentStatus, "refund");
    assert.equal(view.paymentRevokedAt, stored.paymentRevokedAt);
    assert.equal(view.revokeReason, adminReason);
  });
}

test("PoC 1 (review M1): leaked, then refund, then 'mistaken' unrevoke or reissue never brings a key back", async () => {
  const { ctx, rec } = await setup();
  await admin(ctx, { action: "revoke", target: rec.lid, reason: "leaked" });
  await handleEvent(ctx, refund());
  const re = await admin(ctx, { action: "reissue", target: rec.lid });
  assert.equal(re.result, "refused");
  assert.equal(re.license, undefined);
  const un = await admin(ctx, { action: "unrevoke", target: rec.lid });
  assert.equal(un.result, "skipped");
  const list = verifyRevocationList(await buildRevocationList(ctx), rkeys).payload.revoked;
  assert.deepEqual(list, [rec.lid]);
});

test("dispute after an admin revoke is recorded the same way; a won dispute clears only the dispute and leaves the leaked revoke", async () => {
  const { ctx, rec } = await setup();
  await admin(ctx, { action: "revoke", target: rec.lid, reason: "leaked" });
  assert.equal(await handleEvent(ctx, disputeOpened()), "revoked");
  assert.equal((await getLicense(ctx, rec.lid)).paymentRevokeReason, "dispute");
  assert.equal(revokedEmails(ctx).length, 1);
  assert.deepEqual(await admin(ctx, { action: "unrevoke", target: rec.lid }), { lid: rec.lid, result: "skipped", reason: "dispute" });
  assert.equal((await admin(ctx, { action: "reissue", target: rec.lid })).result, "refused");

  const seqBefore = seq(ctx);
  assert.equal(await handleEvent(ctx, disputeWon()), "skipped", "nothing comes back: it was also revoked as leaked");
  const stored = await getLicense(ctx, rec.lid);
  assert.equal(stored.paymentRevokeReason, null);
  assert.equal(stored.revokeReason, "leaked");
  assert.ok(stored.revokedAt);
  assert.deepEqual(revokedSet(ctx), [rec.lid]);
  assert.equal(seq(ctx), seqBefore);
  // With the dispute gone the admin is back in charge of the leaked revoke.
  assert.equal((await admin(ctx, { action: "unrevoke", target: rec.lid })).result, "restored");
  assert.deepEqual(revokedSet(ctx), []);
});

test("a dispute that revoked the licence by itself is still restored when won, and payment fields are cleared", async () => {
  const { ctx, rec } = await setup();
  await handleEvent(ctx, disputeOpened());
  const mid = await getLicense(ctx, rec.lid);
  assert.equal(mid.revokeReason, "dispute");
  assert.equal(mid.paymentRevokeReason, "dispute");
  assert.equal(await handleEvent(ctx, disputeWon()), "restored");
  const stored = await getLicense(ctx, rec.lid);
  assert.equal(stored.revokedAt, null);
  assert.equal(stored.revokeReason, null);
  assert.equal(stored.paymentRevokeReason, null);
  assert.deepEqual(revokedSet(ctx), []);
});

test("a refund outranks a dispute: after dispute then refund, winning the dispute does not restore", async () => {
  const { ctx, rec } = await setup();
  await handleEvent(ctx, disputeOpened());
  ctx.mailer.sent.length = 0;
  await handleEvent(ctx, refund());
  const stored = await getLicense(ctx, rec.lid);
  assert.equal(stored.paymentRevokeReason, "refund");
  assert.equal(stored.revokeReason, "refund");
  assert.equal(revokedEmails(ctx).length, 0, "already told about the dispute");
  assert.equal(await handleEvent(ctx, disputeWon()), "skipped");
  assert.deepEqual(revokedSet(ctx), [rec.lid]);
});

test("a dispute arriving after a refund does not downgrade it", async () => {
  const { ctx, rec } = await setup();
  await handleEvent(ctx, refund());
  assert.equal(await handleEvent(ctx, disputeOpened()), "already");
  assert.equal((await getLicense(ctx, rec.lid)).paymentRevokeReason, "refund");
  assert.equal(revokedEmails(ctx).length, 1);
});

test("records revoked by a refund before the payment fields existed are still treated as payment-revoked", async () => {
  const { ctx, rec } = await setup();
  const legacy = { ...(await getLicense(ctx, rec.lid)), revokedAt: 1700000000, revokeReason: "refund" };
  await ctx.store.set(`lic:${rec.lid}`, JSON.stringify(legacy));
  await ctx.store.sadd("revoked", rec.lid);
  assert.equal((await admin(ctx, { action: "unrevoke", target: rec.lid })).reason, "refund");
  assert.equal((await admin(ctx, { action: "reissue", target: rec.lid })).reason, "refund");
  const [view] = (await admin(ctx, { action: "lookup", target: rec.lid })).licenses;
  assert.equal(view.paymentStatus, "refund");
  assert.equal(view.paymentRevokedAt, 1700000000);
});

test("a refund that follows an admin revoke repairs a missing 'revoked' set entry and bumps seq only then", async () => {
  const { ctx, rec } = await setup();
  await admin(ctx, { action: "revoke", target: rec.lid });
  ctx.store.sets.get("revoked").delete(rec.lid); // a half-finished earlier revoke
  const before = seq(ctx);
  await handleEvent(ctx, refund());
  assert.deepEqual(revokedSet(ctx), [rec.lid]);
  assert.equal(seq(ctx), before + 1);
});

// ------------------------------------------------------------------ 2. reissue and the public session endpoint

test("PoC 2 (review M2): after a reissue the old thanks-page link no longer serves the new key, now or later", async () => {
  const { ctx, session, rec } = await setup();
  const first = await publicLicense(ctx, session.id);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).license, rec.license);

  const re = await admin(ctx, { action: "reissue", target: rec.lid });
  assert.equal(re.result, "reissued");
  for (const offsetDays of [0, 3, 6, 400]) {
    ctx.now = () => NOW_MS + offsetDays * DAY_MS;
    const res = await publicLicense(ctx, session.id);
    assert.equal(res.status, 404, `day ${offsetDays}`);
    const body = await res.json();
    assert.deepEqual(body, { error: "not_found", help: "/tessera/license" });
    assert.ok(!JSON.stringify(body).includes("TSR1-"));
  }
  // Reissuing again does not re-arm it either.
  ctx.now = () => NOW_MS;
  const second = await admin(ctx, { action: "reissue", target: re.newLid });
  assert.equal(second.result, "reissued");
  assert.equal((await publicLicense(ctx, session.id)).status, 404);
});

test("the 7-day window runs from the purchase, not from when the licence was issued or replaced", async () => {
  // Purchase 8 days ago, but the webhook only issued the licence now (async payment).
  const old = Math.floor(NOW_MS / 1000) - 8 * 86400;
  const { ctx, session, rec } = await setup({ created: old });
  assert.equal(rec.purchasedAt, old);
  assert.equal((await publicLicense(ctx, session.id)).status, 404);
  // Within the window it is served, and the window ends 7 days after the purchase.
  const fresh = await setup({ created: Math.floor(NOW_MS / 1000) - 60 });
  assert.equal((await publicLicense(fresh.ctx, fresh.session.id)).status, 200);
  fresh.ctx.now = () => NOW_MS + 6.9 * DAY_MS;
  assert.equal((await publicLicense(fresh.ctx, fresh.session.id)).status, 200);
  fresh.ctx.now = () => NOW_MS + 7.1 * DAY_MS;
  assert.equal((await publicLicense(fresh.ctx, fresh.session.id)).status, 404);
});

test("a replacement carries the original purchase time, and records without one fall back to issuedAt", async () => {
  const { ctx, rec } = await setup({ created: Math.floor(NOW_MS / 1000) - 3600 });
  ctx.now = () => NOW_MS + 5 * DAY_MS;
  const re = await admin(ctx, { action: "reissue", target: rec.lid });
  const replacement = await getLicense(ctx, re.newLid);
  assert.equal(replacement.purchasedAt, rec.purchasedAt);
  assert.ok(replacement.issuedAt > replacement.purchasedAt);
  // A record from before the field existed.
  const legacy = { ...(await getLicense(ctx, re.newLid)), reissuedFrom: undefined };
  delete legacy.purchasedAt;
  legacy.issuedAt = Math.floor(NOW_MS / 1000) - 8 * 86400;
  await ctx.store.set(`lic:${re.newLid}`, JSON.stringify(legacy));
  assert.equal((await issueLicense(ctx, rec.sessionId, { maxAgeSeconds: 7 * 86400 })).reason, "too_old");
});

test("the webhook and reconcile paths still see the reissued record (no second licence, no new email)", async () => {
  const { ctx, session, rec } = await setup();
  const re = await admin(ctx, { action: "reissue", target: rec.lid });
  ctx.mailer.sent.length = 0;
  const r = await issueLicense(ctx, session.id);
  assert.equal(r.ok, true);
  assert.equal(r.created, false);
  assert.equal(r.record.lid, re.newLid);
  assert.equal(ctx.mailer.sent.length, 0);
});

// ------------------------------------------------------------------ 3. refund racing a reissue

/** Runs `fn` once, the first time the store sets a key matching `match`, just before the write happens. */
function interleave(ctx, match, fn) {
  const realSet = ctx.store.set.bind(ctx.store);
  let fired = false;
  ctx.store.set = async (key, value, opts) => {
    if (!fired && match(key)) {
      fired = true;
      await fn();
    }
    return realSet(key, value, opts);
  };
  return () => fired;
}

test("PoC 3 (review L2): a refund landing before the reissue claim leaves no valid replacement", async () => {
  const { ctx, rec } = await setup();
  const fired = interleave(ctx, (k) => k.startsWith("reissue:"), () => handleEvent(ctx, refund()));
  const re = await admin(ctx, { action: "reissue", target: rec.lid });
  assert.ok(fired());
  assert.equal(re.result, "refused");
  assert.equal(re.reason, "refund");
  assert.equal(re.license, undefined, "no key is handed out");
  const newLid = await ctx.store.get(`reissue:${rec.lid}`);
  assert.ok(newLid);
  const replacement = await getLicense(ctx, newLid);
  assert.equal(replacement.revokeReason, "refund");
  assert.equal(replacement.paymentRevokeReason, "refund");
  assert.deepEqual(revokedSet(ctx), [rec.lid, newLid].sort());
  assert.deepEqual(verifyRevocationList(await buildRevocationList(ctx), rkeys).payload.revoked, [rec.lid, newLid].sort());
  assert.equal(ctx.mailer.sent.filter((m) => m.subject === "Your new Tessera Pro license").length, 0, "the replacement was never emailed");
  assert.equal(revokedEmails(ctx).length, 1);
  // Retrying the reissue stays refused.
  assert.equal((await admin(ctx, { action: "reissue", target: rec.lid })).result, "refused");
});

test("a refund landing after the claim but before the pointers move reaches the replacement through the claim", async () => {
  const { ctx, session, rec } = await setup();
  const fired = interleave(ctx, (k) => k === `session:${session.id}`, () => handleEvent(ctx, refund()));
  const re = await admin(ctx, { action: "reissue", target: rec.lid });
  assert.ok(fired());
  assert.equal(re.result, "refused");
  const newLid = await ctx.store.get(`reissue:${rec.lid}`);
  assert.deepEqual(revokedSet(ctx), [rec.lid, newLid].sort());
  assert.equal((await getLicense(ctx, newLid)).paymentRevokeReason, "refund");
  assert.equal(ctx.mailer.sent.filter((m) => m.subject === "Your new Tessera Pro license").length, 0);
});

test("a refund landing between the pointer moves and the final re-read is caught by the re-read", async () => {
  const { ctx, rec } = await setup();
  // The old record is patched with replacedBy after both pointers move; refund right then (it resolves pi: to the new lid).
  const realSet = ctx.store.set.bind(ctx.store);
  let fired = false;
  ctx.store.set = async (key, value, opts) => {
    const ok = await realSet(key, value, opts);
    if (!fired && key === "pi:pi_1" && String(value) !== rec.lid) {
      fired = true;
      await handleEvent(ctx, refund());
    }
    return ok;
  };
  const re = await admin(ctx, { action: "reissue", target: rec.lid });
  assert.ok(fired);
  assert.equal(re.result, "refused");
  const newLid = await ctx.store.get(`reissue:${rec.lid}`);
  assert.deepEqual(revokedSet(ctx), [rec.lid, newLid].sort());
  assert.equal(ctx.mailer.sent.filter((m) => m.subject === "Your new Tessera Pro license").length, 0);
});

test("a refund after a completed reissue revokes the whole chain, marks the payment on the old record too, and emails once", async () => {
  const { ctx, rec } = await setup();
  const re = await admin(ctx, { action: "reissue", target: rec.lid });
  ctx.mailer.sent.length = 0;
  assert.equal(await handleEvent(ctx, refund()), "revoked");
  assert.equal(revokedEmails(ctx).length, 1);
  const [oldRec, newRec] = [await getLicense(ctx, rec.lid), await getLicense(ctx, re.newLid)];
  assert.equal(oldRec.revokeReason, "reissued");
  assert.equal(oldRec.paymentRevokeReason, "refund");
  assert.equal(newRec.revokeReason, "refund");
  assert.equal(newRec.paymentRevokeReason, "refund");
  assert.deepEqual(await admin(ctx, { action: "reissue", target: rec.lid }), { result: "refused", oldLid: rec.lid, reason: "refund" });
  assert.equal((await admin(ctx, { action: "reissue", target: re.newLid })).result, "refused");
});

test("the refund follows a reissue claim whose replacedBy link was never written (crash mid-reissue)", async () => {
  const { ctx, rec } = await setup();
  const first = await admin(ctx, { action: "reissue", target: rec.lid });
  // Simulate the crash: old record lost its replacedBy link and the pointers still say the old lid.
  const old = await getLicense(ctx, rec.lid);
  delete old.replacedBy;
  await ctx.store.set(`lic:${rec.lid}`, JSON.stringify(old));
  await ctx.store.set("pi:pi_1", rec.lid);
  await handleEvent(ctx, refund());
  assert.ok(revokedSet(ctx).includes(first.newLid));
  assert.equal((await getLicense(ctx, first.newLid)).paymentRevokeReason, "refund");
});

test("a won dispute after a reissue restores the replacement (revoked only by the dispute), not the reissued original", async () => {
  const { ctx, rec } = await setup();
  const re = await admin(ctx, { action: "reissue", target: rec.lid });
  await handleEvent(ctx, disputeOpened());
  assert.deepEqual(revokedSet(ctx), [rec.lid, re.newLid].sort());
  assert.equal(await handleEvent(ctx, disputeWon()), "restored");
  assert.deepEqual(revokedSet(ctx), [rec.lid]);
  const oldRec = await getLicense(ctx, rec.lid);
  assert.equal(oldRec.revokeReason, "reissued");
  assert.equal(oldRec.paymentRevokeReason, null);
  assert.equal((await getLicense(ctx, re.newLid)).revokedAt, null);
  // The restored replacement is reissuable again.
  assert.equal((await admin(ctx, { action: "reissue", target: re.newLid })).result, "reissued");
});

test("revokeLicense on an unknown lid is still 'unknown' and reissueLicense of one is unknown", async () => {
  const { ctx } = await setup();
  assert.equal(await revokeLicense(ctx, "a".repeat(32), "refund"), "unknown");
  assert.deepEqual(await reissueLicense(ctx, "a".repeat(32)), { result: "unknown", oldLid: "a".repeat(32) });
});

// ------------------------------------------------------------------ 4. host pin

test("admin routes answer 404 for any host but the configured one, even with valid credentials", async () => {
  const { ctx, rec } = await setup();
  const body = { action: "lookup", target: rec.lid };
  const hosts = [
    "https://conorgriffin-com-abc123-conor.vercel.app", "https://conorgriffin-com.vercel.app", "https://conorgriffin.com",
    "https://www.conorgriffin.com.evil.example.com", "https://evil.example.com", "http://www.conorgriffin.com:8080", "https://www.conorgriffin.com:444",
  ];
  for (const host of hosts) {
    const res = await call(ctx, body, { url: `${host}/api/tessera/admin` });
    assert.equal(res.status, 404, host);
    assert.deepEqual(await res.json(), { error: "not_found" });
  }
  assert.equal((await call(ctx, body)).status, 200);
  assert.equal((await call(ctx, body, { url: "https://WWW.ConorGriffin.com/api/tessera/admin" })).status, 200, "host names are case-insensitive");
  // Wrong credentials on the wrong host are 404 as well: nothing to learn from a stale deployment.
  assert.equal((await call(ctx, body, { url: "https://x.vercel.app/api/tessera/admin", auth: "Bearer nope" })).status, 404);
});

test("a Host header that differs from the configured host is refused even when the URL looks right", async () => {
  const { ctx, rec } = await setup();
  const body = { action: "lookup", target: rec.lid };
  const res = await call(ctx, body, { headers: { host: "conorgriffin-com-abc.vercel.app" } });
  assert.equal(res.status, 404);
  assert.equal((await call(ctx, body, { headers: { host: "www.conorgriffin.com" } })).status, 200);
});

test("TESSERA_ADMIN_BASE_URL sets the allowed host; an unusable value falls back to www", async () => {
  const { ctx, rec } = await setup();
  const body = { action: "lookup", target: rec.lid };
  ctx.env.TESSERA_ADMIN_BASE_URL = "https://admin.example.com";
  assert.equal((await call(ctx, body)).status, 404);
  assert.equal((await call(ctx, body, { url: "https://admin.example.com/api/tessera/admin" })).status, 200);
  ctx.env.TESSERA_ADMIN_BASE_URL = "not a url";
  assert.equal((await call(ctx, body)).status, 200);
  ctx.env.TESSERA_ADMIN_BASE_URL = "http://evil.example.com";
  assert.equal((await call(ctx, body)).status, 200);
  assert.equal((await call(ctx, body, { url: "http://evil.example.com/api/tessera/admin" })).status, 404);
  ctx.env.TESSERA_ADMIN_BASE_URL = "http://localhost:3000";
  assert.equal((await call(ctx, body, { url: "http://localhost:3000/api/tessera/admin" })).status, 200);
});

test("the four sign-in routes also answer 404 on the wrong host, before touching Google or cookies", async () => {
  const ctx = makeCtx({ fetch: async () => { throw new Error("must not be called"); } });
  Object.assign(ctx.env, { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", TESSERA_ADMIN_EMAILS: "a@example.com", TESSERA_ADMIN_SESSION_SECRET: "s".repeat(40) });
  for (const [handler, path, method] of [
    [adminLogin, "admin-login", "GET"], [adminCallback, "admin-callback", "GET"], [adminSession, "admin-session", "GET"], [adminLogout, "admin-logout", "POST"],
  ]) {
    const stale = await handler(() => ctx, new Request(`https://conorgriffin-com-abc.vercel.app/api/tessera/${path}`, { method, headers: { origin: "https://conorgriffin-com-abc.vercel.app" } }));
    assert.equal(stale.status, 404, path);
    assert.equal(stale.headers.get("set-cookie"), null);
    assert.equal(stale.headers.get("location"), null);
    const right = await handler(() => ctx, new Request(`https://www.conorgriffin.com/api/tessera/${path}`, { method, headers: { origin: "https://www.conorgriffin.com" } }));
    assert.notEqual(right.status, 404, path);
  }
});

test("the CLI default base URL passes the host check", async () => {
  const { ctx, rec } = await setup();
  const res = await call(ctx, { action: "lookup", target: rec.lid }, { url: new URL("/api/tessera/admin", "https://www.conorgriffin.com").href });
  assert.equal(res.status, 200);
});

// ------------------------------------------------------------------ 7. bearer secret length and failed-auth rate limit

test("a TESSERA_ADMIN_SECRET shorter than 32 characters is treated as unset, with one warning that never shows the value", async () => {
  const { ctx, rec } = await setup();
  const short = "s".repeat(31);
  ctx.env.TESSERA_ADMIN_SECRET = short;
  const body = { action: "lookup", target: rec.lid };
  for (let i = 0; i < 3; i++) assert.equal((await call(ctx, body, { auth: `Bearer ${short}` })).status, 404, "bearer off and no Google config: the route does not exist");
  const warns = ctx.logs.filter((l) => l.msg === "admin secret too short");
  assert.equal(warns.length, 1);
  assert.ok(!JSON.stringify(ctx.logs).includes(short));
  // 32 characters is enough.
  ctx.env.TESSERA_ADMIN_SECRET = "s".repeat(32);
  assert.equal((await call(ctx, body, { auth: `Bearer ${"s".repeat(32)}` })).status, 200);
});

test("with Google admin configured, a short bearer secret is simply not accepted (401)", async () => {
  const { ctx, rec } = await setup();
  Object.assign(ctx.env, { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", TESSERA_ADMIN_EMAILS: "a@example.com", TESSERA_ADMIN_SESSION_SECRET: "s".repeat(40), TESSERA_ADMIN_SECRET: "short" });
  assert.equal((await call(ctx, { action: "lookup", target: rec.lid }, { auth: "Bearer short" })).status, 401);
  assert.equal((await call(ctx, { action: "lookup", target: rec.lid }, { auth: "Bearer " })).status, 401);
});

test("failed admin auth is limited per IP: 20 failures an hour, then 429 for everything from that address", async () => {
  const { ctx, rec } = await setup();
  const body = { action: "lookup", target: rec.lid };
  const from = (ip) => ({ headers: { "x-forwarded-for": ip } });
  for (let i = 0; i < 20; i++) assert.equal((await call(ctx, body, { auth: "Bearer wrong", ...from("203.0.113.9, 10.0.0.1") })).status, 401, `attempt ${i + 1}`);
  const blocked = await call(ctx, body, { auth: "Bearer wrong", ...from("203.0.113.9") });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "3600");
  assert.equal(blocked.headers.get("cache-control"), "no-store");
  assert.deepEqual(await blocked.json(), { error: "too_many_attempts" });
  // Even the right secret is refused while blocked, so guessing can't continue past the limit.
  assert.equal((await call(ctx, body, from("203.0.113.9"))).status, 429);
  // Only the first x-forwarded-for entry counts, and other addresses are unaffected.
  assert.equal((await call(ctx, body, from("203.0.113.9, 198.51.100.1"))).status, 429);
  assert.equal((await call(ctx, body, from("198.51.100.1, 203.0.113.9"))).status, 200);
  assert.equal((await call(ctx, body)).status, 200, "no header at all is its own bucket");

  // The counter is keyed by a hash of the address and expires after an hour.
  const key = `rl:adminfail:${sha256Hex("203.0.113.9")}`;
  assert.equal(ctx.store.strings.get(key), "20");
  assert.equal(ctx.store.ttls.get(key), 3600);
  assert.ok(![...ctx.store.strings.keys()].some((k) => k.includes("203.0.113.9")));
});

test("successful requests don't count towards the limit, and expired cookies etc. count as failures", async () => {
  const { ctx, rec } = await setup();
  const body = { action: "lookup", target: rec.lid };
  for (let i = 0; i < 30; i++) assert.equal((await call(ctx, body)).status, 200);
  assert.equal(ctx.store.strings.get(`rl:adminfail:${sha256Hex("unknown")}`), undefined);
  assert.equal((await call(ctx, body, { auth: null })).status, 401);
  assert.equal(ctx.store.strings.get(`rl:adminfail:${sha256Hex("unknown")}`), "1");
});

test("the rate limit does not apply to (or create counters for) an unconfigured route or the wrong host", async () => {
  const { ctx, rec } = await setup();
  await call(ctx, { action: "lookup", target: rec.lid }, { url: "https://x.vercel.app/api/tessera/admin", auth: "Bearer wrong" });
  ctx.env.TESSERA_ADMIN_SECRET = undefined;
  await call(ctx, { action: "lookup", target: rec.lid }, { auth: "Bearer wrong" });
  assert.ok(![...ctx.store.strings.keys()].some((k) => k.startsWith("rl:adminfail:")));
});

test("if Redis is down for the rate limit, valid credentials still decide the outcome", async () => {
  const { ctx, rec } = await setup();
  const realGet = ctx.store.get.bind(ctx.store);
  ctx.store.get = async (k) => { if (k.startsWith("rl:adminfail:")) throw new Error("redis down"); return realGet(k); };
  ctx.store.incrWithExpiry = async () => { throw new Error("redis down"); };
  assert.equal((await call(ctx, { action: "lookup", target: rec.lid })).status, 200);
  assert.equal((await call(ctx, { action: "lookup", target: rec.lid }, { auth: "Bearer wrong" })).status, 401);
});

test("verifyLicense still accepts a reissued key (sanity)", async () => {
  const { ctx, rec } = await setup();
  const re = await admin(ctx, { action: "reissue", target: rec.lid });
  assert.equal(verifyLicense(re.license, keys).ok, true);
});
