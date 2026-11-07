// Licence issuing, revocation and the event rules. Everything takes a context
// `ctx = { env, store, stripe, mailer, now(), log }` so tests can fake each part.
//
// Redis keys: lic:<lid>, session:<cs_id>, pi:<pi_id>, email:<sha256(email)>, revoked (set),
// revocations:seq, evt:<event id>, unsent (set of lids whose email failed), ignored:<cs_id>.
import { emailHash, randomLicenseId, signLicense, signRevocationList } from "./crypto.js";
import { activationUrl, licenseEmail, resendEmail, revokedEmail } from "./email.js";

const DAY = 86400;
export const SESSION_MAX_AGE_SECONDS = 7 * DAY;

const licKey = (/** @type {string} */ lid) => `lic:${lid}`;

/** @typedef {{ lid: string, email: string, license: string, sessionId: string, paymentIntent: string | null, issuedAt: number, revokedAt: number | null, revokeReason: string | null, emailedAt?: number | null, indexedAt?: number | null }} LicenseRecord */

/** @returns {Promise<LicenseRecord | null>} */
export async function getLicense(/** @type {any} */ ctx, /** @type {string} */ lid) {
  const raw = await ctx.store.get(licKey(lid));
  return raw ? JSON.parse(raw) : null;
}

async function putLicense(/** @type {any} */ ctx, /** @type {LicenseRecord} */ rec) {
  await ctx.store.set(licKey(rec.lid), JSON.stringify(rec));
}

/** Read-modify-write on a record, from a fresh read. */
async function patchLicense(/** @type {any} */ ctx, /** @type {string} */ lid, /** @type {(r: LicenseRecord) => void} */ fn) {
  const rec = await getLicense(ctx, lid);
  if (!rec) return null;
  fn(rec);
  await putLicense(ctx, rec);
  return rec;
}

const nowSeconds = (/** @type {any} */ ctx) => Math.floor(ctx.now() / 1000);

/** True when the (expanded) session contains the Tessera product. */
export function sessionHasProduct(/** @type {any} */ session, /** @type {string} */ productId) {
  const items = session?.line_items?.data ?? [];
  return items.some((/** @type {any} */ li) => {
    const p = li?.price?.product;
    return (typeof p === "string" ? p : p?.id) === productId;
  });
}

const idOf = (/** @type {any} */ v) => (typeof v === "string" ? v : v?.id ?? null);

/**
 * Issues (or returns) the licence for a Checkout Session. Idempotent per session.
 * @param {any} ctx
 * @param {string} sessionId
 * @param {{ maxAgeSeconds?: number }} [opts]
 * @returns {Promise<{ ok: true, record: LicenseRecord, created: boolean } | { ok: false, reason: "not_found" | "too_old" | "unpaid" | "wrong_product" | "no_email" }>}
 */
export async function issueLicense(ctx, sessionId, opts = {}) {
  const { store, stripe, env } = ctx;
  const existingLid = await store.get(`session:${sessionId}`);
  if (existingLid) {
    const rec = await getLicense(ctx, existingLid);
    if (rec) {
      if (opts.maxAgeSeconds && nowSeconds(ctx) - rec.issuedAt > opts.maxAgeSeconds) return { ok: false, reason: "too_old" };
      if (rec.revokedAt) return { ok: false, reason: "not_found" };
      if (!rec.indexedAt) await finalize(ctx, rec); // an earlier attempt died part-way
      return { ok: true, record: (await getLicense(ctx, rec.lid)) ?? rec, created: false };
    }
  }
  if (await store.get(`ignored:${sessionId}`)) return { ok: false, reason: "wrong_product" };

  const session = await stripe.retrieveSession(sessionId);
  if (!session) return { ok: false, reason: "not_found" };
  if (opts.maxAgeSeconds && nowSeconds(ctx) - Number(session.created) > opts.maxAgeSeconds) return { ok: false, reason: "too_old" };
  if (session.status !== "complete" || session.payment_status !== "paid") return { ok: false, reason: "unpaid" };
  if (!sessionHasProduct(session, env.TESSERA_STRIPE_PRODUCT_ID)) {
    await store.set(`ignored:${sessionId}`, "1", { ex: 4 * DAY });
    return { ok: false, reason: "wrong_product" };
  }
  const email = String(session.customer_details?.email ?? session.customer_email ?? "").trim();
  if (!email) return { ok: false, reason: "no_email" };

  const lid = randomLicenseId();
  const issuedAt = nowSeconds(ctx);
  const license = signLicense({ privateKey: env.TESSERA_LICENSE_PRIVATE_KEY, kid: env.TESSERA_LICENSE_KID || "L1", lid, email, iat: issuedAt });
  /** @type {LicenseRecord} */
  const rec = {
    lid, email, license, sessionId, paymentIntent: idOf(session.payment_intent),
    issuedAt, revokedAt: null, revokeReason: null, emailedAt: null, indexedAt: null,
  };
  await putLicense(ctx, rec);
  // Claim the session atomically: if a concurrent call (webhook vs thanks page) won, use its licence.
  if (!(await store.set(`session:${sessionId}`, lid, { nx: true }))) {
    await store.del(licKey(lid));
    const winner = await store.get(`session:${sessionId}`);
    const winnerRec = winner ? await getLicense(ctx, winner) : null;
    if (!winnerRec) throw new Error("session claimed but licence missing");
    return { ok: true, record: winnerRec, created: false };
  }
  await finalize(ctx, rec);
  return { ok: true, record: (await getLicense(ctx, lid)) ?? rec, created: true };
}

/** Index, dashboard metadata and email. Safe to run more than once. */
async function finalize(/** @type {any} */ ctx, /** @type {LicenseRecord} */ rec) {
  const { store, stripe } = ctx;
  if (rec.paymentIntent) await store.set(`pi:${rec.paymentIntent}`, rec.lid);
  await store.sadd(`email:${emailHash(rec.email)}`, rec.lid);
  if (!rec.emailedAt) await store.sadd("unsent", rec.lid);
  await patchLicense(ctx, rec.lid, (r) => { r.indexedAt = nowSeconds(ctx); });
  await setStripeMetadata(ctx, rec.paymentIntent, { license_id: rec.lid, license_issued_at: String(rec.issuedAt) });
  await sendLicenseEmail(ctx, rec.lid);
}

/** Never throws: metadata is a convenience for the Stripe dashboard. */
async function setStripeMetadata(/** @type {any} */ ctx, /** @type {string | null} */ paymentIntent, /** @type {Record<string, string>} */ metadata) {
  if (!paymentIntent) return;
  try {
    await ctx.stripe.updatePaymentIntentMetadata(paymentIntent, metadata);
  } catch (e) {
    ctx.log.warn("stripe metadata update failed", { error: errName(e) });
  }
}

const errName = (/** @type {any} */ e) => (e && e.name) || "Error";

/** Sends the licence email once. Failure is logged and left for the cron. Returns whether it was sent. */
export async function sendLicenseEmail(/** @type {any} */ ctx, /** @type {string} */ lid) {
  const rec = await getLicense(ctx, lid);
  if (!rec || rec.emailedAt) return false;
  try {
    await ctx.mailer.send({ to: rec.email, ...licenseEmail(rec, ctx.env.SUPPORT_EMAIL), idempotencyKey: `tessera-license-${lid}` });
  } catch (e) {
    ctx.log.warn("licence email failed", { error: errName(e) });
    return false;
  }
  await patchLicense(ctx, lid, (r) => { r.emailedAt = nowSeconds(ctx); });
  await ctx.store.srem("unsent", lid);
  return true;
}

/** Retries emails that failed. @returns {Promise<number>} how many were sent */
export async function retryUnsentEmails(/** @type {any} */ ctx, limit = 50) {
  let sent = 0;
  const lids = (await ctx.store.smembers("unsent")).slice(0, limit);
  for (const lid of lids) {
    const rec = await getLicense(ctx, lid);
    if (!rec || rec.revokedAt) { await ctx.store.srem("unsent", lid); continue; }
    if (await sendLicenseEmail(ctx, lid)) sent++;
  }
  return sent;
}

// ---------------------------------------------------------------- revocation

/** Marks a licence revoked. Idempotent. @returns {Promise<"revoked" | "already" | "unknown">} */
export async function revokeLicense(/** @type {any} */ ctx, /** @type {string} */ lid, /** @type {"refund" | "dispute"} */ reason) {
  const rec = await getLicense(ctx, lid);
  if (!rec) return "unknown";
  const { store } = ctx;
  if (rec.revokedAt) {
    // Repair a half-finished earlier revoke; the first reason stays.
    if (await store.sadd("revoked", lid)) await store.incr("revocations:seq");
    return "already";
  }
  await store.sadd("revoked", lid);
  await store.incr("revocations:seq");
  rec.revokedAt = nowSeconds(ctx);
  rec.revokeReason = reason;
  await putLicense(ctx, rec);
  await store.srem("unsent", lid);
  await setStripeMetadata(ctx, rec.paymentIntent, { license_revoked_at: String(rec.revokedAt), license_revoke_reason: reason });
  try {
    await ctx.mailer.send({ to: rec.email, ...revokedEmail(), idempotencyKey: `tessera-revoked-${lid}` });
  } catch (e) {
    ctx.log.warn("revocation email failed", { error: errName(e) });
  }
  return "revoked";
}

/** Un-revokes, only when the revocation reason was a dispute. No email. @returns {Promise<"restored" | "skipped" | "unknown">} */
export async function unrevokeDisputeLicense(/** @type {any} */ ctx, /** @type {string} */ lid) {
  const rec = await getLicense(ctx, lid);
  if (!rec) return "unknown";
  if (!rec.revokedAt || rec.revokeReason !== "dispute") return "skipped";
  await ctx.store.srem("revoked", lid);
  await ctx.store.incr("revocations:seq");
  rec.revokedAt = null;
  rec.revokeReason = null;
  await putLicense(ctx, rec);
  await setStripeMetadata(ctx, rec.paymentIntent, { license_revoked_at: "", license_revoke_reason: "" });
  return "restored";
}

/** The signed list served at /api/tessera/revocations. */
export async function buildRevocationList(/** @type {any} */ ctx) {
  const seq = Number((await ctx.store.get("revocations:seq")) ?? 0); // read first: a newer list never carries an older seq
  const revoked = (await ctx.store.smembers("revoked")).slice().sort();
  return signRevocationList({
    privateKey: ctx.env.TESSERA_REVOCATION_PRIVATE_KEY,
    kid: ctx.env.TESSERA_REVOCATION_KID || "R1",
    seq: seq + 1, // starts at 1 and still strictly increases with every change
    generated: nowSeconds(ctx),
    revoked,
  });
}

// ---------------------------------------------------------------- lookups and events

/** Finds our licence id for a Stripe payment, with fallbacks for sessions that carried no PaymentIntent. */
async function findLid(/** @type {any} */ ctx, /** @type {{ paymentIntent?: any, charge?: any }} */ { paymentIntent, charge }) {
  const { store, stripe } = ctx;
  let pi = idOf(paymentIntent);
  if (pi) {
    const hit = await store.get(`pi:${pi}`);
    if (hit) return hit;
  }
  const chargeId = idOf(charge);
  if (!pi && chargeId) {
    const ch = await stripe.retrieveCharge(chargeId);
    pi = idOf(ch?.payment_intent);
    if (pi) {
      const hit = await store.get(`pi:${pi}`);
      if (hit) return hit;
    }
  }
  if (pi) {
    const sid = await stripe.findSessionIdByPaymentIntent(pi);
    const lid = sid ? await store.get(`session:${sid}`) : null;
    if (lid) {
      await store.set(`pi:${pi}`, lid);
      return lid;
    }
  }
  return null;
}

/** Full refund → revoke. Partial refund → nothing. */
export async function applyCharge(/** @type {any} */ ctx, /** @type {any} */ charge) {
  if (!(Number(charge.amount) > 0) || !(Number(charge.amount_refunded) >= Number(charge.amount))) return "ignored";
  const lid = await findLid(ctx, { paymentIntent: charge.payment_intent, charge: charge.id });
  if (!lid) { ctx.log.warn("refund for an unknown payment"); return "unknown"; }
  return revokeLicense(ctx, lid, "refund");
}

/** Dispute opened (or lost) → revoke. Closed as won → un-revoke if the dispute caused the revocation. */
export async function applyDispute(/** @type {any} */ ctx, /** @type {any} */ dispute) {
  // `warning_*` statuses are card-network inquiries, not chargebacks yet: they don't change anything.
  if (String(dispute.status ?? "").startsWith("warning_")) return "ignored";
  const lid = await findLid(ctx, { paymentIntent: dispute.payment_intent, charge: dispute.charge });
  if (!lid) { ctx.log.warn("dispute for an unknown payment"); return "unknown"; }
  if (dispute.status === "won") return unrevokeDisputeLicense(ctx, lid);
  return revokeLicense(ctx, lid, "dispute");
}

/**
 * Routes one verified Stripe event. Throws on transient failures (the webhook then returns 500 so Stripe retries).
 * @returns {Promise<string>} a short outcome label
 */
export async function handleEvent(/** @type {any} */ ctx, /** @type {any} */ event) {
  const obj = event?.data?.object;
  switch (event?.type) {
    case "checkout.session.completed":
      if (obj.payment_status !== "paid") return "ignored";
      return outcome(await issueLicense(ctx, obj.id));
    case "checkout.session.async_payment_succeeded":
      return outcome(await issueLicense(ctx, obj.id));
    case "charge.refunded":
      return applyCharge(ctx, obj);
    case "charge.dispute.created":
      return applyDispute(ctx, obj);
    case "charge.dispute.closed":
      // Only a won dispute changes anything here: a lost one was already revoked when it opened.
      return obj.status === "won" ? applyDispute(ctx, obj) : "ignored";
    default:
      return "ignored";
  }
}

const outcome = (/** @type {any} */ r) => (r.ok ? (r.created ? "issued" : "exists") : `skipped:${r.reason}`);

// ---------------------------------------------------------------- resend by email

/**
 * Emails every non-revoked licence for an address. Never reveals whether any exist.
 * @returns {Promise<"sent" | "none" | "limited" | "invalid">}
 */
export async function resendLicenses(/** @type {any} */ ctx, /** @type {string} */ rawEmail, /** @type {string} */ ipHash) {
  const email = String(rawEmail ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "invalid";
  const hash = emailHash(email);
  const [perEmail, perIp] = await Promise.all([
    ctx.store.incrWithExpiry(`rl:email:${hash}`, 3600),
    ctx.store.incrWithExpiry(`rl:ip:${ipHash}`, 3600),
  ]);
  if (perEmail > 3 || perIp > 10) return "limited";
  const lids = await ctx.store.smembers(`email:${hash}`);
  const records = [];
  for (const lid of lids) {
    const rec = await getLicense(ctx, lid);
    if (rec && !rec.revokedAt) records.push(rec);
  }
  if (records.length === 0) return "none";
  records.sort((a, b) => a.issuedAt - b.issuedAt);
  try {
    await ctx.mailer.send({ to: records[0].email, ...resendEmail(records, ctx.env.SUPPORT_EMAIL) });
  } catch (e) {
    ctx.log.warn("resend email failed", { error: errName(e) });
    return "none";
  }
  return "sent";
}

// ---------------------------------------------------------------- reconcile

/**
 * Safety net for missed webhooks: last 3 days of sessions, refunds and disputes, plus unsent emails.
 * @returns {Promise<{ issued: number, revoked: number, restored: number, emailed: number, errors: number }>}
 */
export async function reconcile(/** @type {any} */ ctx) {
  const since = nowSeconds(ctx) - 3 * DAY;
  const result = { issued: 0, revoked: 0, restored: 0, emailed: 0, errors: 0 };
  const guard = async (/** @type {() => Promise<void>} */ fn) => {
    try { await fn(); } catch (e) { result.errors++; ctx.log.error("reconcile step failed", { error: errName(e) }); }
  };

  await guard(async () => {
    for (const s of await ctx.stripe.listCompletedSessions(since)) {
      if (s.payment_status !== "paid") continue;
      await guard(async () => {
        if (await ctx.store.get(`session:${s.id}`)) return;
        const r = await issueLicense(ctx, s.id);
        if (r.ok && r.created) result.issued++;
      });
    }
  });
  await guard(async () => {
    const seen = new Set();
    for (const refund of await ctx.stripe.listRefunds(since)) {
      const chargeId = idOf(refund.charge);
      if (refund.status !== "succeeded" || !chargeId || seen.has(chargeId)) continue;
      seen.add(chargeId);
      await guard(async () => {
        const charge = await ctx.stripe.retrieveCharge(chargeId);
        if (charge && (await applyCharge(ctx, charge)) === "revoked") result.revoked++;
      });
    }
  });
  await guard(async () => {
    for (const d of await ctx.stripe.listDisputes(since)) {
      await guard(async () => {
        const r = await applyDispute(ctx, d);
        if (r === "revoked") result.revoked++;
        if (r === "restored") result.restored++;
      });
    }
  });
  await guard(async () => { result.emailed = await retryUnsentEmails(ctx); });
  return result;
}

export { activationUrl };
