import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyLicense, verifyRevocationList } from "../crypto.js";
import {
  buildRevocationList, getLicense, handleEvent, issueLicense, reconcile, resendLicenses, retryUnsentEmails,
} from "../licensing.js";
import { activationLink, createMailer, licenseEmail, reissuedEmail, resendEmail } from "../email.js";
import { NOW_MS, event, makeCtx, makeSession, vectors } from "./helpers.js";

const licenseKeys = { T1: vectors.keys.license.publicKeyBase64 };
const revocationKeys = { TR1: vectors.keys.revocation.publicKeyBase64 };

function ctxWithSession(over = {}) {
  const ctx = makeCtx();
  const session = makeSession(over);
  ctx.stripe.state.sessions.set(session.id, session);
  return { ctx, session };
}

const revokedSet = (ctx) => [...(ctx.store.sets.get("revoked") ?? [])];
const seq = (ctx) => Number(ctx.store.strings.get("revocations:seq") ?? 0);

// ------------------------------------------------------------------ issuing

test("issueLicense signs a verifiable licence, stores it, indexes it and emails it", async () => {
  const { ctx, session } = ctxWithSession();
  const r = await issueLicense(ctx, session.id);
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  const v = verifyLicense(r.record.license, licenseKeys);
  assert.equal(v.ok, true);
  assert.match(v.payload.lid, /^[0-9a-f]{32}$/);
  assert.equal(v.payload.email, "Buyer@Example.com");
  assert.equal(v.payload.iat, Math.floor(NOW_MS / 1000));
  assert.equal(r.record.lid, v.payload.lid);
  assert.ok(!r.record.lid.includes("cs_") && !r.record.lid.includes("pi_"), "lid is random, never a Stripe id");

  assert.equal(await ctx.store.get(`session:${session.id}`), r.record.lid);
  assert.equal(await ctx.store.get("pi:pi_1"), r.record.lid);
  assert.equal((await ctx.store.smembers("email:" + (await import("../crypto.js")).emailHash("buyer@example.com"))).length, 1);

  assert.equal(ctx.mailer.sent.length, 1);
  assert.equal(ctx.mailer.sent[0].to, "Buyer@Example.com");
  assert.equal(ctx.mailer.sent[0].subject, "Your Tessera Pro license");
  assert.ok(ctx.mailer.sent[0].text.includes(r.record.license));
  const link = `https://www.conorgriffin.com/tessera/activate#key=${encodeURIComponent(r.record.license)}`;
  assert.ok(ctx.mailer.sent[0].text.includes(link));
  assert.ok(ctx.mailer.sent[0].html.includes(link));
  assert.ok(!ctx.mailer.sent[0].text.includes("tessera-direct://") && !ctx.mailer.sent[0].html.includes("tessera-direct://"));
  assert.ok(ctx.mailer.sent[0].text.includes("https://conorgriffin.com/tessera/download"));
  assert.ok(ctx.mailer.sent[0].text.includes("https://conorgriffin.com/tessera/license"));
  assert.ok(ctx.mailer.sent[0].text.includes("support@example.com"));
  assert.ok(ctx.mailer.sent[0].html.includes("Enter License"));

  const stored = await getLicense(ctx, r.record.lid);
  assert.ok(stored.emailedAt);
  assert.equal(ctx.store.sets.get("unsent")?.size ?? 0, 0);
  assert.deepEqual(ctx.stripe.state.metadata, [{ pi: "pi_1", metadata: { license_id: r.record.lid, license_issued_at: String(Math.floor(NOW_MS / 1000)) } }]);
});

test("issueLicense is idempotent per session: one licence, one email, one Stripe fetch", async () => {
  const { ctx, session } = ctxWithSession();
  const a = await issueLicense(ctx, session.id);
  const b = await issueLicense(ctx, session.id);
  assert.equal(b.created, false);
  assert.equal(a.record.license, b.record.license);
  assert.equal(ctx.mailer.sent.length, 1);
  assert.equal(ctx.stripe.state.calls.filter(([n]) => n === "retrieveSession").length, 1);
});

test("concurrent issuance (webhook and thanks page together) yields a single licence", async () => {
  const { ctx, session } = ctxWithSession();
  const results = await Promise.all([issueLicense(ctx, session.id), issueLicense(ctx, session.id), issueLicense(ctx, session.id)]);
  assert.equal(new Set(results.map((r) => r.record.lid)).size, 1);
  assert.equal(results.filter((r) => r.created).length, 1);
  const lics = [...ctx.store.strings.keys()].filter((k) => k.startsWith("lic:"));
  assert.equal(lics.length, 1, "losing attempts clean up their record");
});

test("issueLicense works without a PaymentIntent on the session (Managed Payments)", async () => {
  const { ctx, session } = ctxWithSession({ payment_intent: null });
  const r = await issueLicense(ctx, session.id);
  assert.equal(r.ok, true);
  assert.equal(r.record.paymentIntent, null);
  assert.deepEqual(ctx.stripe.state.metadata, []);
});

test("issueLicense refuses sessions that are unpaid, for another product, without an email, or unknown", async () => {
  const cases = [
    [{ payment_status: "unpaid" }, "unpaid"],
    [{ status: "open", payment_status: "unpaid" }, "unpaid"],
    [{ line_items: { data: [{ price: { product: "prod_other" } }] } }, "wrong_product"],
    [{ customer_details: null }, "no_email"],
  ];
  for (const [over, reason] of cases) {
    const { ctx, session } = ctxWithSession(over);
    const r = await issueLicense(ctx, session.id);
    assert.deepEqual(r, { ok: false, reason });
    assert.equal(ctx.mailer.sent.length, 0);
    assert.equal([...ctx.store.strings.keys()].filter((k) => k.startsWith("lic:")).length, 0);
  }
  const ctx = makeCtx();
  assert.deepEqual(await issueLicense(ctx, "cs_nope"), { ok: false, reason: "not_found" });
});

test("an expanded product object on the line item is accepted", async () => {
  const { ctx, session } = ctxWithSession({ line_items: { data: [{ price: { product: { id: "prod_tessera" } } }] } });
  assert.equal((await issueLicense(ctx, session.id)).ok, true);
});

test("a wrong-product session is remembered so the daily job does not refetch it", async () => {
  const { ctx, session } = ctxWithSession({ line_items: { data: [{ price: { product: "prod_other" } }] } });
  await issueLicense(ctx, session.id);
  await issueLicense(ctx, session.id);
  assert.equal(ctx.stripe.state.calls.filter(([n]) => n === "retrieveSession").length, 1);
});

test("maxAgeSeconds: sessions older than the window are refused, new and existing", async () => {
  const old = Math.floor(NOW_MS / 1000) - 8 * 86400;
  const { ctx, session } = ctxWithSession({ created: old });
  assert.deepEqual(await issueLicense(ctx, session.id, { maxAgeSeconds: 7 * 86400 }), { ok: false, reason: "too_old" });
  // Without the window (webhook) it is issued; afterwards the thanks route still refuses it.
  assert.equal((await issueLicense(ctx, session.id)).ok, true);
  // The window runs from the purchase (the Checkout Session's created time), not from when we issued the licence.
  assert.equal((await issueLicense(ctx, session.id, { maxAgeSeconds: 7 * 86400 })).reason, "too_old");
});

test("email failure is not fatal; the licence is kept for the retry job", async () => {
  const { ctx, session } = ctxWithSession();
  ctx.mailer.fail = true;
  const r = await issueLicense(ctx, session.id);
  assert.equal(r.ok, true);
  assert.equal(r.record.emailedAt, null);
  assert.deepEqual([...ctx.store.sets.get("unsent")], [r.record.lid]);
  assert.ok(ctx.logs.some((l) => l.msg === "licence email failed"));

  ctx.mailer.fail = false;
  assert.equal(await retryUnsentEmails(ctx), 1);
  assert.equal(ctx.mailer.sent.length, 1);
  assert.equal(ctx.store.sets.get("unsent").size, 0);
  assert.equal(await retryUnsentEmails(ctx), 0);
});

test("Stripe metadata failure does not fail issuance", async () => {
  const { ctx, session } = ctxWithSession();
  ctx.stripe.state.failMetadata = true;
  assert.equal((await issueLicense(ctx, session.id)).ok, true);
  assert.equal(ctx.mailer.sent.length, 1);
});

test("logs never contain emails, licences or session-derived secrets", async () => {
  const { ctx, session } = ctxWithSession();
  ctx.mailer.fail = true;
  ctx.stripe.state.failMetadata = true;
  const r = await issueLicense(ctx, session.id);
  const text = JSON.stringify(ctx.logs);
  assert.ok(!text.toLowerCase().includes("example.com"));
  assert.ok(!text.includes(r.record.license));
  assert.ok(!text.includes("TSR1"));
});

// ------------------------------------------------------------------ revocation rules

async function issued(over = {}) {
  const { ctx, session } = ctxWithSession(over);
  const r = await issueLicense(ctx, session.id);
  ctx.mailer.sent.length = 0;
  ctx.stripe.state.metadata.length = 0;
  return { ctx, session, rec: r.record };
}

const charge = (over = {}) => ({ id: "ch_1", amount: 999, amount_refunded: 999, payment_intent: "pi_1", ...over });

test("a full refund revokes: list, seq, record, factual email, Stripe metadata", async () => {
  const { ctx, rec } = await issued();
  const before = seq(ctx);
  assert.equal(await handleEvent(ctx, event("charge.refunded", charge())), "revoked");
  assert.deepEqual(revokedSet(ctx), [rec.lid]);
  assert.equal(seq(ctx), before + 1);
  const stored = await getLicense(ctx, rec.lid);
  assert.equal(stored.revokeReason, "refund");
  assert.ok(stored.revokedAt);
  assert.equal(ctx.mailer.sent.length, 1);
  assert.equal(ctx.mailer.sent[0].to, "Buyer@Example.com");
  assert.equal(ctx.mailer.sent[0].text, "Your Tessera Pro license has been deactivated because the payment was refunded or disputed. Reply to this email if that's a mistake.\n");
  assert.equal(ctx.stripe.state.metadata[0].metadata.license_revoke_reason, "refund");
});

test("a partial refund does nothing", async () => {
  const { ctx, rec } = await issued();
  assert.equal(await handleEvent(ctx, event("charge.refunded", charge({ amount_refunded: 500 }))), "ignored");
  assert.deepEqual(revokedSet(ctx), []);
  assert.equal(seq(ctx), 0);
  assert.equal((await getLicense(ctx, rec.lid)).revokedAt, null);
  assert.equal(ctx.mailer.sent.length, 0);
});

test("revoking twice changes nothing the second time (no extra seq, no second email)", async () => {
  const { ctx } = await issued();
  await handleEvent(ctx, event("charge.refunded", charge()));
  const s = seq(ctx);
  assert.equal(await handleEvent(ctx, event("charge.refunded", charge())), "already");
  assert.equal(seq(ctx), s);
  assert.equal(ctx.mailer.sent.length, 1);
});

test("a dispute revokes; closing it as won restores, with no email; seq rises both times", async () => {
  const { ctx, rec } = await issued();
  assert.equal(await handleEvent(ctx, event("charge.dispute.created", { id: "dp_1", payment_intent: "pi_1", charge: "ch_1", status: "needs_response" })), "revoked");
  assert.equal((await getLicense(ctx, rec.lid)).revokeReason, "dispute");
  assert.equal(seq(ctx), 1);
  ctx.mailer.sent.length = 0;
  assert.equal(await handleEvent(ctx, event("charge.dispute.closed", { id: "dp_1", payment_intent: "pi_1", status: "won" })), "restored");
  assert.deepEqual(revokedSet(ctx), []);
  assert.equal(seq(ctx), 2);
  const stored = await getLicense(ctx, rec.lid);
  assert.equal(stored.revokedAt, null);
  assert.equal(stored.revokeReason, null);
  assert.equal(ctx.mailer.sent.length, 0, "no email on un-revoke");
});

test("a won dispute does not restore a licence that was revoked for a refund", async () => {
  const { ctx, rec } = await issued();
  await handleEvent(ctx, event("charge.refunded", charge()));
  const s = seq(ctx);
  assert.equal(await handleEvent(ctx, event("charge.dispute.closed", { id: "dp_1", payment_intent: "pi_1", status: "won" })), "skipped");
  assert.deepEqual(revokedSet(ctx), [rec.lid]);
  assert.equal(seq(ctx), s);
});

test("a lost dispute leaves the revocation in place; early-warning inquiries do nothing", async () => {
  const { ctx } = await issued();
  assert.equal(await handleEvent(ctx, event("charge.dispute.created", { id: "dp_w", payment_intent: "pi_1", status: "warning_needs_response" })), "ignored");
  assert.deepEqual(revokedSet(ctx), []);
  await handleEvent(ctx, event("charge.dispute.created", { id: "dp_1", payment_intent: "pi_1", status: "needs_response" }));
  assert.equal(await handleEvent(ctx, event("charge.dispute.closed", { id: "dp_1", payment_intent: "pi_1", status: "lost" })), "ignored");
  assert.equal(revokedSet(ctx).length, 1);
});

test("unknown payment: ignored with a warning that carries no PII", async () => {
  const ctx = makeCtx();
  assert.equal(await handleEvent(ctx, event("charge.refunded", charge({ payment_intent: "pi_unknown" }))), "unknown");
  assert.ok(ctx.logs.some((l) => l.level === "warn"));
  assert.ok(!JSON.stringify(ctx.logs).includes("pi_unknown"));
});

test("refunds find the licence through the charge or the session when the PaymentIntent was not stored", async () => {
  const { ctx, session, rec } = await issued({ payment_intent: null });
  // The session now reports a PaymentIntent (Stripe attaches it later); the charge event only knows the PI.
  ctx.stripe.state.sessions.set(session.id, { ...session, payment_intent: "pi_late" });
  assert.equal(await handleEvent(ctx, event("charge.refunded", charge({ payment_intent: "pi_late" }))), "revoked");
  assert.deepEqual(revokedSet(ctx), [rec.lid]);
  assert.equal(await ctx.store.get("pi:pi_late"), rec.lid, "mapping is cached");

  // A dispute that has only a charge id.
  const b = await issued({ id: "cs_test_two12345", payment_intent: null });
  b.ctx.stripe.state.sessions.set("cs_test_two12345", { ...b.session, payment_intent: "pi_2" });
  b.ctx.stripe.state.charges.set("ch_9", { id: "ch_9", payment_intent: "pi_2" });
  assert.equal(await handleEvent(b.ctx, event("charge.dispute.created", { id: "dp_9", charge: "ch_9", payment_intent: null, status: "needs_response" })), "revoked");
});

test("checkout events: paid completes issue; unpaid completed waits for async success", async () => {
  const { ctx, session } = ctxWithSession();
  const pending = { ...session, payment_status: "unpaid" };
  assert.equal(await handleEvent(ctx, event("checkout.session.completed", pending)), "ignored");
  assert.equal(ctx.mailer.sent.length, 0);
  assert.equal(await handleEvent(ctx, event("checkout.session.async_payment_succeeded", session)), "issued");
  assert.equal(ctx.mailer.sent.length, 1);
  assert.equal(await handleEvent(ctx, event("checkout.session.completed", { ...session, payment_status: "paid" })), "exists");
  assert.equal(await handleEvent(ctx, event("customer.created", {})), "ignored");
});

// ------------------------------------------------------------------ revocation list

test("revocation list: contract format, sorted ids, seq starts at 1 and strictly rises", async () => {
  const ctx = makeCtx();
  const empty = await buildRevocationList(ctx);
  assert.deepEqual(Object.keys(empty), ["payload", "sig"]);
  const v0 = verifyRevocationList(empty, revocationKeys);
  assert.equal(v0.ok, true);
  assert.deepEqual(v0.payload, { v: 1, kid: "TR1", seq: 1, generated: Math.floor(NOW_MS / 1000), revoked: [] });

  const a = await issued();
  await handleEvent(a.ctx, event("charge.refunded", charge()));
  const l1 = verifyRevocationList(await buildRevocationList(a.ctx), revocationKeys).payload;
  assert.equal(l1.seq, 2);
  assert.deepEqual(l1.revoked, [a.rec.lid]);
  // Key order in the signed bytes is part of the contract.
  const text = Buffer.from((await buildRevocationList(a.ctx)).payload, "base64url").toString();
  assert.match(text, /^\{"v":1,"kid":"TR1","seq":2,"generated":\d+,"revoked":\["[0-9a-f]{32}"\]\}$/);

  await handleEvent(a.ctx, event("charge.dispute.closed", { id: "d", payment_intent: "pi_1", status: "won" })); // skipped: reason refund
  assert.equal(verifyRevocationList(await buildRevocationList(a.ctx), revocationKeys).payload.seq, 2);
});

test("revocation list is signed with the revocation key, not the licence key", async () => {
  const ctx = makeCtx();
  ctx.env.TESSERA_REVOCATION_PRIVATE_KEY = vectors.keys.license.privateKeyPkcs8Base64; // misconfigured on purpose
  const list = await buildRevocationList(ctx);
  assert.equal(verifyRevocationList(list, revocationKeys).ok, false);
});

// ------------------------------------------------------------------ resend

test("resendLicenses emails every non-revoked licence for the address; revoked ones are left out", async () => {
  const a = await issued();
  const s2 = makeSession({ id: "cs_test_second99", payment_intent: "pi_2", customer_details: { email: "buyer@example.com" } });
  a.ctx.stripe.state.sessions.set(s2.id, s2);
  const second = await issueLicense(a.ctx, s2.id);
  const s3 = makeSession({ id: "cs_test_third999", payment_intent: "pi_3" });
  a.ctx.stripe.state.sessions.set(s3.id, s3);
  const third = await issueLicense(a.ctx, s3.id);
  await handleEvent(a.ctx, event("charge.refunded", charge({ payment_intent: "pi_3" })));
  a.ctx.mailer.sent.length = 0;

  assert.equal(await resendLicenses(a.ctx, "  BUYER@example.com ", "iphash"), "sent");
  assert.equal(a.ctx.mailer.sent.length, 1);
  const text = a.ctx.mailer.sent[0].text;
  assert.ok(text.includes(a.rec.license) && text.includes(second.record.license));
  assert.ok(!text.includes(third.record.license));
});

test("resendLicenses sends nothing for unknown, invalid or fully revoked addresses", async () => {
  const a = await issued();
  assert.equal(await resendLicenses(a.ctx, "nobody@example.com", "ip"), "none");
  assert.equal(await resendLicenses(a.ctx, "not an email", "ip"), "invalid");
  assert.equal(await resendLicenses(a.ctx, undefined, "ip"), "invalid");
  await handleEvent(a.ctx, event("charge.refunded", charge()));
  a.ctx.mailer.sent.length = 0;
  assert.equal(await resendLicenses(a.ctx, "buyer@example.com", "ip"), "none");
  assert.equal(a.ctx.mailer.sent.length, 0);
});

test("resend rate limits: 3 per email per hour, 10 per IP per hour, with expiry set", async () => {
  const a = await issued();
  a.ctx.mailer.sent.length = 0;
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await resendLicenses(a.ctx, "buyer@example.com", "ip1"));
  assert.deepEqual(results, ["sent", "sent", "sent", "limited", "limited"]);
  assert.equal(a.ctx.mailer.sent.length, 3);
  assert.ok([...a.ctx.store.ttls.entries()].some(([k, v]) => k.startsWith("rl:email:") && v === 3600));

  const b = makeCtx();
  const out = [];
  for (let i = 0; i < 12; i++) out.push(await resendLicenses(b, `user${i}@example.com`, "ip2"));
  assert.deepEqual(out.slice(0, 10), Array(10).fill("none"));
  assert.deepEqual(out.slice(10), ["limited", "limited"]);
  assert.ok([...b.store.ttls.entries()].some(([k, v]) => k.startsWith("rl:ip:") && v === 3600));
  // Raw addresses are never used as keys.
  assert.ok(![...b.store.strings.keys()].some((k) => k.includes("user1@")));
});

// ------------------------------------------------------------------ reconcile

test("reconcile issues missed licences, applies refunds and disputes, retries emails", async () => {
  const ctx = makeCtx();
  const s1 = makeSession({ id: "cs_test_missed001", payment_intent: "pi_a" });
  const s2 = makeSession({ id: "cs_test_missed002", payment_intent: "pi_b", customer_details: { email: "two@example.com" } });
  const s3 = makeSession({ id: "cs_test_missed003", payment_intent: "pi_c", customer_details: { email: "three@example.com" } });
  const other = makeSession({ id: "cs_test_other0001", line_items: { data: [{ price: { product: "prod_x" } }] } });
  for (const s of [s1, s2, s3, other]) ctx.stripe.state.sessions.set(s.id, s);

  const r1 = await reconcile(ctx);
  assert.equal(r1.issued, 3);
  assert.equal(r1.errors, 0);
  assert.equal(ctx.mailer.sent.length, 3);

  ctx.stripe.state.charges.set("ch_a", charge({ id: "ch_a", payment_intent: "pi_a" }));
  ctx.stripe.state.refunds.push({ id: "re_1", status: "succeeded", charge: "ch_a" }, { id: "re_2", status: "succeeded", charge: "ch_a" });
  ctx.stripe.state.disputes.push({ id: "dp_b", payment_intent: "pi_b", status: "under_review" });
  const r2 = await reconcile(ctx);
  assert.equal(r2.issued, 0);
  assert.equal(r2.revoked, 2);
  assert.equal(revokedSet(ctx).length, 2);
  const seqAfter = seq(ctx);

  ctx.stripe.state.disputes[0].status = "won";
  const r3 = await reconcile(ctx);
  assert.equal(r3.restored, 1);
  assert.equal(r3.revoked, 0, "already-revoked refund is not counted twice");
  assert.equal(revokedSet(ctx).length, 1);
  assert.ok(seq(ctx) > seqAfter);

  // A second run is a no-op.
  const s = seq(ctx);
  await reconcile(ctx);
  assert.equal(seq(ctx), s);
});

test("reconcile counts errors per item and carries on", async () => {
  const ctx = makeCtx();
  const good = makeSession({ id: "cs_test_good00001" });
  ctx.stripe.state.sessions.set(good.id, good);
  const real = ctx.stripe.retrieveSession;
  ctx.stripe.listCompletedSessions = async () => [{ id: "cs_test_boom00001", payment_status: "paid" }, good];
  ctx.stripe.retrieveSession = async (id) => { if (id.includes("boom")) throw new Error("boom"); return real(id); };
  const r = await reconcile(ctx);
  assert.equal(r.issued, 1);
  assert.equal(r.errors, 1);
});

test("emails link to the https activation page, never the custom scheme", () => {
  const rec = { license: "TSR1-abc.def", email: "a@example.com" };
  const link = activationLink(rec.license);
  assert.equal(link, "https://www.conorgriffin.com/tessera/activate#key=TSR1-abc.def");
  for (const m of [licenseEmail(rec, "s@example.com"), reissuedEmail(rec, "s@example.com"), resendEmail([rec], "s@example.com")]) {
    assert.ok(m.text.includes(link) && m.html.includes(link));
    assert.ok(!m.text.includes("tessera-direct://") && !m.html.includes("tessera-direct://"));
  }
});

test("mailer surfaces Resend's error name and status, and nothing else from the body", async () => {
  const mk = (status, body) => createMailer({ apiKey: "k", from: "f@example.com", fetch: async () => ({ ok: false, status, json: async () => body }) });
  const send = (m) => m.send({ to: "x@example.com", subject: "s", text: "t" });
  await assert.rejects(send(mk(403, { name: "validation_error", message: "domain x@example.com not verified" })), (e) => {
    assert.equal(e.message, "resend failed (403): validation_error");
    assert.equal(e.status, 403);
    assert.equal(e.mailer, true);
    return true;
  });
  await assert.rejects(send(mk(500, { name: "not a short name!" })), /^Error: resend failed \(500\)$/);
  const bad = createMailer({ apiKey: "k", from: "f@example.com", fetch: async () => ({ ok: false, status: 502, json: async () => { throw new Error("html"); } }) });
  await assert.rejects(send(bad), { message: "resend failed (502)", status: 502 });
});

test("a failed licence email logs the mailer detail but no address, key or body", async () => {
  const { ctx, session } = ctxWithSession();
  ctx.mailer.send = async () => { throw Object.assign(new Error("resend failed (403): validation_error"), { status: 403, mailer: true }); };
  await issueLicense(ctx, session.id);
  const entry = ctx.logs.find((l) => l.msg === "licence email failed");
  assert.equal(entry.error, "Error");
  assert.equal(entry.detail, "resend failed (403): validation_error");
  assert.ok(!JSON.stringify(ctx.logs).includes("example.com") && !JSON.stringify(ctx.logs).includes("TSR1-"));
});

test("non-mailer errors log no detail", async () => {
  const { ctx, session } = ctxWithSession();
  ctx.mailer.fail = true; // plain Error("resend down")
  await issueLicense(ctx, session.id);
  const entry = ctx.logs.find((l) => l.msg === "licence email failed");
  assert.deepEqual(Object.keys(entry).sort(), ["error", "level", "msg"]);
});
