// Licence issuing, revocation and the event rules. Everything takes a context
// `ctx = { env, store, stripe, mailer, now(), log }` so tests can fake each part.
//
// Redis keys: lic:<lid>, session:<cs_id> (Stripe purchases only; free licences have none), pi:<pi_id>, email:<sha256(email)>, revoked (set),
// revocations:seq, evt:<event id>, unsent (set of lids whose email failed), ignored:<cs_id>.
import { emailHash, randomLicenseId, signLicense, signRevocationList } from "./crypto.js";
import { activationUrl, freeLicenseEmail, licenseEmail, reissuedEmail, resendEmail, revokedEmail } from "./email.js";

const DAY = 86400;
export const SESSION_MAX_AGE_SECONDS = 7 * DAY;

const licKey = (/** @type {string} */ lid) => `lic:${lid}`;

/** @typedef {"refund" | "dispute" | "leaked" | "manual" | "reissued"} RevokeReason */
/**
 * `replacedBy` is set on a record that was reissued; `reissuedFrom` on the replacement. `purchasedAt` is the Checkout
 * Session's created time (copied into replacements). `paymentRevokedAt` / `paymentRevokeReason` record that the
 * payment itself was refunded or disputed, separately from `revokeReason` (which is only the first reason).
 * A free licence (given by the admin) has `free: true`, a private `freeNote`, `freeBy` ("cli" or the admin's Google email),
 * `sessionId` "free:<lid>" and no payment intent; it has no `session:` key. A reissue carries the three `free*` fields over.
 * @typedef {{ lid: string, email: string, license: string, sessionId: string, paymentIntent: string | null, issuedAt: number, purchasedAt?: number, revokedAt: number | null, revokeReason: string | null, paymentRevokedAt?: number | null, paymentRevokeReason?: "refund" | "dispute" | null, emailedAt?: number | null, indexedAt?: number | null, replacedBy?: string, reissuedFrom?: string, free?: boolean, freeNote?: string | null, freeBy?: string }} LicenseRecord
 */

/** Revocations that happen on our side: no email to the customer. */
const SILENT_REASONS = new Set(["leaked", "manual", "reissued"]);

const isPaymentReason = (/** @type {unknown} */ r) => r === "refund" || r === "dispute";

/**
 * Whether the payment behind a record was refunded or disputed: the dedicated fields, or (records revoked before
 * those fields existed) a refund/dispute `revokeReason`.
 * @param {Partial<LicenseRecord>} rec
 * @returns {{ reason: "refund" | "dispute", at: number | null } | null}
 */
export function paymentRevocation(rec) {
  if (isPaymentReason(rec.paymentRevokeReason)) return { reason: /** @type {"refund" | "dispute"} */ (rec.paymentRevokeReason), at: rec.paymentRevokedAt ?? rec.revokedAt ?? null };
  if (rec.revokedAt && isPaymentReason(rec.revokeReason)) return { reason: /** @type {"refund" | "dispute"} */ (rec.revokeReason), at: rec.revokedAt };
  return null;
}

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
 * Generates a fresh licence id, signs the licence and builds the (unsaved) record. Shared by first issue and reissue.
 * @param {any} ctx
 * @param {{ email: string, sessionId: string | ((lid: string) => string), paymentIntent: string | null, reissuedFrom?: string, purchasedAt?: number, free?: Pick<LicenseRecord, "free" | "freeNote" | "freeBy"> }} p
 * @returns {LicenseRecord}
 */
function mintLicense(ctx, { email, sessionId, paymentIntent, reissuedFrom, purchasedAt, free }) {
  const { env } = ctx;
  const lid = randomLicenseId();
  const issuedAt = nowSeconds(ctx);
  const license = signLicense({ privateKey: env.TESSERA_LICENSE_PRIVATE_KEY, kid: env.TESSERA_LICENSE_KID || "L1", lid, email, iat: issuedAt });
  /** @type {LicenseRecord} */
  const rec = {
    lid, email, license, sessionId: typeof sessionId === "function" ? sessionId(lid) : sessionId, paymentIntent,
    issuedAt, purchasedAt: purchasedAt ?? issuedAt, revokedAt: null, revokeReason: null, emailedAt: null, indexedAt: null,
  };
  if (reissuedFrom) rec.reissuedFrom = reissuedFrom;
  if (free?.free) Object.assign(rec, { free: true, freeNote: free.freeNote ?? null, freeBy: free.freeBy });
  return rec;
}

/**
 * Issues (or returns) the licence for a Checkout Session. Idempotent per session.
 * @param {any} ctx
 * @param {string} sessionId
 * @param {{ maxAgeSeconds?: number, refuseReissued?: boolean }} [opts] `maxAgeSeconds` is measured from the purchase
 *   (the Checkout Session's created time), never from a replacement's issue time. `refuseReissued` (public lookups):
 *   a session whose licence was reissued answers "not_found", so an old thanks-page link never serves the new key.
 * @returns {Promise<{ ok: true, record: LicenseRecord, created: boolean } | { ok: false, reason: "not_found" | "too_old" | "unpaid" | "wrong_product" | "no_email" }>}
 */
export async function issueLicense(ctx, sessionId, opts = {}) {
  const { store, stripe, env } = ctx;
  const existingLid = await store.get(`session:${sessionId}`);
  if (existingLid) {
    const rec = await getLicense(ctx, existingLid);
    if (rec) {
      if (opts.refuseReissued && rec.reissuedFrom) return { ok: false, reason: "not_found" };
      if (opts.maxAgeSeconds && nowSeconds(ctx) - (rec.purchasedAt ?? rec.issuedAt) > opts.maxAgeSeconds) return { ok: false, reason: "too_old" };
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

  const created = Number(session.created);
  const rec = mintLicense(ctx, { email, sessionId, paymentIntent: idOf(session.payment_intent), purchasedAt: created > 0 ? created : undefined });
  const lid = rec.lid;
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
  await setStripeMetadata(ctx, rec.paymentIntent, {
    license_id: rec.lid,
    license_issued_at: String(rec.issuedAt),
    // The metadata belongs to the payment: a replacement must not inherit the old key's revoked marks.
    ...(rec.reissuedFrom ? { license_revoked_at: "", license_revoke_reason: "" } : {}),
  });
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
/** Log fields for a mailer failure. The message is only included for our own mailer errors, which never hold addresses, keys or bodies. */
const mailFail = (/** @type {any} */ e) => (e && e.mailer === true ? { error: errName(e), detail: String(e.message).slice(0, 200) } : { error: errName(e) });

/** Sends the licence email once. Failure is logged and left for the cron. Returns whether it was sent. */
export async function sendLicenseEmail(/** @type {any} */ ctx, /** @type {string} */ lid) {
  const rec = await getLicense(ctx, lid);
  if (!rec || rec.emailedAt) return false;
  try {
    const make = rec.reissuedFrom ? reissuedEmail : rec.free ? freeLicenseEmail : licenseEmail;
    const message = make(rec, ctx.env.SUPPORT_EMAIL);
    await ctx.mailer.send({ to: rec.email, ...message, idempotencyKey: `tessera-license-${lid}` });
  } catch (e) {
    ctx.log.warn("licence email failed", mailFail(e));
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

/**
 * Revokes one record. `primary` marks the record the payment event resolved to: only it gets the customer email and
 * the Stripe metadata update (chain members share the same payment). For a refund or dispute the payment outcome is
 * recorded in `paymentRevokedAt` / `paymentRevokeReason` even when the record was already revoked for another reason,
 * so unrevoke and reissue can still see it.
 * @param {any} ctx @param {string} lid @param {RevokeReason} reason @param {boolean} primary
 * @returns {Promise<"revoked" | "already" | "unknown">}
 */
async function revokeOne(ctx, lid, reason, primary) {
  const rec = await getLicense(ctx, lid);
  if (!rec) return "unknown";
  const { store } = ctx;
  const payment = isPaymentReason(reason);
  const before = paymentRevocation(rec);
  let changed = false; // something worth reporting (the record newly revoked, or the payment outcome newly recorded)
  let dirty = false;

  if (payment && !before) {
    rec.paymentRevokedAt = nowSeconds(ctx);
    rec.paymentRevokeReason = /** @type {"refund" | "dispute"} */ (reason);
    changed = dirty = true;
  } else if (payment && before?.reason === "dispute" && reason === "refund") {
    // A refund outranks a dispute: a won dispute must not bring the key back.
    rec.paymentRevokeReason = "refund";
    rec.paymentRevokedAt ??= before.at;
    if (rec.revokeReason === "dispute") rec.revokeReason = "refund";
    dirty = true;
  }

  if (rec.revokedAt) {
    // Repair a half-finished earlier revoke; the first reason stays (the payment outcome is kept separately).
    if (await store.sadd("revoked", lid)) await store.incr("revocations:seq");
  } else {
    await store.sadd("revoked", lid);
    await store.incr("revocations:seq");
    rec.revokedAt = nowSeconds(ctx);
    rec.revokeReason = reason;
    changed = dirty = true;
  }
  if (dirty) {
    await putLicense(ctx, rec);
    await store.srem("unsent", lid);
    if (primary) {
      await setStripeMetadata(ctx, rec.paymentIntent, {
        license_revoked_at: String(rec.revokedAt),
        license_revoke_reason: payment ? reason : String(rec.revokeReason),
      });
    }
  }
  // The customer hears about a refund or dispute once, however many chain members or earlier admin reasons there are.
  if (primary && payment && !before) {
    try {
      await ctx.mailer.send({ to: rec.email, ...revokedEmail(rec, ctx.env.SUPPORT_EMAIL), idempotencyKey: `tessera-revoked-${lid}` });
    } catch (e) {
      ctx.log.warn("revocation email failed", mailFail(e));
    }
  }
  return changed ? "revoked" : "already";
}

/** Records connected to `rec` by a reissue: its replacement, the record it replaced, and a reissue claimed but not yet linked. */
async function chainNeighbours(/** @type {any} */ ctx, /** @type {LicenseRecord} */ rec) {
  const out = new Set();
  if (rec.replacedBy) out.add(rec.replacedBy);
  if (rec.reissuedFrom) out.add(rec.reissuedFrom);
  const claimed = await ctx.store.get(`reissue:${rec.lid}`);
  if (claimed) out.add(claimed);
  return /** @type {string[]} */ ([...out]);
}

/**
 * Visits `headLid` and every record connected to it by reissues, head first. `visit` runs (and writes) before the
 * neighbours are read, so a reissue that claims its replacement meanwhile is either seen here or sees `visit`'s write.
 * @param {any} ctx @param {string} headLid
 * @param {(lid: string, primary: boolean) => Promise<LicenseRecord | null>} visit returns the fresh record, or null when unknown
 */
async function walkChain(ctx, headLid, visit) {
  const seen = new Set();
  const queue = [headLid];
  while (queue.length && seen.size < 50) {
    const lid = /** @type {string} */ (queue.shift());
    if (seen.has(lid)) continue;
    seen.add(lid);
    const rec = await visit(lid, lid === headLid);
    if (rec) queue.push(...(await chainNeighbours(ctx, rec)));
  }
}

/**
 * Marks a licence revoked. Idempotent. Refund and dispute email the customer a factual notice (once) and follow the
 * reissue chain, so a replacement made before or during the refund is revoked too; the admin reasons ("leaked",
 * "manual", "reissued") touch only this record and send nothing.
 * @param {any} ctx
 * @param {string} lid
 * @param {RevokeReason} reason
 * @returns {Promise<"revoked" | "already" | "unknown">}
 */
export async function revokeLicense(ctx, lid, reason) {
  if (!isPaymentReason(reason)) return revokeOne(ctx, lid, reason, true);
  /** @type {"revoked" | "already" | "unknown"} */
  let result = "unknown";
  await walkChain(ctx, lid, async (member, primary) => {
    const r = await revokeOne(ctx, member, reason, primary);
    if (primary) result = r;
    return r === "unknown" ? null : getLicense(ctx, member);
  });
  return result;
}

/**
 * Admin un-revoke when the revocation reason is one of `allowed`. No email. Refused while the payment is refunded or
 * disputed, whatever reason came first.
 * @param {any} ctx
 * @param {string} lid
 * @param {string[]} allowed
 * @returns {Promise<{ result: "restored" | "skipped" | "unknown", reason?: string }>}
 */
async function unrevokeWhen(ctx, lid, allowed) {
  const rec = await getLicense(ctx, lid);
  if (!rec) return { result: "unknown" };
  if (!rec.revokedAt) return { result: "skipped", reason: "not_revoked" };
  const paid = paymentRevocation(rec);
  if (paid) return { result: "skipped", reason: paid.reason };
  if (!allowed.includes(String(rec.revokeReason))) return { result: "skipped", reason: String(rec.revokeReason) };
  if (rec.replacedBy) return { result: "skipped", reason: "replaced" }; // restoring it would leave two valid keys
  await ctx.store.srem("revoked", lid);
  await ctx.store.incr("revocations:seq");
  rec.revokedAt = null;
  rec.revokeReason = null;
  await putLicense(ctx, rec);
  await setStripeMetadata(ctx, rec.paymentIntent, { license_revoked_at: "", license_revoke_reason: "" });
  return { result: "restored" };
}

/**
 * A dispute was won: clears the dispute payment mark on the record and its reissue chain. A record comes back only if
 * the dispute is the reason it is revoked (never leaked, manual or reissued) and it has not been replaced. A refund
 * outranks a dispute, so a refunded payment stays revoked. No email.
 * @returns {Promise<"restored" | "skipped" | "unknown">}
 */
export async function unrevokeDisputeLicense(/** @type {any} */ ctx, /** @type {string} */ lid) {
  let known = false;
  let restored = false;
  await walkChain(ctx, lid, async (member, primary) => {
    const rec = await getLicense(ctx, member);
    if (!rec) return null;
    if (primary) known = true;
    if (paymentRevocation(rec)?.reason !== "dispute") return rec;
    const comesBack = Boolean(rec.revokedAt) && rec.revokeReason === "dispute" && !rec.replacedBy;
    rec.paymentRevokedAt = null;
    rec.paymentRevokeReason = null;
    if (comesBack) {
      await ctx.store.srem("revoked", member);
      await ctx.store.incr("revocations:seq");
      rec.revokedAt = null;
      rec.revokeReason = null;
    }
    await putLicense(ctx, rec);
    if (comesBack) {
      restored = true;
      await setStripeMetadata(ctx, rec.paymentIntent, { license_revoked_at: "", license_revoke_reason: "" });
    }
    return rec;
  });
  return !known ? "unknown" : restored ? "restored" : "skipped";
}

/** Admin: restores a licence that was revoked as "leaked" or "manual" (never refund, dispute or reissued). */
export function unrevokeLicense(/** @type {any} */ ctx, /** @type {string} */ lid) {
  return unrevokeWhen(ctx, lid, ["leaked", "manual"]);
}

// ---------------------------------------------------------------- admin: reissue and lookup

/**
 * Replaces a licence with a new one for the same buyer and payment, and revokes the old one ("reissued", no email).
 * Safe to repeat: the replacement is claimed atomically under `reissue:<old lid>`, and every later step is idempotent,
 * so a second call (or a retry after a crash) returns the same replacement and finishes any missed step.
 * Refused when the payment was refunded or disputed (whatever else the old licence was revoked for), and a replacement
 * made while a refund or dispute lands is revoked again before it is emailed.
 * @param {any} ctx
 * @param {string} oldLid
 * @returns {Promise<{ result: "reissued" | "already", oldLid: string, newLid: string, record: LicenseRecord } | { result: "refused", oldLid: string, reason: string } | { result: "unknown", oldLid: string }>}
 */
export async function reissueLicense(ctx, oldLid) {
  const { store } = ctx;
  const old = await getLicense(ctx, oldLid);
  if (!old) return { result: "unknown", oldLid };
  const paid = paymentRevocation(old);
  if (paid) return { result: "refused", oldLid, reason: paid.reason };

  /** @type {LicenseRecord | null} */
  let rec = null;
  let created = false;
  const claimed = await store.get(`reissue:${oldLid}`);
  if (claimed) {
    rec = await getLicense(ctx, claimed);
  } else {
    const minted = mintLicense(ctx, { email: old.email, sessionId: old.sessionId, paymentIntent: old.paymentIntent, reissuedFrom: oldLid, purchasedAt: old.purchasedAt ?? old.issuedAt, free: old });
    await putLicense(ctx, minted);
    if (await store.set(`reissue:${oldLid}`, minted.lid, { nx: true })) {
      rec = minted;
      created = true;
    } else {
      // A concurrent reissue won: drop ours and use theirs.
      await store.del(licKey(minted.lid));
      const winner = await store.get(`reissue:${oldLid}`);
      rec = winner ? await getLicense(ctx, winner) : null;
      if (rec) return { result: "already", oldLid, newLid: rec.lid, record: rec }; // the winner finishes the job
    }
  }
  if (!rec) throw new Error("reissue claimed but replacement missing");
  if (rec.revokedAt) return { result: "refused", oldLid, reason: "replacement_revoked" };

  // Move every pointer to the replacement first, so a refund or dispute arriving now revokes the new key.
  if (old.sessionId && !old.free) await store.set(`session:${old.sessionId}`, rec.lid);
  if (rec.paymentIntent) await store.set(`pi:${rec.paymentIntent}`, rec.lid);
  if (old.replacedBy !== rec.lid) await patchLicense(ctx, oldLid, (r) => { r.replacedBy = rec.lid; });
  await revokeLicense(ctx, oldLid, "reissued"); // no-op if it was already revoked as leaked/manual
  // A refund or dispute that landed after `old` was read above revoked the old record but may have missed the
  // replacement (it was not linked yet): re-read, and revoke the replacement for the same reason before it is emailed.
  const paidNow = paymentRevocation((await getLicense(ctx, oldLid)) ?? old);
  if (paidNow) {
    await revokeOne(ctx, rec.lid, paidNow.reason, false);
    return { result: "refused", oldLid, reason: paidNow.reason };
  }
  if (!rec.indexedAt) await finalize(ctx, rec); // email set, Stripe metadata, the new-key email
  else await sendLicenseEmail(ctx, rec.lid); // no-op when already sent
  return { result: created ? "reissued" : "already", oldLid, newLid: rec.lid, record: (await getLicense(ctx, rec.lid)) ?? rec };
}

const NOTE_MAX = 200;

/**
 * Admin: gives a free licence. Same key and record as a purchase, marked `free`, with no payment behind it. Emails the
 * recipient (finalize). The note is for the admin only: it is never emailed or logged.
 * @param {any} ctx
 * @param {{ email: unknown, note?: unknown, by: string }} p `by` is "cli" or the admin's Google email
 * @returns {Promise<{ ok: true, record: LicenseRecord } | { ok: false, reason: "invalid_email" }>}
 */
export async function issueFreeLicense(ctx, { email: rawEmail, note: rawNote, by }) {
  const email = String(rawEmail ?? "").trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: "invalid_email" };
  const note = String(rawNote ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, NOTE_MAX).trim();
  const rec = mintLicense(ctx, { email, sessionId: (lid) => `free:${lid}`, paymentIntent: null, free: { free: true, freeNote: note || null, freeBy: String(by) } });
  await putLicense(ctx, rec);
  await finalize(ctx, rec);
  return { ok: true, record: (await getLicense(ctx, rec.lid)) ?? rec };
}

/**
 * Admin lookup. Takes a lid or an email address.
 * @param {any} ctx
 * @param {{ lid: string } | { email: string }} target
 * @returns {Promise<LicenseRecord[]>} oldest first
 */
export async function findLicenses(ctx, target) {
  const lids = "lid" in target ? [target.lid] : await ctx.store.smembers(`email:${emailHash(target.email)}`);
  const records = [];
  for (const lid of lids) {
    const rec = await getLicense(ctx, lid);
    if (rec) records.push(rec);
  }
  return records.sort((a, b) => a.issuedAt - b.issuedAt);
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
    ctx.log.warn("resend email failed", mailFail(e));
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
