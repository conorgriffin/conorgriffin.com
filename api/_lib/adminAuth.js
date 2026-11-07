// "Sign in with Google" for the Tessera admin page: OAuth 2.0 authorization code + PKCE, ID token
// verification against Google's JWKS, and HMAC-signed cookies. Node built-ins only.
//
// Nothing here logs an email address, a token or a key; failures are logged as short reason names.
import crypto from "node:crypto";
import { b64url, b64urlDecode, safeEqual } from "./crypto.js";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export const LOGIN_COOKIE = "tessera_admin_login";
// `__Host-` makes browsers insist on Secure + Path=/ + no Domain, so a sibling subdomain can't plant or shadow it.
export const SESSION_COOKIE = "__Host-tessera_admin";
export const LOGIN_MAX_AGE_SECONDS = 600; // 10 minutes
export const SESSION_MAX_AGE_SECONDS = 8 * 3600; // 8 hours
const CLOCK_SKEW_SECONDS = 60;
const JWKS_TTL_MS = 3600 * 1000;
const JWKS_MIN_REFETCH_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const DEFAULT_BASE_URL = "https://www.conorgriffin.com";
export const ADMIN_SECRET_MIN_LENGTH = 32;
const sessionKey = (/** @type {string} */ sid) => `adminsess:${sid}`;
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;

// ---------------------------------------------------------------- configuration

/**
 * The Google admin settings, or null when any of them is missing (then every admin-auth route answers 404).
 * @param {Record<string, string | undefined>} env
 * @returns {{ clientId: string, clientSecret: string, emails: Set<string>, sessionSecret: string, baseUrl: string, origin: string, redirectUri: string } | null}
 */
export function googleAdminConfig(env) {
  const clientId = (env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET ?? "").trim();
  const sessionSecret = env.TESSERA_ADMIN_SESSION_SECRET ?? "";
  const emails = new Set((env.TESSERA_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
  if (!clientId || !clientSecret || emails.size === 0 || sessionSecret.length < 32) return null;
  let url;
  try {
    url = new URL((env.TESSERA_ADMIN_BASE_URL ?? "").trim() || DEFAULT_BASE_URL);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) return null;
  const origin = url.origin;
  return { clientId, clientSecret, emails, sessionSecret, baseUrl: origin, origin, redirectUri: `${origin}/api/tessera/admin-callback` };
}

/** @type {WeakSet<object>} */
const warnedShortSecret = new WeakSet();

/**
 * The bearer secret for POST /api/tessera/admin, or "" when unset or shorter than 32 characters (then the bearer path
 * is off, as if unset; a short secret could be guessed online).
 * @param {{ env: Record<string, string | undefined>, log?: { warn: (msg: string, f?: object) => void } }} ctx
 */
export function adminSecret(ctx) {
  const secret = ctx.env.TESSERA_ADMIN_SECRET ?? "";
  if (secret.length >= ADMIN_SECRET_MIN_LENGTH) return secret;
  if (secret && !warnedShortSecret.has(ctx)) {
    warnedShortSecret.add(ctx);
    ctx.log?.warn("admin secret too short", { minimum: ADMIN_SECRET_MIN_LENGTH });
  }
  return "";
}

/**
 * True when the request was addressed to the configured admin host (TESSERA_ADMIN_BASE_URL, default www), by URL
 * and, when the header is there, by Host. Old *.vercel.app deployments keep their own copy of the settings; this makes
 * them useless for admin. An unusable base URL falls back to the default host.
 * @param {Request} request @param {Record<string, string | undefined>} env
 */
export function adminHostMatches(request, env) {
  let expected;
  try {
    const u = new URL((env.TESSERA_ADMIN_BASE_URL ?? "").trim() || DEFAULT_BASE_URL);
    expected = (u.protocol === "https:" || (u.protocol === "http:" && u.hostname === "localhost") ? u : new URL(DEFAULT_BASE_URL)).host;
  } catch {
    expected = new URL(DEFAULT_BASE_URL).host;
  }
  try {
    if (new URL(request.url).host.toLowerCase() !== expected) return false;
  } catch {
    return false;
  }
  const header = request.headers.get("host");
  return header === null || header.trim().toLowerCase() === expected;
}

// ---------------------------------------------------------------- cookies

/** @param {string | null | undefined} header @returns {Record<string, string>} */
export function parseCookies(header) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    const name = i < 1 ? "" : part.slice(0, i).trim();
    if (name && !(name in out)) out[name] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * @param {string} name
 * @param {string} value
 * @param {{ maxAge: number, path: string, sameSite: "Lax" | "Strict" }} o
 */
export function serializeCookie(name, value, o) {
  return `${name}=${value}; Max-Age=${o.maxAge}; Path=${o.path}; HttpOnly; Secure; SameSite=${o.sameSite}`;
}

const LOGIN_COOKIE_OPTS = { path: "/api/tessera", sameSite: /** @type {const} */ ("Lax") };
const SESSION_COOKIE_OPTS = { path: "/", sameSite: /** @type {const} */ ("Strict") };

/** @param {string} secret @param {string} purpose @param {string} body */
const mac = (secret, purpose, body) => crypto.createHmac("sha256", secret).update(`${purpose}.${body}`).digest();

/**
 * base64url(json) + "." + base64url(HMAC-SHA256). The purpose is mixed into the HMAC so a login cookie can never
 * be replayed as a session cookie (or the other way round) even though both use the same secret.
 * @param {object} payload @param {string} secret @param {string} purpose
 */
export function signValue(payload, secret, purpose) {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${b64url(mac(secret, purpose, body))}`;
}

/**
 * Returns the payload if the signature is valid and `exp` (epoch seconds) is in the future, else null.
 * @param {string | undefined} value @param {string} secret @param {string} purpose @param {number} nowMs
 * @returns {any}
 */
export function verifySignedValue(value, secret, purpose, nowMs) {
  try {
    if (typeof value !== "string") return null;
    const parts = value.split(".");
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const given = b64urlDecode(sig);
    const expected = mac(secret, purpose, body);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(b64urlDecode(body).toString("utf8"));
    if (!payload || typeof payload !== "object" || typeof payload.exp !== "number" || payload.exp * 1000 <= nowMs) return null;
    return payload;
  } catch {
    return null;
  }
}

export const clearLoginCookie = () => serializeCookie(LOGIN_COOKIE, "", { ...LOGIN_COOKIE_OPTS, maxAge: 0 });
export const clearSessionCookie = () => serializeCookie(SESSION_COOKIE, "", { ...SESSION_COOKIE_OPTS, maxAge: 0 });

/** @param {{ state: string, nonce: string, cv: string }} v @param {string} secret @param {number} nowMs */
export function loginCookie(v, secret, nowMs) {
  const exp = Math.floor(nowMs / 1000) + LOGIN_MAX_AGE_SECONDS;
  return serializeCookie(LOGIN_COOKIE, signValue({ ...v, exp }, secret, "login"), { ...LOGIN_COOKIE_OPTS, maxAge: LOGIN_MAX_AGE_SECONDS });
}

/** @param {string} email @param {string} sid @param {string} secret @param {number} nowMs */
export function sessionCookie(email, sid, secret, nowMs) {
  const exp = Math.floor(nowMs / 1000) + SESSION_MAX_AGE_SECONDS;
  return serializeCookie(SESSION_COOKIE, signValue({ email, sid, exp, v: 2 }, secret, "session"), { ...SESSION_COOKIE_OPTS, maxAge: SESSION_MAX_AGE_SECONDS });
}

/**
 * Creates the server-side half of a session: a random id held in Redis for 8 hours. A cookie is only good while
 * its id is still there, so logout (or deleting the key) ends it for real.
 * @param {{ store: any }} ctx @param {string} email
 */
export async function startSession(ctx, email) {
  const sid = b64url(crypto.randomBytes(32));
  await ctx.store.set(sessionKey(sid), email.trim().toLowerCase(), { ex: SESSION_MAX_AGE_SECONDS });
  return { sid };
}

/** The signed session payload from the request's cookie (signature, expiry and shape only), or null. @returns {{ email: string, sid: string } | null} */
function sessionPayload(/** @type {{ now: () => number }} */ ctx, /** @type {Request} */ request, /** @type {string} */ secret) {
  const value = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  const s = verifySignedValue(value, secret, "session", ctx.now());
  if (!s || s.v !== 2 || typeof s.email !== "string" || typeof s.sid !== "string" || !SESSION_ID.test(s.sid)) return null;
  return { email: s.email, sid: s.sid };
}

/** Logout: removes the session from Redis if the request carries a validly signed session cookie. */
export async function endSession(/** @type {{ env: Record<string, string | undefined>, now: () => number, store: any }} */ ctx, /** @type {Request} */ request) {
  const cfg = googleAdminConfig(ctx.env);
  const s = cfg && sessionPayload(ctx, request, cfg.sessionSecret);
  if (s) await ctx.store.del(sessionKey(s.sid));
}

/**
 * The signed-in admin's email for a request, or null. Needs a valid signed cookie, the session id still live in Redis
 * (so logout works), and the email still in the allowlist (so removing an address signs that person out at once).
 * Fails closed if Redis can't be reached.
 * @param {{ env: Record<string, string | undefined>, now: () => number, store: any, log?: any }} ctx
 * @param {Request} request
 * @returns {Promise<string | null>}
 */
export async function sessionEmail(ctx, request) {
  const cfg = googleAdminConfig(ctx.env);
  if (!cfg) return null;
  const s = sessionPayload(ctx, request, cfg.sessionSecret);
  if (!s) return null;
  const email = s.email.trim().toLowerCase();
  if (!cfg.emails.has(email)) return null;
  try {
    return (await ctx.store.get(sessionKey(s.sid))) === email ? email : null;
  } catch (e) {
    ctx.log?.warn("admin session lookup failed", { error: (e && /** @type {any} */ (e).name) || "Error" });
    return null;
  }
}

/** CSRF guard for cookie-authenticated writes: the browser must say the request came from our own origin. */
export function originMatches(/** @type {Request} */ request, /** @type {{ origin: string }} */ cfg) {
  return request.headers.get("origin") === cfg.origin;
}

// ---------------------------------------------------------------- login

/** Fresh state, nonce and PKCE verifier, and the Google URL to send the browser to. */
export function startLogin(/** @type {NonNullable<ReturnType<typeof googleAdminConfig>>} */ cfg) {
  const state = b64url(crypto.randomBytes(32));
  const nonce = b64url(crypto.randomBytes(32));
  const cv = b64url(crypto.randomBytes(32)); // 43 characters, within PKCE's 43..128
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid email",
    state,
    nonce,
    code_challenge: b64url(crypto.createHash("sha256").update(cv).digest()),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { state, nonce, cv, url: url.toString() };
}

// ---------------------------------------------------------------- Google calls

/** @param {any} ctx */
const doFetch = (ctx) => ctx.fetch ?? fetch;

/** @type {WeakMap<object, { keys: any[], at: number }>} */
const jwksCache = new WeakMap();

/** @param {any} ctx @param {boolean} force */
async function googleKeys(ctx, force) {
  const hit = jwksCache.get(ctx);
  const now = ctx.now();
  if (hit && (!force || now - hit.at < JWKS_MIN_REFETCH_MS) && now - hit.at < JWKS_TTL_MS) return hit.keys;
  const res = await doFetch(ctx)(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw Object.assign(new Error("jwks status"), { name: "JwksUnavailable" });
  const keys = (await res.json())?.keys;
  if (!Array.isArray(keys)) throw Object.assign(new Error("jwks shape"), { name: "JwksUnavailable" });
  jwksCache.set(ctx, { keys, at: now });
  return keys;
}

/**
 * Verifies a Google ID token: RS256 signature against Google's published keys, issuer, audience, expiry, nonce.
 * Does not look at the email; the caller decides what to allow.
 * @param {any} ctx
 * @param {string} idToken
 * @param {{ clientId: string, nonce: string }} expect
 * @returns {Promise<{ ok: true, claims: any } | { ok: false, reason: string }>}
 */
export async function verifyIdToken(ctx, idToken, expect) {
  try {
    const parts = String(idToken).split(".");
    if (parts.length !== 3) return { ok: false, reason: "malformed" };
    const header = JSON.parse(b64urlDecode(parts[0]).toString("utf8"));
    if (header?.alg !== "RS256" || typeof header.kid !== "string") return { ok: false, reason: "alg" };
    let jwk = (await googleKeys(ctx, false)).find((k) => k?.kid === header.kid && k.kty === "RSA");
    if (!jwk) jwk = (await googleKeys(ctx, true)).find((k) => k?.kid === header.kid && k.kty === "RSA"); // key rotation
    if (!jwk) return { ok: false, reason: "kid" };
    const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
    const signed = Buffer.from(`${parts[0]}.${parts[1]}`, "ascii");
    if (!crypto.verify("RSA-SHA256", signed, key, b64urlDecode(parts[2]))) return { ok: false, reason: "signature" };
    const claims = JSON.parse(b64urlDecode(parts[1]).toString("utf8"));
    if (!claims || typeof claims !== "object") return { ok: false, reason: "claims" };
    if (!GOOGLE_ISSUERS.includes(claims.iss)) return { ok: false, reason: "iss" };
    if (claims.aud !== expect.clientId) return { ok: false, reason: "aud" };
    if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS <= ctx.now() / 1000) return { ok: false, reason: "exp" };
    if (typeof claims.nonce !== "string" || !safeEqual(claims.nonce, expect.nonce)) return { ok: false, reason: "nonce" };
    return { ok: true, claims };
  } catch (e) {
    return { ok: false, reason: (e && /** @type {any} */ (e).name) === "JwksUnavailable" ? "jwks" : "invalid" };
  }
}

/**
 * Swaps the authorization code for tokens. Returns the id_token or null (reason only, never the response body).
 * @param {any} ctx
 * @param {NonNullable<ReturnType<typeof googleAdminConfig>>} cfg
 * @param {string} code @param {string} codeVerifier
 * @returns {Promise<{ idToken: string } | { reason: string }>}
 */
export async function exchangeCode(ctx, cfg, code, codeVerifier) {
  try {
    const res = await doFetch(ctx)(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }).toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { reason: "token_status" };
    const idToken = (await res.json())?.id_token;
    return typeof idToken === "string" && idToken ? { idToken } : { reason: "no_id_token" };
  } catch (e) {
    return { reason: `token_${(e && /** @type {any} */ (e).name) || "Error"}` };
  }
}
