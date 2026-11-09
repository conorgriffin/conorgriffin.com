// HTTP handlers, written against a context so tests can call them with fakes.
// The files in api/tessera/ are thin wrappers that pass in the real context.
import { activationUrl } from "./email.js";
import { b64urlDecode, safeEqual, sha256Hex, verifyStripeSignature } from "./crypto.js";
import {
  LOGIN_COOKIE, adminHostMatches, adminSecret, clearLoginCookie, clearSessionCookie,
  endSession, exchangeCode, googleAdminConfig, loginCookie, originMatches, parseCookies, sessionCookie, sessionEmail, startLogin,
  startSession, verifyIdToken, verifySignedValue,
} from "./adminAuth.js";
import {
  SESSION_MAX_AGE_SECONDS, buildRevocationList, findLicenses, handleEvent, issueFreeLicense, issueLicense, paymentRevocation, reconcile,
  reissueLicense, resendLicenses, revokeLicense, unrevokeLicense,
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
    const r = await issueLicense(ctx, sessionId, { maxAgeSeconds: SESSION_MAX_AGE_SECONDS, refuseReissued: true });
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
const ADMIN_ACTIONS = new Set(["lookup", "revoke", "unrevoke", "reissue", "stats", "issue_free"]);
const FREE_NOTE_MAX = 200;
const FREE_LIMIT = 20; // free licences per rolling day, overall: a safety net should the admin session ever be abused
const FREE_WINDOW_SECONDS = 86400;
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

/**
 * What the admin sees of a record. Never the licence string, and no Stripe ids: the Checkout Session id is itself a
 * bearer for the key on the public thanks endpoint for a while after purchase.
 * @param {any} rec
 */
const adminView = (rec) => {
  const paid = paymentRevocation(rec);
  return {
    lid: rec.lid,
    email: rec.email,
    issuedAt: rec.issuedAt,
    revokedAt: rec.revokedAt ?? null,
    revokeReason: rec.revokeReason ?? null,
    paymentStatus: paid?.reason ?? null, // "refund" | "dispute": the payment itself, whatever else revoked the licence
    paymentRevokedAt: paid?.at ?? null,
    emailedAt: rec.emailedAt ?? null,
    free: Boolean(rec.free),
    freeNote: rec.freeNote ?? null,
    replacedBy: rec.replacedBy ?? null,
    reissuedFrom: rec.reissuedFrom ?? null,
  };
};

const ADMIN_FAIL_LIMIT = 20; // failed attempts per address ...
const ADMIN_FAIL_WINDOW_SECONDS = 3600; // ... per hour

/**
 * POST /api/tessera/admin  { action, target, reason? } (or { action: "issue_free", email, note? }). Two ways in:
 *  - Authorization: Bearer <TESSERA_ADMIN_SECRET> (the CLI; the secret must be at least 32 characters), or
 *  - the signed `__Host-tessera_admin` session cookie from "Sign in with Google" (also live in Redis as
 *    `adminsess:<id>`, so logout ends it), with an Origin header equal to the site's origin (CSRF guard on top of
 *    SameSite=Strict) and an email that is still in TESSERA_ADMIN_EMAILS.
 * Only answers on the configured host (TESSERA_ADMIN_BASE_URL), so old *.vercel.app deployments are dead ends. With
 * neither way configured the route does not exist (404 for every method). Failed attempts are counted per IP.
 * Nothing here logs emails or keys.
 */
export async function adminHandler(/** @type {() => any} */ getCtx, /** @type {Request} */ request) {
  const { ctx, response } = withContext(getCtx);
  if (response) return response;
  if (!adminHostMatches(request, ctx.env)) return json({ error: "not_found" }, 404);
  const secret = adminSecret(ctx);
  const google = googleAdminConfig(ctx.env);
  if (!secret && !google) return json({ error: "not_found" }, 404);

  // Too many recent failures from this address: refuse everything, even a correct credential, so guessing can't go on.
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const failKey = `rl:adminfail:${sha256Hex(ip)}`;
  try {
    if (Number((await ctx.store.get(failKey)) ?? 0) >= ADMIN_FAIL_LIMIT) {
      return json({ error: "too_many_attempts" }, 429, { "Retry-After": String(ADMIN_FAIL_WINDOW_SECONDS) });
    }
  } catch (e) {
    ctx.log.warn("admin rate limit check failed", { error: errName(e) }); // the credentials below are still required
  }

  /** @type {"bearer" | "cookie" | null} */
  let via = null;
  /** @type {string | null} */
  let adminEmail = null; // the signed-in admin (cookie sessions only)
  if (secret && safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) via = "bearer";
  else if (google && (adminEmail = await sessionEmail(ctx, request))) via = "cookie";
  if (!via) {
    try {
      await ctx.store.incrWithExpiry(failKey, ADMIN_FAIL_WINDOW_SECONDS);
    } catch (e) {
      ctx.log.warn("admin rate limit update failed", { error: errName(e) });
    }
    return json({ error: "unauthorized" }, 401);
  }
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
  if (action === "stats") {
    try {
      // The product id isn't secret; the admin page uses it to link to the product in the Stripe Dashboard.
      const productId = /^prod_[A-Za-z0-9]+$/.test(ctx.env.TESSERA_STRIPE_PRODUCT_ID ?? "") ? ctx.env.TESSERA_STRIPE_PRODUCT_ID : null;
      return json({ days: await clickStats(ctx, STATS_DAYS), stripeProductId: productId });
    } catch (e) {
      ctx.log.error("admin stats failed", { error: errName(e) });
      return json({ error: "failed" }, 500);
    }
  }
  if (action === "issue_free") {
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "bad_email" }, 400);
    const note = body?.note;
    if (note !== undefined && note !== null && (typeof note !== "string" || note.length > FREE_NOTE_MAX)) return json({ error: "bad_note" }, 400);
    try {
      if ((await ctx.store.incrWithExpiry("rl:free", FREE_WINDOW_SECONDS)) > FREE_LIMIT) return json({ error: "too_many_free" }, 429);
      const r = await issueFreeLicense(ctx, { email, note, by: via === "cookie" && adminEmail ? adminEmail : "cli" });
      if (!r.ok) return json({ error: "bad_email" }, 400);
      ctx.log.info("admin action", { action, lid: r.record.lid, via });
      // The key is included so it can be pasted to the recipient by hand if the email fails.
      return json({ result: "issued", lid: r.record.lid, emailed: Boolean(r.record.emailedAt), license: r.record.license });
    } catch (e) {
      ctx.log.error("admin action failed", { action, error: errName(e) });
      return json({ error: "failed" }, 500);
    }
  }
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

/** Shared start of the four routes: the context, and a 404 whatever the verb when Google admin isn't configured or the host is wrong. */
function adminAuthRoute(/** @type {() => any} */ getCtx, /** @type {Request} */ request, /** @type {string} */ method) {
  const { ctx, response } = withContext(getCtx);
  if (response) return { response };
  if (!adminHostMatches(request, ctx.env)) return { response: json({ error: "not_found" }, 404) };
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

  let started;
  try {
    started = await startSession(ctx, email);
  } catch {
    return fail("token", "session_store");
  }
  ctx.log.info("admin signed in", {});
  return adminRedirect(cfg.origin, undefined, [sessionCookie(email, started.sid, cfg.sessionSecret, ctx.now()), clearLoginCookie()]);
}

/** GET /api/tessera/admin-session: who the page is signed in as. */
export async function adminSession(/** @type {() => any} */ getCtx, /** @type {Request} */ request) {
  const r = adminAuthRoute(getCtx, request, "GET");
  if (r.response) return r.response;
  const email = await sessionEmail(r.ctx, request);
  return json(email ? { signedIn: true, email } : { signedIn: false });
}

/** POST /api/tessera/admin-logout: ends the session in Redis and clears the cookie. Same-origin only. */
export async function adminLogout(/** @type {() => any} */ getCtx, /** @type {Request} */ request) {
  const r = adminAuthRoute(getCtx, request, "POST");
  if (r.response) return r.response;
  if (!originMatches(request, r.cfg)) return json({ error: "bad_origin" }, 403);
  try {
    await endSession(r.ctx, request);
  } catch (e) {
    // Keep the cookie so the admin can try again: clearing it would leave a live server-side session nobody can end.
    r.ctx.log.error("admin session end failed", { error: errName(e) });
    return json({ error: "logout_failed" }, 500);
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "Set-Cookie": clearSessionCookie() } });
}

// ---------------------------------------------------------------- buy and download clicks

const GO_TARGETS = /** @type {Record<string, string>} */ ({ buy: "TESSERA_PAYMENT_LINK_URL", download: "TESSERA_DOWNLOAD_URL" });
const CLICK_TTL_SECONDS = 400 * 24 * 60 * 60;
const STATS_DAYS = 30;
// Link previews and crawlers follow links too; they shouldn't count as people.
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|curl|wget|python-requests|headless/i;

const utcDay = (/** @type {number} */ ms) => new Date(ms).toISOString().slice(0, 10);
const clickKey = (/** @type {string} */ to, /** @type {string} */ day) => `clicks:${to}:${day}`;

/**
 * GET /api/tessera/go?to=buy|download: counts the click per UTC day in Redis (no IP, cookie or anything
 * about the visitor is stored), then 302s to the URL in the environment. Counting is best effort: if Redis
 * is down or not configured, the visitor is still sent on.
 */
export async function goHandler(/** @type {() => any} */ getCtx, /** @type {Request} */ request) {
  const to = new URL(request.url).searchParams.get("to") ?? "";
  const name = Object.hasOwn(GO_TARGETS, to) ? GO_TARGETS[to] : undefined;
  if (!name || !salesOpen(process.env)) return new Response("Not found", { status: 404 });
  if (request.method === "GET" && !BOT_UA.test(request.headers.get("user-agent") ?? "")) {
    try {
      const ctx = getCtx();
      await ctx.store.incrWithExpiry(clickKey(to, utcDay(ctx.now())), CLICK_TTL_SECONDS);
    } catch (e) {
      console.warn(JSON.stringify({ level: "warn", msg: "click count failed", to, error: errName(e) }));
    }
  }
  return redirectTo(() => process.env, name);
}

/** Buy and download clicks for the last `days` UTC days, newest first. */
export async function clickStats(/** @type {any} */ ctx, /** @type {number} */ days) {
  const today = Date.parse(utcDay(ctx.now()));
  const dates = Array.from({ length: days }, (_, i) => utcDay(today - i * 86400000));
  const values = await ctx.store.mget(dates.flatMap((d) => [clickKey("download", d), clickKey("buy", d)]));
  return dates.map((date, i) => ({ date, download: Number(values[2 * i] ?? 0), buy: Number(values[2 * i + 1] ?? 0) }));
}

/** GET /api/tessera/go?to=buy|download: 302 to a URL held in an environment variable. */
export function redirectTo(/** @type {() => any} */ getEnv, /** @type {string} */ name) {
  const url = String(getEnv()[name] ?? "");
  if (!/^https:\/\//.test(url)) return json({ error: "not_configured" }, 503);
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}

/** Sales are hidden until launch: VITE_TESSERA_SALES_OPEN=1 (also read at build time by the /tessera page). */
export function salesOpen(/** @type {Record<string, string | undefined>} */ env) {
  return env.VITE_TESSERA_SALES_OPEN === "1";
}

// Countries whose own currency we might sell in. Anywhere else gets the price's default currency,
// which is also what Stripe Checkout shows there.
const COUNTRY_CURRENCY = /** @type {Record<string, string>} */ ({
  US: "usd", PR: "usd", GU: "usd", VI: "usd", AS: "usd", MP: "usd",
  GB: "gbp", IM: "gbp", JE: "gbp", GG: "gbp",
  IE: "eur", AT: "eur", BE: "eur", HR: "eur", CY: "eur", EE: "eur", FI: "eur", FR: "eur", DE: "eur", GR: "eur", IT: "eur",
  LV: "eur", LT: "eur", LU: "eur", MT: "eur", NL: "eur", PT: "eur", SK: "eur", SI: "eur", ES: "eur",
  CA: "cad", AU: "aud", NZ: "nzd", CH: "chf", SE: "sek", NO: "nok", DK: "dkk", PL: "pln", JP: "jpy", IN: "inr",
});
const PRICE_TTL_MS = 60 * 60 * 1000;
/** @type {{ at: number, value: { default: string, amounts: Record<string, number> } } | undefined} */
let priceCache;

/** Test hook: forget the cached Stripe price. */
export function resetPriceCache() { priceCache = undefined; }

/**
 * GET /api/tessera/price: Tessera Pro's price in the visitor's currency, from Stripe.
 * The country comes from Vercel's x-vercel-ip-country header and is never logged or stored.
 * Returns { currency: "eur", amount: 999 } (amount in the currency's minor unit, as Stripe has it).
 */
export async function tesseraPrice(/** @type {() => any} */ getCtx, /** @type {Request} */ request) {
  const { ctx, response } = withContext(getCtx);
  if (response) return response;
  if (!salesOpen(ctx.env)) return json({ error: "not_found" }, 404);
  const productId = ctx.env.TESSERA_STRIPE_PRODUCT_ID;
  if (!productId) return json({ error: "not_configured" }, 503);
  try {
    if (!priceCache || ctx.now() - priceCache.at > PRICE_TTL_MS) {
      const value = await ctx.stripe.retrieveProductPrices(productId);
      if (!value) return json({ error: "not_configured" }, 503);
      priceCache = { at: ctx.now(), value };
    }
    const { value } = priceCache;
    const country = (request.headers.get("x-vercel-ip-country") ?? "").toUpperCase();
    const local = COUNTRY_CURRENCY[country];
    const currency = local && local in value.amounts ? local : value.default;
    // The answer depends on the visitor's country, so it must not be shared from a CDN cache.
    return json({ currency, amount: value.amounts[currency] }, 200, { "Cache-Control": "private, max-age=3600" });
  } catch (e) {
    ctx.log.error("price lookup failed", { error: errName(e) });
    return json({ error: "try_again" }, 502);
  }
}
