import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyLicense, verifyRevocationList } from "../crypto.js";
import { licenseForSession, reconcileHandler, redirectTo, resend, revocations, stripeWebhook } from "../handlers.js";
import { NOW_MS, event, makeCtx, makeSession, stripeHeader as header, vectors, webhookRequest } from "./helpers.js";

const licenseKeys = { T1: vectors.keys.license.publicKeyBase64 };
const revocationKeys = { TR1: vectors.keys.revocation.publicKeyBase64 };

function setup() {
  const ctx = makeCtx();
  const session = makeSession();
  ctx.stripe.state.sessions.set(session.id, session);
  return { ctx, session, get: () => ctx };
}

// ------------------------------------------------------------------ webhook

test("webhook: bad or missing signature → 400 and nothing is processed", async () => {
  const { ctx, session } = setup();
  const ev = event("checkout.session.completed", session);
  const bad = await stripeWebhook(() => ctx, webhookRequest(ev, "t=1,v1=abc"));
  assert.equal(bad.status, 400);
  const none = await stripeWebhook(() => ctx, new Request("https://x.test/", { method: "POST", body: JSON.stringify(ev) }));
  assert.equal(none.status, 400);
  const stale = await stripeWebhook(() => ctx, webhookRequest(ev, header(JSON.stringify(ev), { t: Math.floor(NOW_MS / 1000) - 400 })));
  assert.equal(stale.status, 400);
  assert.equal(ctx.mailer.sent.length, 0);
});

test("webhook: missing STRIPE_WEBHOOK_SECRET is a 500, never an accept", async () => {
  const { ctx, session } = setup();
  ctx.env.STRIPE_WEBHOOK_SECRET = "";
  const res = await stripeWebhook(() => ctx, webhookRequest(event("checkout.session.completed", session)));
  assert.equal(res.status, 500);
});

test("webhook: paid checkout issues a licence; replaying the same event id is a no-op", async () => {
  const { ctx, session } = setup();
  const ev = event("checkout.session.completed", session, "evt_same");
  const first = await stripeWebhook(() => ctx, webhookRequest(ev));
  assert.equal(first.status, 200);
  assert.equal((await first.json()).result, "issued");
  assert.equal(ctx.store.ttls.get("evt:evt_same"), 30 * 86400);
  const second = await stripeWebhook(() => ctx, webhookRequest(ev));
  assert.equal(second.status, 200);
  assert.equal((await second.json()).duplicate, true);
  assert.equal(ctx.mailer.sent.length, 1);
});

test("webhook: a transient failure returns 500 and the event is retried (evt key not set)", async () => {
  const { ctx, session } = setup();
  const real = ctx.stripe.retrieveSession;
  ctx.stripe.retrieveSession = async () => { throw new Error("stripe 503"); };
  const ev = event("checkout.session.completed", session, "evt_retry");
  assert.equal((await stripeWebhook(() => ctx, webhookRequest(ev))).status, 500);
  assert.equal(await ctx.store.get("evt:evt_retry"), null);
  ctx.stripe.retrieveSession = real;
  const retry = await stripeWebhook(() => ctx, webhookRequest(ev));
  assert.equal(retry.status, 200);
  assert.equal(ctx.mailer.sent.length, 1);
});

test("webhook: refund then dispute events route to revocation; unrelated events and unknown payments get 200", async () => {
  const { ctx, session } = setup();
  await stripeWebhook(() => ctx, webhookRequest(event("checkout.session.completed", session)));
  const refund = await stripeWebhook(() => ctx, webhookRequest(event("charge.refunded", { id: "ch_1", amount: 999, amount_refunded: 999, payment_intent: "pi_1" })));
  assert.equal(refund.status, 200);
  assert.equal([...ctx.store.sets.get("revoked")].length, 1);
  assert.equal((await stripeWebhook(() => ctx, webhookRequest(event("invoice.paid", {})))).status, 200);
  const unknown = await stripeWebhook(() => ctx, webhookRequest(event("charge.refunded", { id: "ch_x", amount: 5, amount_refunded: 5, payment_intent: "pi_zzz" })));
  assert.equal(unknown.status, 200);
});

// ------------------------------------------------------------------ thanks page route

const licReq = (id) => new Request(`https://conorgriffin.com/api/tessera/license${id === undefined ? "" : `?session_id=${id}`}`);

test("license route: issues on demand (no webhook yet), no-store, activation URL", async () => {
  const { ctx, session } = setup();
  const res = await licenseForSession(() => ctx, licReq(session.id));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.equal(verifyLicense(body.license, licenseKeys).ok, true);
  assert.equal(body.email, "Buyer@Example.com");
  assert.equal(body.activationUrl, `tessera-direct://activate?key=${encodeURIComponent(body.license)}`);
  // The webhook arriving afterwards finds the same licence.
  const hook = await stripeWebhook(() => ctx, webhookRequest(event("checkout.session.completed", session)));
  assert.equal((await hook.json()).result, "exists");
  assert.equal(ctx.mailer.sent.length, 1);
});

test("license route: bad ids, unknown sessions, other products and old sessions → 404 pointing at find-my-license", async () => {
  const { ctx, session } = setup();
  for (const id of [undefined, "", "abc", "cs_", "pi_123456789", "cs_test_abc12345/../x", "cs_nope000000"]) {
    const res = await licenseForSession(() => ctx, licReq(id));
    assert.equal(res.status, 404, String(id));
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal((await res.json()).help, "/tessera/license");
  }
  const old = makeSession({ id: "cs_test_old000001", created: Math.floor(NOW_MS / 1000) - 8 * 86400 });
  ctx.stripe.state.sessions.set(old.id, old);
  assert.equal((await licenseForSession(() => ctx, licReq(old.id))).status, 404);
  const other = makeSession({ id: "cs_test_other0001", line_items: { data: [{ price: { product: "prod_x" } }] } });
  ctx.stripe.state.sessions.set(other.id, other);
  assert.equal((await licenseForSession(() => ctx, licReq(other.id))).status, 404);
  assert.equal(ctx.mailer.sent.length, 0);
});

test("license route: unpaid session → 409 payment_pending; revoked licence is not shown", async () => {
  const { ctx } = setup();
  const pending = makeSession({ id: "cs_test_pending01", payment_status: "unpaid" });
  ctx.stripe.state.sessions.set(pending.id, pending);
  const res = await licenseForSession(() => ctx, licReq(pending.id));
  assert.equal(res.status, 409);

  const { ctx: c2, session } = setup();
  await licenseForSession(() => c2, licReq(session.id));
  await stripeWebhook(() => c2, webhookRequest(event("charge.refunded", { id: "ch_1", amount: 9, amount_refunded: 9, payment_intent: "pi_1" })));
  assert.equal((await licenseForSession(() => c2, licReq(session.id))).status, 404);
});

// ------------------------------------------------------------------ resend route

const resendReq = (body, ip = "203.0.113.5, 10.0.0.1") =>
  new Request("https://conorgriffin.com/api/tessera/resend", {
    method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("resend route: identical response whether or not a purchase exists, and for junk input", async () => {
  const { ctx, session } = setup();
  await licenseForSession(() => ctx, licReq(session.id));
  ctx.mailer.sent.length = 0;
  const known = await resend(() => ctx, resendReq({ email: "buyer@example.com" }));
  const unknown = await resend(() => ctx, resendReq({ email: "stranger@example.com" }));
  const junk = await resend(() => ctx, resendReq("not json"));
  const empty = await resend(() => ctx, resendReq({}));
  const texts = await Promise.all([known, unknown, junk, empty].map((r) => r.text()));
  assert.ok(texts.every((t) => t === texts[0]));
  assert.deepEqual(JSON.parse(texts[0]), { ok: true });
  for (const r of [known, unknown, junk, empty]) {
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
  }
  assert.equal(ctx.mailer.sent.length, 1, "only the real address got an email");
});

test("resend route: rate limiting is silent (same 200 body) and uses the first x-forwarded-for value", async () => {
  const { ctx, session } = setup();
  await licenseForSession(() => ctx, licReq(session.id));
  ctx.mailer.sent.length = 0;
  const bodies = [];
  for (let i = 0; i < 5; i++) bodies.push(await (await resend(() => ctx, resendReq({ email: "buyer@example.com" }))).text());
  assert.ok(bodies.every((b) => b === bodies[0]));
  assert.equal(ctx.mailer.sent.length, 3);
  const keys = [...ctx.store.strings.keys()].filter((k) => k.startsWith("rl:ip:"));
  assert.equal(keys.length, 1);
  assert.ok(!keys[0].includes("203.0.113.5"), "IPs are stored hashed");
  // Same first IP, different later hops → same counter.
  await resend(() => ctx, resendReq({ email: "other@example.com" }, "203.0.113.5, 99.99.99.99"));
  assert.equal([...ctx.store.strings.keys()].filter((k) => k.startsWith("rl:ip:")).length, 1);
});

test("resend route: a backend failure still answers ok", async () => {
  const { ctx } = setup();
  ctx.store.smembers = async () => { throw new Error("redis down"); };
  const res = await resend(() => ctx, resendReq({ email: "buyer@example.com" }));
  assert.deepEqual(await res.json(), { ok: true });
});

test("resend route waits for the minimum time so timing doesn't reveal a match", async () => {
  const { ctx } = setup();
  ctx.resendMinMs = 60;
  let t = 0;
  ctx.now = () => (t += 1); // advances 1 ms per read
  const started = performance.now();
  await resend(() => ctx, resendReq({ email: "nobody@example.com" }));
  assert.ok(performance.now() - started >= 40);
});

// ------------------------------------------------------------------ revocations route

test("revocations route: signed list, public cache headers, reads no request headers", async () => {
  const { ctx, session } = setup();
  await licenseForSession(() => ctx, licReq(session.id));
  await stripeWebhook(() => ctx, webhookRequest(event("charge.refunded", { id: "ch_1", amount: 9, amount_refunded: 9, payment_intent: "pi_1" })));
  const res = await revocations(() => ctx);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "public, s-maxage=600, stale-while-revalidate=86400");
  const list = await res.json();
  const v = verifyRevocationList(list, revocationKeys);
  assert.equal(v.ok, true);
  assert.equal(v.payload.revoked.length, 1);
});

test("revocations route: no logging on success", async () => {
  const { ctx } = setup();
  await revocations(() => ctx);
  assert.deepEqual(ctx.logs, []);
});

// ------------------------------------------------------------------ reconcile + redirects

test("reconcile route: requires the cron bearer token; refuses when CRON_SECRET is unset", async () => {
  const { ctx, session } = setup();
  const req = (auth) => new Request("https://x.test/api/tessera/reconcile", { headers: auth ? { authorization: auth } : {} });
  assert.equal((await reconcileHandler(() => ctx, req())).status, 401);
  assert.equal((await reconcileHandler(() => ctx, req("Bearer nope"))).status, 401);
  assert.equal((await reconcileHandler(() => ctx, req("cron-secret"))).status, 401);
  const ok = await reconcileHandler(() => ctx, req("Bearer cron-secret"));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).issued, 1);
  assert.equal(ctx.mailer.sent.length, 1);
  ctx.env.CRON_SECRET = "";
  assert.equal((await reconcileHandler(() => ctx, req("Bearer "))).status, 401);
});

test("redirects: 302 to the configured https URL, 503 when unset or not https", async () => {
  const ok = redirectTo(() => ({ TESSERA_PAYMENT_LINK_URL: "https://buy.stripe.com/x" }), "TESSERA_PAYMENT_LINK_URL");
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get("location"), "https://buy.stripe.com/x");
  assert.equal(redirectTo(() => ({}), "TESSERA_DOWNLOAD_URL").status, 503);
  assert.equal(redirectTo(() => ({ TESSERA_DOWNLOAD_URL: "javascript:alert(1)" }), "TESSERA_DOWNLOAD_URL").status, 503);
});

test("a context that cannot be built answers 500 not_configured", async () => {
  const res = await revocations(() => { throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN are required"); });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "not_configured" });
});
