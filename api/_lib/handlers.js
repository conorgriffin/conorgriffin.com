// HTTP handlers, written against a context so tests can call them with fakes.
// The files in api/tessera/ are thin wrappers that pass in the real context.
import { activationUrl } from "./email.js";
import { b64urlDecode, safeEqual, sha256Hex, verifyStripeSignature } from "./crypto.js";
import {
  LOGIN_COOKIE, clearLoginCookie, clearSessionCookie, exchangeCode, googleAdminConfig, loginCookie, originMatches, parseCookies,
  sessionCookie, sessionEmail, startLogin, verifyIdToken, verifySignedValue,
} from "./adminAuth.js";
import {
  SESSION_MAX_AGE_SECONDS, buildRevocationList, findLicenses, handleEvent, issueLicense, reconcile, reissueLicense,
  resendLicenses, revokeLicense, unrevokeLicense,
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

// ---------------------------------------------------------------- admin

const LID = /^[0-9a-f]{32}$/;
const ADMIN_BODY_MAX = 8192;
const ADMIN_ACTIONS = new Set(["lookup", "revoke", "unrevoke", "reissue"]);
const ADMIN_REVOKE_REASONS = new Set(["leaked", "manual"]);

/**
 * Reads an admin target: a licence id, a full licence key (any whitespace; only the payload is read, the
 * signature is not checked because we only look the id up), or an email address.
 * @param {unknown} raw
 * @returns {{ lid: string } | { email: string } | null}
 */
export function parseAdminTarget(raw) {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  const trimmed = raw.trim();
  const compact = trimmed.replace(/\s+/g, "");
  if (compact.startsWith("TSR1-")) {
    try {
      const payloadPart = compact.slice(5).split(".")[0];
      const lid = JSON.parse(b64urlDecode(payloadPart).toString("utf8"))?.lid;
      return typeof lid === "string" && LID.test(lid) ? { lid } : null;
    } catch {
      return null;
    }
  }
  if (LID.test(compact)) return { lid: compact };
  if (trimmed.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { email: trimmed.toLowerCase() };
  return null;
}

/** @param {any} rec */
const adminView = (rec) => ({
  lid: rec.lid,
  email: rec.email,
  issuedAt: rec.issuedAt,
  revokedAt: rec.revokedAt ?? null,
  revokeReason: rec.revokeReason ?? null,
  sessionId: rec.sessionId ?? null,
  paymentIntent: rec.paymentIntent ?? null,
  emailedAt: rec.emailedAt ?? null,
  replacedBy: rec.replacedBy ?? null,
  reissuedFrom: rec.reissuedFrom ?? null,
}); // never the licence string

/**
 * POST /api/tessera/admin  { action, target, reason? }. Two ways in:
 *  - Authorization: Bearer <TESSERA_ADMIN_SECRET> (the CLI), or
 *  - the signed `tessera_admin` session cookie from "Sign in with Google", with an Origin header equal to the site's
 *    origin (CSRF guard on top of SameSite=Strict) and an email that is still in TESSERA_ADMIN_EMAILS.
 * With neither configured the route does not exist (404 for every method). Nothing here logs emails or keys.
 */
export async function adminHandler(/** @type {() => any} */ getCtx, /** @type {Request} */ request) {
  const { ctx, response } = withContext(getCtx);
  if (response) return response;
  const secret = ctx.env.TESSERA_ADMIN_SECRET;
  const google = googleAdminConfig(ctx.env);
  if (!secret && !google) return json({ error: "not_found" }, 404);
  /** @type {"bearer" | "cookie" | null} */
  let via = null;
  if (secret && safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) via = "bearer";
  else if (google && sessionEmail(ctx, request)) via = "cookie";
  if (!via) return json({ error: "unauthorized" }, 401);
  if (via === "cookie" && google && !originMatches(request, google)) return json({ error: "bad_origin" }, 403);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });

  /** @type {any} */
  let body = null;
  try {
    const text = await request.text();
    if (text.length > ADMIN_BODY_MAX) return json({ error: "too_large" }, 400);
    body = JSON.parse(text);
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const action = body?.action;
  if (typeof action !== "string" || !ADMIN_ACTIONS.has(action)) return json({ error: "bad_action" }, 400);
  const target = parseAdminTarget(body?.target);
  if (!target) return json({ error: "bad_target" }, 400);
  if (!("lid" in target) && action !== "lookup") return json({ error: "email_only_for_lookup" }, 400);
  const reason = body?.reason ?? "leaked";
  if (action === "revoke" && !ADMIN_REVOKE_REASONS.has(reason)) return json({ error: "bad_reason" }, 400);

  ctx.log.info("admin action", { action, lid: "lid" in target ? target.lid : null, via });
  try {
    if (action === "lookup") return json({ licenses: (await findLicenses(ctx, target)).map(adminView) });
    const lid = /** @type {{ lid: string }} */ (target).lid;
    if (action === "revoke") return json({ result: await revokeLicense(ctx, lid, reason), lid });
    if (action === "unrevoke") return json({ lid, ...(await unrevokeLicense(ctx, lid)) });
    const r = await reissueLicense(ctx, lid);
    if (r.result === "reissued" || r.result === "already") {
      // The key is included so it can be pasted to the buyer by hand if the email fails.
      return json({ result: r.result, oldLid: r.oldLid, newLid: r.newLid, emailed: Boolean(r.record.emailedAt), license: r.record.license });
    }
    return json(r);
  } catch (e) {
    ctx.log.error("admin action failed", { action, error: errName(e) });
    return json({ error: "failed" }, 500);
  }
}

// ---------------------------------------------------------------- admin: Sign in with Google

const ADMIN_PAGE = "/tessera/admin";

/** @param {string} origin @param {string} [error] @param {string[]} cookies */
function adminRedirect(origin, error, cookies = []) {
  const headers = new Headers({ Location: `${origin}${ADMIN_PAGE}${error ? `?error=${error}` : ""}`, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

/** Shared start of the four routes: the context, and a 404 whatever the verb when Google admin isn't configured. */
function adminAuthRoute(/** @type {() => any} */ getCtx, /** @type {Request} */ request, /** @type {string} */ method) {
  const { ctx, response } = withContext(getCtx);
  if (response) return { response };
  const cfg = googleAdminConfig(ctx.env);
  if (!cfg) return { response: json({ error: "not_found" }, 404) };
  if (request.method !== method) return { response: json({ error: "method_not_allowed" }, 405, { Allow: method }) };
  return { ctx, cfg };
}

/** GET /api/tessera/admin-login: sets the short-lived login cookie and sends the browser to Google. */
export async function adminLogin(/** @type {() => any} */ getCtx, /** @type {Request} */ request) {
  const r = adminAuthRoute(getCtx, request, "GET");
  if (r.response) return r.response;
  const { ctx, cfg } = r;
  const { state, nonce, cv, url } = startLogin(cfg);
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store", "Set-Cookie": loginCookie({ state, nonce, cv }, cfg.sessionSecret, ctx.now()) },
  });
}

/** GET /api/tessera/admin-callback: finishes the Google sign-in. Failures redirect with a short code and leak nothing. */
export async function adminCallback(/** @type {() => any} */ getCtx, /** @type {Request} */ request) {
  const r = adminAuthRoute(getCtx, request, "GET");
  if (r.response) return r.response;
  const { ctx, cfg } = r;
  /** @param {string} code @param {string} reason */
  const fail = (code, reason) => {
    ctx.log.warn("admin sign-in rejected", { reason });
    return adminRedirect(cfg.origin, code, [clearLoginCookie()]);
  };
  const params = new URL(request.url).searchParams;
  if (params.get("error")) return fail("denied", "google_error");
  const login = verifySignedValue(parseCookies(request.headers.get("cookie"))[LOGIN_COOKIE], cfg.sessionSecret, "login", ctx.now());
  const state = params.get("state") ?? "";
  if (!login || typeof login.state !== "string" || typeof login.nonce !== "string" || typeof login.cv !== "string") return fail("state", "no_login_cookie");
  if (!state || !safeEqual(state, login.state)) return fail("state", "state_mismatch");
  const code = params.get("code") ?? "";
  if (!code || code.length > 2048) return fail("token", "no_code");

  const token = await exchangeCode(ctx, cfg, code, login.cv);
  if ("reason" in token) return fail("token", token.reason);
  const verified = await verifyIdToken(ctx, token.idToken, { clientId: cfg.clientId, nonce: login.nonce });
  if (!verified.ok) return fail("token", `id_token_${verified.reason}`);
  const claims = verified.claims;
  if (claims.email_verified !== true) return fail("not_allowed", "email_unverified");
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email || !cfg.emails.has(email)) return fail("not_allowed", "not_on_allowlist");

  ctx.log.info("admin signed in", {});
  return adminRedirect(cfg.origin, undefined, [sessionCookie(email, cfg.sessionSecret, ctx.now()), clearLoginCookie()]);
}

/** GET /api/tessera/admin-session: who the page is signed in as. */
export async function adminSession(/** @type {() => any} */ getCtx, /** @type {Request} */ request) {
  const r = adminAuthRoute(getCtx, request, "GET");
  if (r.response) return r.response;
  const email = sessionEmail(r.ctx, request);
  return json(email ? { signedIn: true, email } : { signedIn: false });
}

/** POST /api/tessera/admin-logout: clears the session cookie. Same-origin only. */
export async function adminLogout(/** @type {() => any} */ getCtx, /** @type {Request} */ request) {
  const r = adminAuthRoute(getCtx, request, "POST");
  if (r.response) return r.response;
  if (!originMatches(request, r.cfg)) return json({ error: "bad_origin" }, 403);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "Set-Cookie": clearSessionCookie() } });
}

/** GET /api/tessera/buy and /api/tessera/download: 302 to a URL held in an environment variable. */
export function redirectTo(/** @type {() => any} */ getEnv, /** @type {string} */ name) {
  const url = String(getEnv()[name] ?? "");
  if (!/^https:\/\//.test(url)) return json({ error: "not_configured" }, 503);
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}

/** Sales are hidden until launch: VITE_TESSERA_SALES_OPEN=1 (also read at build time by the /tessera page). */
export function salesOpen(/** @type {Record<string, string | undefined>} */ env) {
  return env.VITE_TESSERA_SALES_OPEN === "1";
}
