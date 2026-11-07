// HTTP handlers, written against a context so tests can call them with fakes.
// The files in api/tessera/ are thin wrappers that pass in the real context.
import { activationUrl } from "./email.js";
import { safeEqual, sha256Hex, verifyStripeSignature } from "./crypto.js";
import {
  SESSION_MAX_AGE_SECONDS, buildRevocationList, handleEvent, issueLicense, reconcile, resendLicenses,
} from "./licensing.js";

/** @param {unknown} body @param {number} [status] @param {Record<string, string>} [headers] */
const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

const errName = (/** @type {any} */ e) => (e && e.name) || "Error";

/** @param {(() => any)} getCtx */
function withContext(getCtx) {
  try {
    return { ctx: getCtx() };
  } catch (e) {
    // The message names the missing setting, never a value.
    console.error(JSON.stringify({ level: "error", msg: "not configured", error: errName(e), detail: String(/** @type {any} */ (e)?.message ?? "") }));
    return { response: json({ error: "not_configured" }, 500) };
  }
}

/** POST /api/tessera/stripe-webhook */
export async function stripeWebhook(/** @type {() => any} */ getCtx, /** @type {Request} */ request) {
  const { ctx, response } = withContext(getCtx);
  if (response) return response;
  const raw = await request.text(); // signature is over the exact bytes
  const check = verifyStripeSignature({
    payload: raw, header: request.headers.get("stripe-signature"), secret: ctx.env.STRIPE_WEBHOOK_SECRET, nowMs: ctx.now(),
  });
  if (!check.ok) {
    if (check.reason === "no_secret") return json({ error: "not_configured" }, 500);
    return json({ error: "bad_signature" }, 400);
  }
  /** @type {any} */
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") return json({ error: "bad_event" }, 400);
  try {
    if (await ctx.store.get(`evt:${event.id}`)) return json({ ok: true, duplicate: true });
    const result = await handleEvent(ctx, event);
    await ctx.store.set(`evt:${event.id}`, "1", { ex: 30 * 86400 }); // only after success, so a failure is retried
    return json({ ok: true, result });
  } catch (e) {
    ctx.log.error("webhook processing failed", { type: event.type, error: errName(e) });
    return json({ error: "processing_failed" }, 500);
  }
}

const SESSION_ID = /^cs_[A-Za-z0-9_]{8,250}$/;

/** GET /api/tessera/license?session_id=cs_… */
export async function licenseForSession(/** @type {() => any} */ getCtx, /** @type {Request} */ request) {
  const { ctx, response } = withContext(getCtx);
  if (response) return response;
  const sessionId = new URL(request.url).searchParams.get("session_id") ?? "";
  const notFound = () => json({ error: "not_found", help: "/tessera/license" }, 404);
  if (!SESSION_ID.test(sessionId)) return notFound();
  try {
    const r = await issueLicense(ctx, sessionId, { maxAgeSeconds: SESSION_MAX_AGE_SECONDS });
    if (r.ok) return json({ license: r.record.license, email: r.record.email, activationUrl: activationUrl(r.record.license) });
    if (r.reason === "unpaid") return json({ error: "payment_pending" }, 409);
    return notFound();
  } catch (e) {
    ctx.log.error("licence lookup failed", { error: errName(e) });
    return json({ error: "try_again" }, 500);
  }
}

/** POST /api/tessera/resend  { email } */
export async function resend(/** @type {() => any} */ getCtx, /** @type {Request} */ request) {
  const { ctx, response } = withContext(getCtx);
  if (response) return response;
  const started = ctx.now();
  /** @type {any} */
  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const email = typeof body?.email === "string" ? body.email : "";
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  try {
    await resendLicenses(ctx, email, sha256Hex(ip));
  } catch (e) {
    ctx.log.error("resend failed", { error: errName(e) });
  }
  // Same answer, and roughly the same time, whether or not a purchase exists.
  const wait = (ctx.resendMinMs ?? 0) - (ctx.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return json({ ok: true });
}

/** GET /api/tessera/revocations. Reads no request headers and logs nothing about the caller. */
export async function revocations(/** @type {() => any} */ getCtx) {
  const { ctx, response } = withContext(getCtx);
  if (response) return response;
  try {
    return Response.json(await buildRevocationList(ctx), {
      headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400" },
    });
  } catch (e) {
    ctx.log.error("revocation list failed", { error: errName(e) });
    return json({ error: "try_again" }, 500);
  }
}

/** GET /api/tessera/reconcile (Vercel Cron, daily) */
export async function reconcileHandler(/** @type {() => any} */ getCtx, /** @type {Request} */ request) {
  const { ctx, response } = withContext(getCtx);
  if (response) return response;
  const secret = ctx.env.CRON_SECRET;
  if (!secret || !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return json({ error: "unauthorized" }, 401);
  try {
    const result = await reconcile(ctx);
    return json({ ok: result.errors === 0, ...result }, result.errors === 0 ? 200 : 500);
  } catch (e) {
    ctx.log.error("reconcile failed", { error: errName(e) });
    return json({ error: "reconcile_failed" }, 500);
  }
}

/** GET /api/tessera/buy and /api/tessera/download: 302 to a URL held in an environment variable. */
export function redirectTo(/** @type {() => any} */ getEnv, /** @type {string} */ name) {
  const url = String(getEnv()[name] ?? "");
  if (!/^https:\/\//.test(url)) return json({ error: "not_configured" }, 503);
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}
