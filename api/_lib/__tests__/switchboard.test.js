// The second app: Audio Switchboard. Same code as Tessera, driven by apps.js. These tests cover what must not leak
// between the two: license formats, Redis keys, webhook secrets, products, refunds, admin credentials.
import assert from "node:assert/strict";
import { test } from "node:test";
import { APPS, appFromRequest, getApp, isConfigured } from "../apps.js";
import { createContext } from "../context.js";
import { b64urlDecode, signLicense, signRevocationList, verifyLicense, verifyRevocationList } from "../crypto.js";
import { licenseEmail, resendEmail, revokedEmail, reissuedEmail, freeLicenseEmail } from "../email.js";
import {
  adminHandler, adminLogin, appPrice, goHandler, licenseForSession, parseAdminTarget, reconcileHandler, resetPriceCache, revocations,
  salesOpen, stripeWebhook,
} from "../handlers.js";
import { buildRevocationList, getLicense, handleEvent, issueLicense, reconcileAll } from "../licensing.js";
import { appRoute } from "../route.js";
import { createMemoryStore, createRedisStore } from "../store.js";
import {
  NOW_MS, SWB_PRODUCT_ID, event, makeBothCtx, makeCtx, makeSession, makeSwbSession, stripeHeader, swbEnv, swbVectors, swbWebhookRequest,
  vectors, webhookRequest,
} from "./helpers.js";

const SWB = { prefix: APPS.switchboard.licensePrefix, product: APPS.switchboard.product };
const swbKeys = { T1: swbVectors.keys.license.publicKeyBase64 };
const swbRevKeys = { TR1: swbVectors.keys.revocation.publicKeyBase64 };
const tessKeys = { T1: vectors.keys.license.publicKeyBase64 };
const verifySwb = (license) => verifyLicense(license, swbKeys, SWB);
const p = swbVectors.license.payload;

// ------------------------------------------------------------------ the contract's test vectors

test("registry: contract constants", () => {
  const a = APPS.switchboard;
  assert.equal(a.licensePrefix, "SWB1-");
  assert.equal(a.product, "switchboard-pro");
  assert.equal(a.urlScheme, "switchboard-direct");
  assert.equal(a.redisNamespace, "switchboard:");
  assert.equal(a.defaultFrom, "Audio Switchboard <switchboard@conorgriffin.com>");
  assert.equal(a.pages.thanks, "/switchboard/thanks");
  assert.equal(APPS.tessera.redisNamespace, "tessera:", "Tessera's existing Redis keys keep their namespace");
  // Tessera's variable names are exactly today's.
  assert.deepEqual(APPS.tessera.env, {
    productId: "TESSERA_STRIPE_PRODUCT_ID", paymentLink: "TESSERA_PAYMENT_LINK_URL", downloadUrl: "TESSERA_DOWNLOAD_URL",
    webhookSecret: "STRIPE_WEBHOOK_SECRET", salesOpen: "VITE_TESSERA_SALES_OPEN", licenseKid: "TESSERA_LICENSE_KID",
    licensePrivateKey: "TESSERA_LICENSE_PRIVATE_KEY", revocationKid: "TESSERA_REVOCATION_KID",
    revocationPrivateKey: "TESSERA_REVOCATION_PRIVATE_KEY", resendFrom: "RESEND_FROM", adminSecret: "TESSERA_ADMIN_SECRET",
    adminEmails: "TESSERA_ADMIN_EMAILS",
  });
  // Every Switchboard variable has its own name; none collides with Tessera's.
  const tess = new Set(Object.values(APPS.tessera.env));
  for (const name of Object.values(a.env)) assert.ok(name.startsWith("SWITCHBOARD_") || name.startsWith("VITE_SWITCHBOARD_"), name);
  for (const name of Object.values(a.env)) assert.ok(!tess.has(name), name);
});

test("vector: signing the payload with T1 reproduces the SWB1- license exactly", () => {
  const license = signLicense({ privateKey: swbVectors.keys.license.privateKeyPkcs8Base64, kid: p.kid, lid: p.lid, email: p.email, iat: p.iat, ...SWB });
  assert.equal(license, swbVectors.license.valid);
  assert.equal(b64urlDecode(license.slice(5).split(".")[0]).toString("utf8"),
    '{"v":1,"kid":"T1","lid":"0123456789abcdef0123456789abcdef","email":"buyer@example.com","iat":1762525200,"product":"switchboard-pro"}');
});

test("vector: valid, whitespace; tampered, other key, unknown kid, wrong product and malformed are rejected", () => {
  assert.equal(verifySwb(swbVectors.license.valid).ok, true);
  assert.equal(verifySwb(swbVectors.license.validWithWhitespace).ok, true);
  assert.deepEqual(verifySwb(swbVectors.license.tamperedPayload), { ok: false, error: "badSignature" });
  assert.deepEqual(verifySwb(swbVectors.license.signedByOtherKey), { ok: false, error: "badSignature" });
  assert.deepEqual(verifySwb(swbVectors.license.unknownKid), { ok: false, error: "unknownKey" });
  assert.deepEqual(verifySwb(swbVectors.license.wrongProduct), { ok: false, error: "wrongProduct" });
  for (const bad of swbVectors.license.malformed) assert.equal(verifySwb(bad).ok, false, bad);
});

test("a Tessera license never validates as Switchboard, and the reverse", () => {
  assert.equal(verifySwb(vectors.license.valid).ok, false); // TSR1- prefix
  assert.equal(verifyLicense(swbVectors.license.valid, tessKeys).ok, false); // default (Tessera) rules
  assert.equal(verifyLicense(swbVectors.license.valid, tessKeys, { prefix: "TSR1-", product: "tessera-pro" }).ok, false);
  // Same key, same payload shape, only the prefix swapped: still refused (the product inside differs from the prefix's app).
  const swappedPrefix = vectors.license.valid.replace(/^TSR1-/, "SWB1-");
  assert.deepEqual(verifySwb(swappedPrefix), { ok: false, error: "wrongProduct" });
  const swappedBack = swbVectors.license.valid.replace(/^SWB1-/, "TSR1-");
  assert.deepEqual(verifyLicense(swappedBack, tessKeys), { ok: false, error: "wrongProduct" });
});

test("vector: the revocation list reproduces, verifies under TR1; a list signed with the license key is rejected", () => {
  const rp = swbVectors.revocationList.payload;
  assert.deepEqual(
    signRevocationList({ privateKey: swbVectors.keys.revocation.privateKeyPkcs8Base64, kid: rp.kid, seq: rp.seq, generated: rp.generated, revoked: rp.revoked }),
    swbVectors.revocationList.valid,
  );
  assert.equal(verifyRevocationList(swbVectors.revocationList.valid, swbRevKeys).ok, true);
  assert.deepEqual(verifyRevocationList(swbVectors.revocationList.signedWithLicenseKey, swbRevKeys), { ok: false, error: "badSignature" });
});

// ------------------------------------------------------------------ routing: which app is a request for

test("appFromRequest: the path decides, then the app query (rewrites), unknown slugs are null", () => {
  const app = (url) => appFromRequest(new Request(url))?.slug ?? null;
  assert.equal(app("https://www.conorgriffin.com/api/tessera/revocations"), "tessera");
  assert.equal(app("https://www.conorgriffin.com/api/switchboard/revocations"), "switchboard");
  assert.equal(app("https://www.conorgriffin.com/api/switchboard/go?to=buy"), "switchboard");
  assert.equal(app("https://www.conorgriffin.com/api/tessera/stripe-webhook/"), "tessera");
  // A rewrite keeps its public path; the destination's ?app= identifies the app. The path wins when both are there.
  assert.equal(app("https://www.conorgriffin.com/switchboard/buy?to=buy&app=switchboard"), "switchboard");
  assert.equal(app("https://www.conorgriffin.com/api/[app]/go?app=switchboard"), "switchboard");
  assert.equal(app("https://www.conorgriffin.com/api/tessera/revocations?app=switchboard"), "tessera");
  for (const url of ["/api/nope/x", "/api/constructor/x", "/api/__proto__/x", "/api/TESSERA/x", "/api/switchboard%2e/x", "/x", "/switchboard/buy?app=nope", "/api/all/reconcile"]) {
    assert.equal(app(`https://www.conorgriffin.com${url}`), null, url);
  }
  assert.equal(getApp("constructor"), null);
});

test("appRoute: an unknown app is 404 and never reaches the handler; /api/all/reconcile only where allowed", async () => {
  let called = 0;
  const handler = () => (called++, new Response("ok"));
  const res = await appRoute(handler)(new Request("https://www.conorgriffin.com/api/nope/revocations"));
  assert.equal(res.status, 404);
  assert.equal(called, 0);
  assert.equal((await appRoute(handler)(new Request("https://www.conorgriffin.com/api/switchboard/revocations"))).status, 200);
  assert.equal((await appRoute(handler)(new Request("https://www.conorgriffin.com/api/all/reconcile"))).status, 404);
  assert.equal((await appRoute(handler, { allApps: true })(new Request("https://www.conorgriffin.com/api/all/reconcile"))).status, 200);
  assert.equal((await appRoute(handler, { allApps: true })(new Request("https://www.conorgriffin.com/api/all/revocations"))).status, 404);
  assert.equal(called, 2);
});

// ------------------------------------------------------------------ Redis keys

test("Switchboard's keys are prefixed in the shared database; Tessera's are not touched", async () => {
  const { tessera, switchboard, db } = makeBothCtx();
  const swb = makeSwbSession();
  tessera.stripe.state.sessions.set(swb.id, swb);
  const r = await issueLicense(switchboard, swb.id);
  assert.equal(r.ok, true);
  const keys = [...db.strings.keys(), ...db.sets.keys()];
  assert.ok(keys.length > 0);
  for (const k of keys) assert.ok(k.startsWith("switchboard:"), `unprefixed key ${k}`);
  assert.ok(db.strings.has(`switchboard:lic:${r.record.lid}`));
  assert.ok(db.strings.has(`switchboard:session:${swb.id}`));
  assert.ok(db.sets.has("switchboard:unsent") || db.sets.size > 0);
  assert.equal(await getLicense(tessera, r.record.lid), null, "Tessera cannot see Switchboard's licenses");
});

test("createContext: the real Redis store sends prefixed keys for Switchboard and tessera: keys for Tessera", async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => (sent.push(JSON.parse(init.body)), Response.json({ result: "OK" }));
  try {
    const env = { KV_REST_API_URL: "https://kv.example", KV_REST_API_TOKEN: "t" };
    await createContext(env, APPS.switchboard).store.set("lic:abc", "1");
    await createContext(env, APPS.tessera).store.set("lic:abc", "1");
    // The admin sign-in lives in Tessera's namespace even from Switchboard's context.
    await createContext(env, APPS.switchboard).adminStore.set("adminsess:x", "1");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(sent.map((c) => c[1]), ["switchboard:lic:abc", "tessera:lic:abc", "tessera:adminsess:x"]);
  assert.equal(createContext({}, APPS.switchboard).app.slug, "switchboard");
  // (the store itself, without a context)
  const calls = [];
  const store = createRedisStore({ url: "https://kv.example", token: "t", namespace: "switchboard:", fetch: async (u, i) => (calls.push(JSON.parse(i.body)), Response.json({ result: null })) });
  await store.get("revoked");
  assert.deepEqual(calls[0], ["GET", "switchboard:revoked"]);
});

// ------------------------------------------------------------------ issuing and email

test("a Switchboard purchase issues an SWB1- license, signed for Switchboard, emailed with Switchboard branding", async () => {
  const { switchboard, stripe } = makeBothCtx();
  const session = makeSwbSession();
  stripe.state.sessions.set(session.id, session);
  const res = await stripeWebhook(() => switchboard, swbWebhookRequest(event("checkout.session.completed", session)));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).result, "issued");
  const mail = switchboard.mailer.sent[0];
  const license = /SWB1-[A-Za-z0-9_.-]+/.exec(mail.text)[0];
  assert.equal(verifySwb(license).ok, true);
  assert.equal(verifyLicense(license, tessKeys).ok, false);
  assert.equal(mail.subject, "Your Audio Switchboard license");
  assert.match(mail.text, /https:\/\/www\.conorgriffin\.com\/switchboard\/activate#key=SWB1-/);
  assert.match(mail.html, /switchboard\/icon\.png/);
  assert.doesNotMatch(mail.text + mail.html, /Tessera|tessera/);
  assert.match(mail.idempotencyKey, /^switchboard-license-[0-9a-f]{32}$/);
  assert.equal(stripe.state.metadata.length, 1);
});

test("all five emails are branded for Switchboard and never mention Tessera", () => {
  const rec = { license: swbVectors.license.valid, email: "buyer@example.com", lid: p.lid };
  const a = APPS.switchboard;
  for (const m of [licenseEmail(rec, "s@x.com", a), freeLicenseEmail(rec, "s@x.com", a), reissuedEmail(rec, "s@x.com", a), resendEmail([rec, rec], "s@x.com", a), revokedEmail(rec, "s@x.com", a)]) {
    assert.doesNotMatch(m.subject + m.text + m.html, /tessera/i);
    assert.match(m.subject, /Audio Switchboard/);
    assert.match(m.html, /<title>Audio Switchboard<\/title>/);
  }
  assert.match(revokedEmail(rec, "s@x.com", a).text, /Auto-Switch stays paused/);
  assert.match(revokedEmail(rec, "s@x.com", a).text, /\/switchboard\/buy/);
});

test("license route: serves the Switchboard key and activation URL, and points at /switchboard/license", async () => {
  const { switchboard, stripe } = makeBothCtx();
  const session = makeSwbSession();
  stripe.state.sessions.set(session.id, session);
  const url = (id) => `https://www.conorgriffin.com/api/switchboard/license?session_id=${id}`;
  const res = await licenseForSession(() => switchboard, new Request(url(session.id)));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.license.startsWith("SWB1-"));
  assert.equal(body.activationUrl, `switchboard-direct://activate?key=${encodeURIComponent(body.license)}`);
  const missing = await licenseForSession(() => switchboard, new Request(url("cs_nope000000")));
  assert.equal((await missing.json()).help, "/switchboard/license");
});

// ------------------------------------------------------------------ webhooks: secrets, products, refunds

test("webhook: each endpoint accepts only its own signing secret", async () => {
  const { tessera, switchboard, stripe } = makeBothCtx();
  const swb = makeSwbSession();
  stripe.state.sessions.set(swb.id, swb);
  const ev = event("checkout.session.completed", swb);
  const body = JSON.stringify(ev);
  // Tessera's secret on Switchboard's endpoint, and Switchboard's on Tessera's: both refused.
  const withTessera = swbWebhookRequest(ev, stripeHeader(body)); // signed with STRIPE_WEBHOOK_SECRET
  assert.equal((await stripeWebhook(() => switchboard, withTessera)).status, 400);
  const toTessera = new Request("https://www.conorgriffin.com/api/tessera/stripe-webhook", {
    method: "POST", headers: { "stripe-signature": stripeHeader(body, { secret: "whsec_switchboard_test" }) }, body,
  });
  assert.equal((await stripeWebhook(() => tessera, toTessera)).status, 400);
  assert.equal(switchboard.mailer.sent.length + tessera.mailer.sent.length, 0);
  // A missing secret is a 500, never an accept.
  delete switchboard.env.SWITCHBOARD_STRIPE_WEBHOOK_SECRET;
  assert.equal((await stripeWebhook(() => switchboard, swbWebhookRequest(ev))).status, 500);
});

test("each app fulfils only sessions with its own product", async () => {
  const { tessera, switchboard, stripe, db } = makeBothCtx();
  const swb = makeSwbSession();
  const tess = makeSession();
  stripe.state.sessions.set(swb.id, swb);
  stripe.state.sessions.set(tess.id, tess);
  // Tessera's endpoint is sent the Switchboard purchase (Stripe sends every event to every endpoint that asks for it).
  const a = await stripeWebhook(() => tessera, webhookRequest(event("checkout.session.completed", swb)));
  assert.equal((await a.json()).result, "skipped:wrong_product");
  const b = await stripeWebhook(() => switchboard, swbWebhookRequest(event("checkout.session.completed", tess)));
  assert.equal((await b.json()).result, "skipped:wrong_product");
  assert.equal(tessera.mailer.sent.length + switchboard.mailer.sent.length, 0);
  assert.ok(![...db.strings.keys()].some((k) => k.includes(":lic:")), "no license was minted");
  // The right app does fulfil it.
  assert.equal((await stripeWebhook(() => switchboard, swbWebhookRequest(event("checkout.session.completed", swb)))).status, 200);
  assert.equal(switchboard.mailer.sent.length, 1);
  assert.equal(tessera.mailer.sent.length, 0);
  // A product id that is not configured matches nothing, even a session whose item has no product.
  delete switchboard.env.SWITCHBOARD_STRIPE_PRODUCT_ID;
  const bare = makeSwbSession({ id: "cs_test_bare0001", line_items: { data: [{ price: {} }] } });
  stripe.state.sessions.set(bare.id, bare);
  assert.deepEqual(await issueLicense(switchboard, bare.id), { ok: false, reason: "wrong_product" });
});

test("refunds and disputes only touch licenses of the app whose payment it is", async () => {
  const { tessera, switchboard, stripe, db } = makeBothCtx();
  const swb = makeSwbSession(); // pi_swb1
  const tess = makeSession(); // pi_1
  stripe.state.sessions.set(swb.id, swb);
  stripe.state.sessions.set(tess.id, tess);
  const swbRec = (await issueLicense(switchboard, swb.id)).record;
  const tessRec = (await issueLicense(tessera, tess.id)).record;
  tessera.mailer.sent.length = switchboard.mailer.sent.length = 0;

  // Stripe delivers the Switchboard refund to Tessera's endpoint too: nothing happens there.
  const swbCharge = { id: "ch_swb", amount: 999, amount_refunded: 999, payment_intent: "pi_swb1" };
  stripe.state.charges.set("ch_swb", swbCharge);
  assert.equal(await handleEvent(tessera, event("charge.refunded", swbCharge)), "unknown");
  assert.equal(await handleEvent(tessera, event("charge.dispute.created", { id: "dp", status: "needs_response", payment_intent: "pi_swb1", charge: "ch_swb" })), "unknown");
  assert.equal((await getLicense(switchboard, swbRec.lid)).revokedAt, null);
  assert.equal(tessera.mailer.sent.length, 0);

  // ... and at Switchboard's own endpoint it revokes Switchboard's license only.
  const res = await stripeWebhook(() => switchboard, swbWebhookRequest(event("charge.refunded", swbCharge)));
  assert.equal((await res.json()).result, "revoked");
  assert.ok((await getLicense(switchboard, swbRec.lid)).revokedAt);
  assert.equal((await getLicense(tessera, tessRec.lid)).revokedAt, null);
  assert.deepEqual([...db.sets.get("switchboard:revoked")], [swbRec.lid]);
  assert.equal(db.sets.has("tessera:revoked"), false, "Tessera's revoked set is untouched");
  assert.equal(switchboard.mailer.sent.length, 1);
  assert.match(switchboard.mailer.sent[0].subject, /Audio Switchboard license has been deactivated/);
  assert.match(switchboard.mailer.sent[0].idempotencyKey, /^switchboard-revoked-/);
});

// ------------------------------------------------------------------ revocation list

test("revocations: Switchboard's list is signed with its own key and holds only its own revoked ids", async () => {
  const { tessera, switchboard, stripe } = makeBothCtx();
  const swb = makeSwbSession();
  stripe.state.sessions.set(swb.id, swb);
  const rec = (await issueLicense(switchboard, swb.id)).record;
  await handleEvent(switchboard, event("charge.refunded", { id: "c", amount: 9, amount_refunded: 9, payment_intent: "pi_swb1" }));

  const url = "https://www.conorgriffin.com/api/switchboard/revocations";
  const res = await revocations(() => switchboard, new Request(url));
  assert.equal(res.status, 200);
  const list = await res.json();
  const v = verifyRevocationList(list, swbRevKeys);
  assert.equal(v.ok, true);
  assert.deepEqual(v.payload.revoked, [rec.lid]);
  assert.equal(v.payload.kid, "TR1");
  assert.equal(v.payload.seq, 2); // one revocation: counter 1, plus one
  const tessList = verifyRevocationList(await buildRevocationList(tessera), { TR1: vectors.keys.revocation.publicKeyBase64 });
  assert.deepEqual(tessList.payload.revoked, []);
  assert.equal(tessList.payload.seq, 1);
  // Settings missing for Switchboard: the list can't be signed; a 500, not a list signed with something else.
  delete switchboard.env.SWITCHBOARD_REVOCATION_PRIVATE_KEY;
  assert.equal((await revocations(() => switchboard, new Request(url))).status, 500);
});

// ------------------------------------------------------------------ reconcile

test("reconcile: /api/all/reconcile covers every configured app, skips an unconfigured one, isolates failures", async () => {
  const { tessera, switchboard, stripe } = makeBothCtx();
  const swb = makeSwbSession();
  const tess = makeSession();
  stripe.state.sessions.set(swb.id, swb);
  stripe.state.sessions.set(tess.id, tess); // the webhook never arrived for either
  const byApp = { tessera, switchboard };
  const getCtx = (slug) => byApp[slug];
  const all = (auth = "Bearer cron-secret") => reconcileHandler(getCtx, new Request("https://www.conorgriffin.com/api/all/reconcile", { headers: auth ? { authorization: auth } : {} }));

  assert.equal((await all(null)).status, 401);
  assert.equal((await all("Bearer nope")).status, 401);
  const res = await all();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.apps.tessera.issued, 1);
  assert.equal(body.apps.switchboard.issued, 1);
  assert.equal(tessera.mailer.sent.length, 1);
  assert.equal(switchboard.mailer.sent.length, 1);
  assert.match(switchboard.mailer.sent[0].text, /SWB1-/);
  assert.match(tessera.mailer.sent[0].text, /TSR1-/);

  // Switchboard not configured yet (before launch): skipped, and the cron still succeeds.
  const before = makeBothCtx();
  before.switchboard.env = { ...before.switchboard.env };
  delete before.switchboard.env.SWITCHBOARD_STRIPE_PRODUCT_ID;
  assert.equal(isConfigured(APPS.switchboard, before.switchboard.env), false);
  const r = await reconcileAll((s) => ({ tessera: before.tessera, switchboard: before.switchboard })[s], Object.values(APPS), before.tessera.log);
  assert.deepEqual(r.apps.switchboard, { skipped: "not_configured" });
  assert.equal(r.errors, 0);

  // One app throwing doesn't stop the other, and the run reports failure.
  const fail = makeBothCtx();
  fail.stripe.listCompletedSessions = async () => { throw new Error("boom"); };
  fail.switchboard.stripe = { ...fail.stripe, listCompletedSessions: async () => [] };
  const mixed = await reconcileAll((s) => (s === "tessera" ? fail.tessera : fail.switchboard), Object.values(APPS), fail.tessera.log);
  assert.ok(mixed.errors >= 1);
  assert.equal(mixed.apps.switchboard.errors, 0);
  const crash = await reconcileAll((s) => { if (s === "switchboard") throw new Error("not configured"); return before.tessera; }, Object.values(APPS), before.tessera.log);
  assert.deepEqual(crash.apps.switchboard, { errors: 1, failed: true });
  assert.ok(crash.apps.tessera);

  // The per-app path still reconciles just that app.
  const one = await reconcileHandler(getCtx, new Request("https://www.conorgriffin.com/api/tessera/reconcile", { headers: { authorization: "Bearer cron-secret" } }));
  const oneBody = await one.json();
  assert.equal(oneBody.apps, undefined);
  assert.equal(typeof oneBody.issued, "number");
});

// ------------------------------------------------------------------ buy / download / price

test("go: Switchboard's buy and download use SWITCHBOARD_* settings, count under its own prefix, and stay closed until sales open", async () => {
  const saved = { ...process.env };
  const { switchboard, db } = makeBothCtx();
  Object.assign(process.env, swbEnv);
  const go = (to, url = `https://www.conorgriffin.com/api/switchboard/go?to=${to}`) =>
    goHandler(() => switchboard, new Request(url, { headers: { "user-agent": "Mozilla/5.0 (Macintosh)" } }));
  try {
    assert.equal((await go("buy")).status, 404, "closed");
    process.env.VITE_SWITCHBOARD_SALES_OPEN = "1";
    const buy = await go("buy");
    assert.equal(buy.status, 302);
    assert.equal(buy.headers.get("location"), "https://buy.stripe.com/test_swb");
    const dl = await go("download", "https://www.conorgriffin.com/switchboard/download?to=download&app=switchboard"); // as rewritten
    assert.equal(dl.headers.get("location"), "https://example.com/AudioSwitchboard.dmg");
    const day = new Date(NOW_MS).toISOString().slice(0, 10);
    assert.equal(db.strings.get(`switchboard:clicks:buy:${day}`), "1");
    assert.equal(db.strings.get(`switchboard:clicks:download:${day}`), "1");
    // Tessera's switch doesn't open Switchboard's, and vice versa.
    delete process.env.VITE_SWITCHBOARD_SALES_OPEN;
    process.env.VITE_TESSERA_SALES_OPEN = "1";
    assert.equal((await go("buy")).status, 404);
    assert.equal(salesOpen(process.env, APPS.switchboard), false);
    assert.equal(salesOpen(process.env), true);
  } finally {
    process.env = saved;
  }
});

test("price: each app reads its own product and keeps its own cache", async () => {
  resetPriceCache();
  const { tessera, switchboard, stripe } = makeBothCtx();
  const asked = [];
  stripe.retrieveProductPrices = async (id) => (asked.push(id), id === SWB_PRODUCT_ID ? { default: "eur", amounts: { eur: 999, gbp: 899 } } : { default: "usd", amounts: { usd: 999 } });
  const saved = { ...process.env };
  Object.assign(tessera.env, { VITE_TESSERA_SALES_OPEN: "1" });
  Object.assign(switchboard.env, { VITE_SWITCHBOARD_SALES_OPEN: "1" });
  try {
    const swb = await appPrice(() => switchboard, new Request("https://www.conorgriffin.com/api/switchboard/price", { headers: { "x-vercel-ip-country": "GB" } }));
    assert.deepEqual(await swb.json(), { currency: "gbp", amount: 899 });
    const tess = await appPrice(() => tessera, new Request("https://www.conorgriffin.com/api/tessera/price"));
    assert.deepEqual(await tess.json(), { currency: "usd", amount: 999 });
    await appPrice(() => switchboard, new Request("https://www.conorgriffin.com/api/switchboard/price"));
    assert.deepEqual(asked, ["prod_switchboard", "prod_tessera"], "second Switchboard call came from the cache");
    switchboard.env.VITE_SWITCHBOARD_SALES_OPEN = "0";
    assert.equal((await appPrice(() => switchboard, new Request("https://www.conorgriffin.com/api/switchboard/price"))).status, 404);
  } finally {
    process.env = saved;
    resetPriceCache();
  }
});

// ------------------------------------------------------------------ admin

const SWB_SECRET = "swb-admin-secret-0123456789abcdef0123456789abcdef";
const TESS_SECRET = "admin-secret-0123456789abcdef0123456789abcdef";
const adminCall = (ctx, app, body, auth) =>
  adminHandler(() => ctx, new Request(`https://www.conorgriffin.com/api/${app}/admin`, {
    method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body),
  }));

test("admin: each app has its own bearer secret, its own records and its own license format", async () => {
  const { tessera, switchboard, stripe } = makeBothCtx();
  tessera.env.TESSERA_ADMIN_SECRET = TESS_SECRET;
  switchboard.env.SWITCHBOARD_ADMIN_SECRET = SWB_SECRET;
  const swb = makeSwbSession();
  const tess = makeSession();
  stripe.state.sessions.set(swb.id, swb);
  stripe.state.sessions.set(tess.id, tess);
  const swbRec = (await issueLicense(switchboard, swb.id)).record;
  const tessRec = (await issueLicense(tessera, tess.id)).record;

  // Right secret works; the other app's secret doesn't.
  const ok = await adminCall(switchboard, "switchboard", { action: "lookup", target: swbRec.lid }, `Bearer ${SWB_SECRET}`);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).licenses[0].lid, swbRec.lid);
  assert.equal((await adminCall(switchboard, "switchboard", { action: "lookup", target: swbRec.lid }, `Bearer ${TESS_SECRET}`)).status, 401);
  assert.equal((await adminCall(tessera, "tessera", { action: "lookup", target: tessRec.lid }, `Bearer ${SWB_SECRET}`)).status, 401);
  // A Tessera license id is not found in Switchboard's records.
  const miss = await adminCall(switchboard, "switchboard", { action: "lookup", target: tessRec.lid }, `Bearer ${SWB_SECRET}`);
  assert.deepEqual((await miss.json()).licenses, []);
  // Pasting a license key: SWB1- is understood by Switchboard's admin, a TSR1- key is not.
  assert.deepEqual(parseAdminTarget(swbRec.license, APPS.switchboard), { lid: swbRec.lid });
  assert.equal(parseAdminTarget(tessRec.license, APPS.switchboard), null);
  assert.deepEqual(parseAdminTarget(tessRec.license), { lid: tessRec.lid });
  assert.equal(parseAdminTarget(swbRec.license), null);
  // Revoking affects only Switchboard's set.
  const rv = await adminCall(switchboard, "switchboard", { action: "revoke", target: swbRec.license, reason: "leaked" }, `Bearer ${SWB_SECRET}`);
  assert.equal((await rv.json()).result, "revoked");
  assert.equal((await getLicense(tessera, tessRec.lid)).revokedAt, null);
});

test("admin: issue_free and stats are per app", async () => {
  const { switchboard } = makeBothCtx();
  switchboard.env.SWITCHBOARD_ADMIN_SECRET = SWB_SECRET;
  const free = await adminCall(switchboard, "switchboard", { action: "issue_free", email: "friend@example.com", note: "beta tester" }, `Bearer ${SWB_SECRET}`);
  const body = await free.json();
  assert.equal(body.result, "issued");
  assert.ok(body.license.startsWith("SWB1-"));
  assert.equal(verifySwb(body.license).ok, true);
  assert.match(switchboard.mailer.sent[0].subject, /^Your free Audio Switchboard license$/);
  assert.doesNotMatch(switchboard.mailer.sent[0].text + switchboard.mailer.sent[0].html, /beta tester/);
  const stats = await adminCall(switchboard, "switchboard", { action: "stats" }, `Bearer ${SWB_SECRET}`);
  assert.equal((await stats.json()).stripeProductId, SWB_PRODUCT_ID);
});

test("admin: with no Switchboard secret or allowlist the Switchboard admin route is a 404 (Tessera's settings don't open it)", async () => {
  const { tessera, switchboard } = makeBothCtx();
  tessera.env.TESSERA_ADMIN_SECRET = TESS_SECRET;
  tessera.env.TESSERA_ADMIN_EMAILS = "me@example.com";
  switchboard.env.TESSERA_ADMIN_SECRET = TESS_SECRET; // a stray copy of Tessera's variables in Switchboard's context
  switchboard.env.TESSERA_ADMIN_EMAILS = "me@example.com";
  const res = await adminCall(switchboard, "switchboard", { action: "stats" }, `Bearer ${TESS_SECRET}`);
  assert.equal(res.status, 404);
});

test("admin sign-in routes exist for Tessera only (one Google login, one redirect URI)", async () => {
  const { switchboard } = makeBothCtx();
  Object.assign(switchboard.env, { GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s", TESSERA_ADMIN_EMAILS: "me@example.com", TESSERA_ADMIN_SESSION_SECRET: "x".repeat(32), SWITCHBOARD_ADMIN_EMAILS: "me@example.com" });
  const res = await adminLogin(() => switchboard, new Request("https://www.conorgriffin.com/api/switchboard/admin-login"));
  assert.equal(res.status, 404);
});

test("admin: a Google session only works for an app whose own allowlist has the email", async () => {
  const { signValue, startSession, SESSION_COOKIE } = await import("../adminAuth.js");
  const { tessera, switchboard } = makeBothCtx();
  const SECRET = "s".repeat(40);
  for (const c of [tessera, switchboard]) {
    Object.assign(c.env, { GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s", TESSERA_ADMIN_SESSION_SECRET: SECRET, TESSERA_ADMIN_EMAILS: "me@example.com" });
  }
  const { sid } = await startSession(switchboard, "me@example.com"); // stored in Tessera's namespace via adminStore
  const cookie = `${SESSION_COOKIE}=${signValue({ email: "me@example.com", sid, exp: Math.floor(NOW_MS / 1000) + 3600, v: 2 }, SECRET, "session")}`;
  const post = (ctx, app) => adminHandler(() => ctx, new Request(`https://www.conorgriffin.com/api/${app}/admin`, {
    method: "POST", headers: { cookie, origin: "https://www.conorgriffin.com", "content-type": "application/json" }, body: JSON.stringify({ action: "stats" }),
  }));
  assert.equal((await post(tessera, "tessera")).status, 200, "allowed for Tessera");
  assert.equal((await post(switchboard, "switchboard")).status, 404, "Switchboard has no allowlist: the route does not exist");
  switchboard.env.SWITCHBOARD_ADMIN_EMAILS = "someone-else@example.com";
  assert.equal((await post(switchboard, "switchboard")).status, 401, "email not on Switchboard's allowlist");
  switchboard.env.SWITCHBOARD_ADMIN_EMAILS = "ME@example.com";
  assert.equal((await post(switchboard, "switchboard")).status, 200, "on both lists");
});

// ------------------------------------------------------------------ sales spike alert

test("a sales spike emails the owner once at the threshold, per app, and never fails a sale", async () => {
  const { switchboard, tessera, stripe } = makeBothCtx();
  const mine = (ctx) => ctx.mailer.sent.filter((m) => /sales in one hour/.test(m.subject));
  for (let i = 0; i < 6; i++) {
    const s = makeSwbSession({ id: `cs_spike_${i}`, payment_intent: `pi_spike_${i}`, customer_details: { email: `b${i}@example.com` } });
    stripe.state.sessions.set(s.id, s);
    assert.equal((await issueLicense(switchboard, s.id)).ok, true);
  }
  const alerts = mine(switchboard);
  assert.equal(alerts.length, 1, "one alert at the 5th sale, none at the 6th");
  assert.equal(alerts[0].to, "support@example.com");
  assert.match(alerts[0].subject, /^Audio Switchboard: 5 sales in one hour$/);
  assert.match(alerts[0].text, /refund them in Stripe/);
  assert.equal(mine(tessera).length, 0, "Tessera's count is separate");

  // A failing alert mail must not fail the sale.
  const { switchboard: sb2, stripe: st2 } = makeBothCtx();
  sb2.env.SALES_ALERT_PER_HOUR = "1";
  const realSend = sb2.mailer.send.bind(sb2.mailer);
  sb2.mailer.send = async (m) => { if (/sales in one hour/.test(m.subject)) throw new Error("boom"); return realSend(m); };
  const s = makeSwbSession({ id: "cs_spike_x" });
  st2.state.sessions.set(s.id, s);
  assert.equal((await issueLicense(sb2, s.id)).ok, true);
});

test("a failing revocation list says which setting is wrong, never its value", async () => {
  const req = new Request("https://www.conorgriffin.com/api/switchboard/revocations");
  const cases = [
    [undefined, "signing_key_missing"],
    [swbVectors.keys.revocation.publicKeyBase64, "signing_key_invalid"], // a public key pasted by mistake
    ["private key: MC4CAQAwBQYDK2VwBCIEIA==", "signing_key_invalid"],
  ];
  for (const [value, reason] of cases) {
    const { switchboard } = makeBothCtx();
    switchboard.env.SWITCHBOARD_REVOCATION_PRIVATE_KEY = value;
    switchboard.log = { error() {}, warn() {}, info() {} };
    const res = await revocations(() => switchboard, req);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "try_again", reason });
  }
});
