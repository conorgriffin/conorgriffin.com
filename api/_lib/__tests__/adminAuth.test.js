import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { GOOGLE_AUTH_URL, GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL, googleAdminConfig, parseCookies, signValue, startSession, verifySignedValue } from "../adminAuth.js";
import { adminCallback, adminHandler, adminLogin, adminLogout, adminSession } from "../handlers.js";
import { issueLicense } from "../licensing.js";
import { NOW_MS, makeCtx, makeSession } from "./helpers.js";

const ORIGIN = "https://www.conorgriffin.com";
const CLIENT_ID = "client-123.apps.googleusercontent.com";
const CLIENT_SECRET = "GOCSPX-secret";
const SESSION_SECRET = "s".repeat(40);
const ADMIN = "conorgriffin@gmail.com";
const BEARER = "admin-secret-0123456789abcdef0123456789abcdef";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };

const b64u = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");
function idToken(claims, { key = privateKey, kid = "k1", alg = "RS256" } = {}) {
  const head = b64u({ alg, kid, typ: "JWT" });
  const body = b64u(claims);
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url");
  return `${head}.${body}.${sig}`;
}
const goodClaims = (nonce, over = {}) => ({
  iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "1", email: ADMIN, email_verified: true,
  nonce, iat: Math.floor(NOW_MS / 1000), exp: Math.floor(NOW_MS / 1000) + 3600, ...over,
});

/** A fake Google: serves the JWKS, and answers the token endpoint with whatever `state.idToken(nonce)` returns. */
function fakeGoogle() {
  const state = { calls: [], tokenBody: null, tokenStatus: 200, idToken: null, jwks: [jwk] };
  const fetchFn = async (url, init = {}) => {
    state.calls.push(String(url));
    if (url === GOOGLE_JWKS_URL) return Response.json({ keys: state.jwks });
    if (url === GOOGLE_TOKEN_URL) {
      state.tokenBody = new URLSearchParams(init.body);
      if (state.tokenStatus !== 200) return Response.json({ error: "invalid_grant" }, { status: state.tokenStatus });
      return Response.json({ access_token: "at", id_token: state.idToken });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { state, fetchFn };
}

function configuredCtx(over = {}) {
  const google = fakeGoogle();
  const ctx = makeCtx({ fetch: google.fetchFn });
  Object.assign(ctx.env, {
    GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, TESSERA_ADMIN_EMAILS: ` ${ADMIN.toUpperCase()} , other@example.com `,
    TESSERA_ADMIN_SESSION_SECRET: SESSION_SECRET, ...over,
  });
  return { ctx, google };
}

const get = (path, headers = {}) => new Request(`${ORIGIN}/api/tessera/${path}`, { headers });
const cookieOf = (res, name) => {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return line ? { line, value: line.split(";")[0].slice(name.length + 1) } : null;
};

/** Runs admin-login and returns what a browser would hold: the cookie and the params Google received. */
async function startLogin(ctx) {
  const res = await adminLogin(() => ctx, get("admin-login"));
  const loc = new URL(res.headers.get("location"));
  return { res, loc, params: loc.searchParams, login: cookieOf(res, "tessera_admin_login") };
}

/** The callback as Google's redirect would produce it. */
const callback = (ctx, { login, params = {}, cookie } = {}) =>
  adminCallback(() => ctx, get(`admin-callback?${new URLSearchParams(params)}`, login || cookie ? { cookie: cookie ?? `tessera_admin_login=${login.value}` } : {}));

/** Full successful-shape flow with a tweakable ID token. */
async function signIn(tweak = {}, { ctx: c, google: g } = configuredCtx()) {
  const { ctx, google } = { ctx: c, google: g };
  const s = await startLogin(ctx);
  const nonce = tweak.nonce ?? s.params.get("nonce");
  google.state.idToken = tweak.token ?? idToken(goodClaims(nonce, tweak.claims), tweak.sign);
  const res = await callback(ctx, { login: s.login, params: { code: "auth-code", state: tweak.state ?? s.params.get("state") } });
  return { res, ctx, google, s };
}
const errorOf = (res) => new URL(res.headers.get("location")).searchParams.get("error");
const SESSION_COOKIE = "__Host-tessera_admin";
const sessionOf = (res) => cookieOf(res, SESSION_COOKIE);
const asSession = (value) => ({ cookie: `${SESSION_COOKIE}=${value}` });

/** A live session as the callback would create it: a Redis entry plus the signed cookie value. */
async function sessionFor(ctx, email = ADMIN, { exp = Math.floor(ctx.now() / 1000) + 3600 } = {}) {
  const { sid } = await startSession(ctx, email);
  return { sid, value: signValue({ email, sid, exp, v: 2 }, SESSION_SECRET, "session") };
}

// ------------------------------------------------------------------ configuration

test("googleAdminConfig: needs client id, secret, a non-empty allowlist and a 32+ char session secret", () => {
  const ok = { GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", TESSERA_ADMIN_EMAILS: "A@x.com, b@x.com,", TESSERA_ADMIN_SESSION_SECRET: "x".repeat(32) };
  const cfg = googleAdminConfig(ok);
  assert.deepEqual([...cfg.emails], ["a@x.com", "b@x.com"]);
  assert.equal(cfg.redirectUri, "https://www.conorgriffin.com/api/tessera/admin-callback");
  assert.equal(googleAdminConfig({ ...ok, TESSERA_ADMIN_BASE_URL: "https://staging.example.com/" }).redirectUri, "https://staging.example.com/api/tessera/admin-callback");
  for (const k of Object.keys(ok)) assert.equal(googleAdminConfig({ ...ok, [k]: "" }), null, k);
  assert.equal(googleAdminConfig({ ...ok, TESSERA_ADMIN_SESSION_SECRET: "x".repeat(31) }), null);
  assert.equal(googleAdminConfig({ ...ok, TESSERA_ADMIN_EMAILS: " , " }), null);
  assert.equal(googleAdminConfig({ ...ok, TESSERA_ADMIN_BASE_URL: "http://evil.example.com" }), null);
});

test("all four routes answer 404 (any method) when Google admin is not configured, each missing setting on its own", async () => {
  for (const missing of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TESSERA_ADMIN_EMAILS", "TESSERA_ADMIN_SESSION_SECRET"]) {
    const { ctx } = configuredCtx({ [missing]: undefined });
    for (const handler of [adminLogin, adminCallback, adminSession, adminLogout]) {
      for (const method of ["GET", "POST"]) {
        const res = await handler(() => ctx, new Request(`${ORIGIN}/api/tessera/x`, { method, ...(method === "POST" ? { body: "" } : {}) }));
        assert.equal(res.status, 404, `${handler.name} ${method} without ${missing}`);
        assert.equal(res.headers.get("set-cookie"), null);
      }
    }
  }
});

test("wrong verbs are 405 once configured", async () => {
  const { ctx } = configuredCtx();
  assert.equal((await adminLogin(() => ctx, new Request(`${ORIGIN}/x`, { method: "POST", body: "" }))).status, 405);
  assert.equal((await adminSession(() => ctx, new Request(`${ORIGIN}/x`, { method: "POST", body: "" }))).status, 405);
  assert.equal((await adminLogout(() => ctx, get("admin-logout"))).status, 405);
});

// ------------------------------------------------------------------ cookies

test("signed values: round trip, tamper, wrong secret, wrong purpose, expiry, junk", () => {
  const exp = Math.floor(NOW_MS / 1000) + 60;
  const v = signValue({ email: "a@b.c", exp, v: 1 }, SESSION_SECRET, "session");
  assert.deepEqual(verifySignedValue(v, SESSION_SECRET, "session", NOW_MS), { email: "a@b.c", exp, v: 1 });
  const [body, sig] = v.split(".");
  const forged = `${Buffer.from(JSON.stringify({ email: "evil@b.c", exp, v: 1 })).toString("base64url")}.${sig}`;
  for (const bad of [forged, `${body}.${sig.slice(0, -2)}AA`, `${body}.`, body, `${v}.x`, "", undefined, "a.b", "!!.!!"]) {
    assert.equal(verifySignedValue(bad, SESSION_SECRET, "session", NOW_MS), null, String(bad).slice(0, 20));
  }
  assert.equal(verifySignedValue(v, "t".repeat(40), "session", NOW_MS), null);
  assert.equal(verifySignedValue(v, SESSION_SECRET, "login", NOW_MS), null);
  assert.equal(verifySignedValue(v, SESSION_SECRET, "session", (exp + 1) * 1000), null);
  assert.equal(verifySignedValue(v, SESSION_SECRET, "session", exp * 1000), null); // expires at exp
});

test("parseCookies handles several cookies, spaces and junk", () => {
  assert.deepEqual(parseCookies("a=1; tessera_admin=x.y;  b=2; junk; =z"), { a: "1", tessera_admin: "x.y", b: "2" });
  assert.deepEqual(parseCookies(null), {});
});

// ------------------------------------------------------------------ login

test("login: 302 to Google with PKCE S256, state, nonce, scope and the fixed redirect_uri; state cookie is signed, 10 min, HttpOnly/Secure/Lax, Path=/api/tessera", async () => {
  const { ctx } = configuredCtx();
  const { res, loc, params, login } = await startLogin(ctx);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(`${loc.origin}${loc.pathname}`, GOOGLE_AUTH_URL);
  assert.equal(params.get("client_id"), CLIENT_ID);
  assert.equal(params.get("redirect_uri"), "https://www.conorgriffin.com/api/tessera/admin-callback");
  assert.equal(params.get("response_type"), "code");
  assert.equal(params.get("scope"), "openid email");
  assert.equal(params.get("prompt"), "select_account");
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.ok(params.get("state").length >= 32 && params.get("nonce").length >= 32);
  assert.notEqual(params.get("state"), params.get("nonce"));

  assert.match(login.line, /; Max-Age=600;/);
  assert.match(login.line, /; Path=\/api\/tessera;/);
  assert.match(login.line, /; HttpOnly/);
  assert.match(login.line, /; Secure/);
  assert.match(login.line, /; SameSite=Lax$/);
  const payload = verifySignedValue(login.value, SESSION_SECRET, "login", NOW_MS);
  assert.equal(payload.state, params.get("state"));
  assert.equal(payload.nonce, params.get("nonce"));
  assert.equal(payload.exp, Math.floor(NOW_MS / 1000) + 600);
  // The challenge is the S256 of the verifier held in the cookie, and the verifier itself is not in the URL.
  assert.equal(params.get("code_challenge"), crypto.createHash("sha256").update(payload.cv).digest("base64url"));
  assert.ok(!loc.href.includes(payload.cv));
  // A second login gets fresh values.
  assert.notEqual((await startLogin(ctx)).params.get("state"), params.get("state"));
});

// ------------------------------------------------------------------ callback

test("callback success: exchanges the code with PKCE + secret, sets the session cookie, clears the login cookie, 302 to /tessera/admin", async () => {
  const { res, google, s, ctx } = await signIn();
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `${ORIGIN}/tessera/admin`);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = google.state.tokenBody;
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "auth-code");
  assert.equal(body.get("client_id"), CLIENT_ID);
  assert.equal(body.get("client_secret"), CLIENT_SECRET);
  assert.equal(body.get("redirect_uri"), "https://www.conorgriffin.com/api/tessera/admin-callback");
  assert.equal(crypto.createHash("sha256").update(body.get("code_verifier")).digest("base64url"), s.params.get("code_challenge"));

  const session = sessionOf(res);
  assert.match(session.line, /; Max-Age=28800;/);
  assert.match(session.line, /; Path=\/;/);
  assert.match(session.line, /; HttpOnly/);
  assert.match(session.line, /; Secure/);
  assert.match(session.line, /; SameSite=Strict$/);
  const payload = verifySignedValue(session.value, SESSION_SECRET, "session", NOW_MS);
  assert.deepEqual({ ...payload, sid: undefined }, { email: ADMIN, sid: undefined, exp: Math.floor(NOW_MS / 1000) + 8 * 3600, v: 2 });
  assert.match(payload.sid, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(ctx.store.strings.get(`adminsess:${payload.sid}`), ADMIN, "the session is live in Redis");
  assert.equal(ctx.store.ttls.get(`adminsess:${payload.sid}`), 8 * 3600);
  assert.ok(!session.line.includes("Domain="));
  assert.ok(session.line.startsWith("__Host-tessera_admin="));
  assert.match(cookieOf(res, "tessera_admin_login").line, /Max-Age=0/);
  // Nothing sensitive in the logs.
  assert.ok(!JSON.stringify(ctx.logs).includes(ADMIN));
});

test("callback success accepts the bare accounts.google.com issuer and an allowlist entry in other case", async () => {
  const r = await signIn({ claims: { iss: "accounts.google.com", email: "Conorgriffin@Gmail.com " } });
  assert.equal(r.res.headers.get("location"), `${ORIGIN}/tessera/admin`);
  assert.ok(sessionOf(r.res));
});

/** Every rejection: redirect to ?error=<code>, no session cookie, login cookie cleared, nothing sensitive logged. */
async function assertRejected(r, code) {
  assert.equal(r.res.status, 302);
  assert.equal(r.res.headers.get("location"), `${ORIGIN}/tessera/admin?error=${code}`);
  assert.equal(sessionOf(r.res), null);
  assert.match(cookieOf(r.res, "tessera_admin_login").line, /Max-Age=0/);
  const logged = JSON.stringify(r.ctx.logs);
  assert.ok(!logged.includes("@"), "no email in logs");
  assert.ok(!logged.includes("auth-code") && !logged.includes(CLIENT_SECRET));
}

test("callback rejects: wrong state, missing state, missing or tampered or expired login cookie", async () => {
  await assertRejected(await signIn({ state: "nope" }), "state");
  await assertRejected(await signIn({ state: "" }), "state");

  const { ctx } = configuredCtx();
  const s = await startLogin(ctx);
  const params = { code: "c", state: s.params.get("state") };
  const noCookie = { ctx, res: await callback(ctx, { params }) };
  await assertRejected(noCookie, "state");
  const [body] = s.login.value.split(".");
  await assertRejected({ ctx, res: await callback(ctx, { params, cookie: `tessera_admin_login=${body}.AAAA` }) }, "state");
  // A session cookie value presented as the login cookie is not accepted (purpose separation).
  const sess = signValue({ state: params.state, nonce: "n", cv: "v", exp: Math.floor(NOW_MS / 1000) + 60 }, SESSION_SECRET, "session");
  await assertRejected({ ctx, res: await callback(ctx, { params, cookie: `tessera_admin_login=${sess}` }) }, "state");
  const late = { ...ctx, now: () => NOW_MS + 11 * 60 * 1000 };
  await assertRejected({ ctx: late, res: await callback(late, { login: s.login, params }) }, "state");
});

test("callback rejects the user cancelling at Google (?error=access_denied) as 'denied'", async () => {
  const { ctx } = configuredCtx();
  const s = await startLogin(ctx);
  await assertRejected({ ctx, res: await callback(ctx, { login: s.login, params: { error: "access_denied", state: s.params.get("state") } }) }, "denied");
});

test("callback rejects: token endpoint failure, no id_token, missing code", async () => {
  const bad = configuredCtx();
  bad.google.state.tokenStatus = 400;
  await assertRejected(await signIn({}, bad), "token");

  const noToken = configuredCtx();
  const s = await startLogin(noToken.ctx);
  noToken.google.state.idToken = undefined;
  await assertRejected({ ctx: noToken.ctx, res: await callback(noToken.ctx, { login: s.login, params: { code: "c", state: s.params.get("state") } }) }, "token");
  await assertRejected({ ctx: noToken.ctx, res: await callback(noToken.ctx, { login: s.login, params: { state: s.params.get("state") } }) }, "token");

  const down = configuredCtx();
  down.ctx.fetch = async () => { throw new Error("network"); };
  await assertRejected(await signIn({}, down), "token");
});

test("callback rejects ID tokens with wrong aud, iss, exp, nonce (as 'token')", async () => {
  await assertRejected(await signIn({ claims: { aud: "someone-else" } }), "token");
  await assertRejected(await signIn({ claims: { iss: "https://evil.example.com" } }), "token");
  await assertRejected(await signIn({ claims: { exp: Math.floor(NOW_MS / 1000) - 61 } }), "token");
  await assertRejected(await signIn({ nonce: "different-nonce" }), "token");
  await assertRejected(await signIn({ claims: { nonce: undefined } }), "token");
  // Within the 60 s clock skew an just-expired token is still fine.
  const ok = await signIn({ claims: { exp: Math.floor(NOW_MS / 1000) - 30 } });
  assert.ok(sessionOf(ok.res));
});

test("callback rejects ID tokens with a bad signature: another key, tampered claims, alg none/HS256, unknown kid, junk", async () => {
  await assertRejected(await signIn({ sign: { key: other.privateKey } }), "token");
  await assertRejected(await signIn({ sign: { kid: "unknown" } }), "token");
  await assertRejected(await signIn({ sign: { alg: "none" } }), "token");
  await assertRejected(await signIn({ sign: { alg: "HS256" } }), "token");
  await assertRejected(await signIn({ token: "not.a.jwt" }), "token");
  await assertRejected(await signIn({ token: "abc" }), "token");
  // Claims swapped after signing.
  const c = configuredCtx();
  const s = await startLogin(c.ctx);
  const [h, , sig] = idToken(goodClaims(s.params.get("nonce"))).split(".");
  c.google.state.idToken = `${h}.${b64u(goodClaims(s.params.get("nonce"), { email: "evil@example.com" }))}.${sig}`;
  const res = await callback(c.ctx, { login: s.login, params: { code: "c", state: s.params.get("state") } });
  await assertRejected({ ctx: c.ctx, res }, "token");
});

test("callback rejects unverified email and non-allowlisted email (not_allowed), without logging the address", async () => {
  await assertRejected(await signIn({ claims: { email_verified: false } }), "not_allowed");
  await assertRejected(await signIn({ claims: { email_verified: "true" } }), "not_allowed");
  await assertRejected(await signIn({ claims: { email_verified: undefined } }), "not_allowed");
  await assertRejected(await signIn({ claims: { email: "stranger@example.com" } }), "not_allowed");
  await assertRejected(await signIn({ claims: { email: undefined } }), "not_allowed");
});

test("JWKS is cached, and refetched once when the kid is unknown (key rotation)", async () => {
  const c = configuredCtx();
  await signIn({}, c);
  await signIn({}, c);
  assert.equal(c.google.state.calls.filter((u) => u === GOOGLE_JWKS_URL).length, 1);
  // Rotation: after the minimum refetch interval a token with a new kid triggers one refetch and succeeds.
  const rotated = { ...jwk, kid: "k2" };
  c.google.state.jwks = [rotated];
  c.ctx.now = () => NOW_MS + 120_000;
  const s = await startLogin(c.ctx);
  c.google.state.idToken = idToken(goodClaims(s.params.get("nonce"), { exp: Math.floor(NOW_MS / 1000) + 7200 }), { kid: "k2" });
  const res = await callback(c.ctx, { login: s.login, params: { code: "c", state: s.params.get("state") } });
  assert.ok(sessionOf(res));
  assert.equal(c.google.state.calls.filter((u) => u === GOOGLE_JWKS_URL).length, 2);
});

// ------------------------------------------------------------------ session + logout

test("admin-session: signed out without a cookie, signed in with a valid one, never cached", async () => {
  const { res, ctx } = await signIn();
  const none = await adminSession(() => ctx, get("admin-session"));
  assert.deepEqual(await none.json(), { signedIn: false });
  assert.equal(none.headers.get("cache-control"), "no-store");
  const ok = await adminSession(() => ctx, get("admin-session", asSession(sessionOf(res).value)));
  assert.deepEqual(await ok.json(), { signedIn: true, email: ADMIN });
  assert.equal(ok.headers.get("cache-control"), "no-store");
});

test("admin-session: tampered, expired, wrong-secret, login-purpose, old-format and de-listed sessions are signed out", async () => {
  const { ctx } = configuredCtx();
  const exp = Math.floor(NOW_MS / 1000) + 3600;
  const { sid, value: good } = await sessionFor(ctx);
  const sign = (payload, secret = SESSION_SECRET, purpose = "session") => signValue(payload, secret, purpose);
  const check = async (value, c = ctx) => (await (await adminSession(() => c, get("admin-session", asSession(value)))).json()).signedIn;
  assert.equal(await check(good), true);
  const [, sig] = good.split(".");
  assert.equal(await check(`${b64u({ email: "other@example.com", sid, exp, v: 2 })}.${sig}`), false); // tampered
  assert.equal(await check(sign({ email: ADMIN, sid, exp: Math.floor(NOW_MS / 1000) - 1, v: 2 })), false); // expired
  assert.equal(await check(sign({ email: ADMIN, sid, exp, v: 2 }, "z".repeat(40))), false);
  assert.equal(await check(sign({ email: ADMIN, sid, exp, v: 2 }, SESSION_SECRET, "login")), false);
  assert.equal(await check(sign({ email: ADMIN, sid, exp, v: 1 })), false); // the old cookie format had no session id
  assert.equal(await check(sign({ email: ADMIN, exp, v: 2 })), false);
  assert.equal(await check(sign({ email: ADMIN, sid: "short", exp, v: 2 })), false);
  assert.equal(await check(sign({ email: ADMIN, sid: 5, exp, v: 2 })), false);
  assert.equal(await check(sign({ email: 5, sid, exp, v: 2 })), false);
  const gone = await sessionFor(ctx, "gone@example.com");
  assert.equal(await check(gone.value), false); // not (or no longer) allowlisted
  const later = { ...ctx, now: () => (exp + 1) * 1000 };
  assert.equal(await check(good, later), false);
});

test("admin-session: a correctly signed cookie whose session id is not in Redis (never created, expired, deleted) is signed out", async () => {
  const { ctx } = configuredCtx();
  const exp = Math.floor(NOW_MS / 1000) + 3600;
  const ghost = signValue({ email: ADMIN, sid: "A".repeat(43), exp, v: 2 }, SESSION_SECRET, "session");
  const check = async (value) => (await (await adminSession(() => ctx, get("admin-session", asSession(value)))).json()).signedIn;
  assert.equal(await check(ghost), false);
  const live = await sessionFor(ctx);
  assert.equal(await check(live.value), true);
  ctx.store.strings.delete(`adminsess:${live.sid}`); // Redis TTL ran out, or someone deleted the key
  assert.equal(await check(live.value), false);
  // A session stored for a different email does not authenticate this cookie.
  const other = await sessionFor(ctx);
  ctx.store.strings.set(`adminsess:${other.sid}`, "other@example.com");
  assert.equal(await check(other.value), false);
});

test("admin-session: fails closed when Redis is unreachable", async () => {
  const { ctx } = configuredCtx();
  const live = await sessionFor(ctx);
  ctx.store.get = async () => { throw new Error("redis down"); };
  const res = await adminSession(() => ctx, get("admin-session", asSession(live.value)));
  assert.deepEqual(await res.json(), { signedIn: false });
});

test("admin-logout: POST with the right Origin deletes the session and clears the cookie (204); wrong or missing Origin is 403 and changes nothing", async () => {
  const { ctx } = configuredCtx();
  const live = await sessionFor(ctx);
  const post = (headers) => adminLogout(() => ctx, new Request(`${ORIGIN}/api/tessera/admin-logout`, { method: "POST", headers }));
  for (const headers of [{}, { origin: "https://evil.example.com" }, { origin: "http://www.conorgriffin.com" }, { origin: "null" }]) {
    const res = await post({ ...headers, ...asSession(live.value) });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("set-cookie"), null);
    assert.ok(ctx.store.strings.has(`adminsess:${live.sid}`), "a rejected logout leaves the session alone");
  }
  const ok = await post({ origin: ORIGIN, ...asSession(live.value) });
  assert.equal(ok.status, 204);
  assert.match(cookieOf(ok, SESSION_COOKIE).line, /^__Host-tessera_admin=; Max-Age=0; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
  assert.ok(!ctx.store.strings.has(`adminsess:${live.sid}`));
  // The copied cookie value is dead now, even though its signature and expiry are fine.
  const after = await adminSession(() => ctx, get("admin-session", asSession(live.value)));
  assert.deepEqual(await after.json(), { signedIn: false });
  // Logging out without a session, or with junk, still just clears the cookie.
  assert.equal((await post({ origin: ORIGIN })).status, 204);
  assert.equal((await post({ origin: ORIGIN, ...asSession("junk.junk") })).status, 204);
});

test("admin-logout: a forged cookie cannot delete someone else's session", async () => {
  const { ctx } = configuredCtx();
  const live = await sessionFor(ctx);
  const forged = signValue({ email: ADMIN, sid: live.sid, exp: Math.floor(NOW_MS / 1000) + 60, v: 2 }, "z".repeat(40), "session");
  const res = await adminLogout(() => ctx, new Request(`${ORIGIN}/api/tessera/admin-logout`, { method: "POST", headers: { origin: ORIGIN, ...asSession(forged) } }));
  assert.equal(res.status, 204);
  assert.ok(ctx.store.strings.has(`adminsess:${live.sid}`));
});

test("admin-logout: if Redis can't delete the session it says so (500) and keeps the cookie so the admin can retry", async () => {
  const { ctx } = configuredCtx();
  const live = await sessionFor(ctx);
  ctx.store.del = async () => { throw new Error("redis down"); };
  const res = await adminLogout(() => ctx, new Request(`${ORIGIN}/api/tessera/admin-logout`, { method: "POST", headers: { origin: ORIGIN, ...asSession(live.value) } }));
  assert.equal(res.status, 500);
  assert.equal(res.headers.get("set-cookie"), null);
});

test("two sign-ins get different session ids, and logging one out leaves the other", async () => {
  const c = configuredCtx();
  const one = await signIn({}, c);
  const two = await signIn({}, c);
  const [a, b] = [one, two].map((r) => verifySignedValue(sessionOf(r.res).value, SESSION_SECRET, "session", NOW_MS).sid);
  assert.notEqual(a, b);
  await adminLogout(() => c.ctx, new Request(`${ORIGIN}/api/tessera/admin-logout`, { method: "POST", headers: { origin: ORIGIN, ...asSession(sessionOf(one.res).value) } }));
  const alive = async (r) => (await (await adminSession(() => c.ctx, get("admin-session", asSession(sessionOf(r.res).value)))).json()).signedIn;
  assert.equal(await alive(one), false);
  assert.equal(await alive(two), true);
});

test("callback: if the session can't be stored in Redis the sign-in fails (no cookie)", async () => {
  const c = configuredCtx();
  c.ctx.store.set = async () => { throw new Error("redis down"); };
  await assertRejected(await signIn({}, c), "token");
});

// ------------------------------------------------------------------ admin API with the cookie

async function adminSetup(over = {}) {
  const { ctx, google } = configuredCtx(over);
  const session = makeSession();
  ctx.stripe.state.sessions.set(session.id, session);
  const rec = (await issueLicense(ctx, session.id)).record;
  ctx.mailer.sent.length = 0;
  return { ctx, google, rec };
}
const sessionCookieValue = async (ctx, email = ADMIN) => (await sessionFor(ctx, email)).value;
const adminCall = (ctx, body, headers, method = "POST") =>
  adminHandler(() => ctx, new Request(`${ORIGIN}/api/tessera/admin`, {
    method, headers: { "content-type": "application/json", ...headers }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  }));

test("admin API with the session cookie works with the right Origin: lookup, revoke, reissue; logs action + lid + via, never email or key", async () => {
  const { ctx, rec } = await adminSetup();
  const headers = { ...asSession(await sessionCookieValue(ctx)), origin: ORIGIN };
  const look = await adminCall(ctx, { action: "lookup", target: rec.lid }, headers);
  assert.equal(look.status, 200);
  assert.equal((await look.json()).licenses[0].lid, rec.lid);
  assert.equal((await adminCall(ctx, { action: "lookup", target: "buyer@example.com" }, headers)).status, 200);
  const rev = await adminCall(ctx, { action: "revoke", target: rec.lid, reason: "manual" }, headers);
  assert.deepEqual(await rev.json(), { result: "revoked", lid: rec.lid });
  const re = await adminCall(ctx, { action: "reissue", target: rec.lid }, headers);
  const reBody = await re.json();
  assert.equal(reBody.result, "reissued");
  assert.match(reBody.license, /^TSR1-/);
  assert.equal(ctx.mailer.sent.length, 1);

  const actions = ctx.logs.filter((l) => l.msg === "admin action");
  assert.deepEqual(actions.map((l) => [l.action, l.via]), [["lookup", "cookie"], ["lookup", "cookie"], ["revoke", "cookie"], ["reissue", "cookie"]]);
  assert.equal(actions[0].lid, rec.lid);
  assert.equal(actions[1].lid, null);
  const logged = JSON.stringify(ctx.logs);
  assert.ok(!logged.includes("buyer@example.com") && !logged.includes("Buyer@Example.com") && !logged.includes(ADMIN) && !logged.includes("TSR1-"));
});

test("admin API with the cookie: wrong, missing or look-alike Origin → 403 and nothing happens", async () => {
  const { ctx, rec } = await adminSetup();
  const body = { action: "revoke", target: rec.lid };
  for (const origin of [undefined, "", "null", "https://evil.example.com", "https://conorgriffin.com", "http://www.conorgriffin.com", `${ORIGIN}.evil.example.com`, `${ORIGIN}/`]) {
    const res = await adminCall(ctx, body, { ...asSession(await sessionCookieValue(ctx)), ...(origin === undefined ? {} : { origin }) });
    assert.equal(res.status, 403, `origin ${origin}`);
    assert.equal((await res.json()).error, "bad_origin");
  }
  assert.equal(ctx.store.sets.get("revoked")?.size ?? 0, 0);
});

test("admin API with the cookie: no, tampered, expired or de-listed cookie → 401; GET with a valid cookie → 405", async () => {
  const { ctx, rec } = await adminSetup();
  const body = { action: "lookup", target: rec.lid };
  const good = await sessionCookieValue(ctx);
  const [b, sig] = good.split(".");
  const cases = [
    {},
    asSession(`${b}.${sig.slice(0, -2)}AA`),
    asSession(`${b64u({ email: ADMIN, sid: "A".repeat(43), exp: 9999999999, v: 2 })}.${sig}`),
    asSession((await sessionFor(ctx, ADMIN, { exp: Math.floor(NOW_MS / 1000) - 5 })).value),
    asSession(await sessionCookieValue(ctx, "gone@example.com")),
  ];
  for (const c of cases) assert.equal((await adminCall(ctx, body, { ...c, origin: ORIGIN })).status, 401);
  assert.equal((await adminCall(ctx, null, { ...asSession(good), origin: ORIGIN }, "GET")).status, 405);
});

test("admin API: after logout the copied cookie is useless (401), though its signature and expiry are fine", async () => {
  const { ctx, rec } = await adminSetup();
  const live = await sessionFor(ctx);
  const headers = { ...asSession(live.value), origin: ORIGIN };
  assert.equal((await adminCall(ctx, { action: "lookup", target: rec.lid }, headers)).status, 200);
  await adminLogout(() => ctx, new Request(`${ORIGIN}/api/tessera/admin-logout`, { method: "POST", headers }));
  const res = await adminCall(ctx, { action: "lookup", target: rec.lid }, headers);
  assert.equal(res.status, 401);
  // ... and deleting only the Redis key (an admin killing a session by hand) works the same way.
  const second = await sessionFor(ctx);
  const h2 = { ...asSession(second.value), origin: ORIGIN };
  assert.equal((await adminCall(ctx, { action: "lookup", target: rec.lid }, h2)).status, 200);
  ctx.store.strings.delete(`adminsess:${second.sid}`);
  assert.equal((await adminCall(ctx, { action: "lookup", target: rec.lid }, h2)).status, 401);
});

test("admin API: the old tessera_admin cookie name is ignored", async () => {
  const { ctx, rec } = await adminSetup();
  const value = await sessionCookieValue(ctx);
  const res = await adminCall(ctx, { action: "lookup", target: rec.lid }, { cookie: `tessera_admin=${value}`, origin: ORIGIN });
  assert.equal(res.status, 401);
});

test("admin API: removing the email from TESSERA_ADMIN_EMAILS ends the session at once", async () => {
  const { ctx, rec } = await adminSetup();
  const headers = { ...asSession(await sessionCookieValue(ctx)), origin: ORIGIN };
  assert.equal((await adminCall(ctx, { action: "lookup", target: rec.lid }, headers)).status, 200);
  ctx.env.TESSERA_ADMIN_EMAILS = "someone-else@example.com";
  assert.equal((await adminCall(ctx, { action: "lookup", target: rec.lid }, headers)).status, 401);
});

test("admin API: the bearer path is unchanged (no Origin needed), and logs via: bearer", async () => {
  const { ctx, rec } = await adminSetup({ TESSERA_ADMIN_SECRET: BEARER });
  const res = await adminCall(ctx, { action: "lookup", target: rec.lid }, { authorization: `Bearer ${BEARER}` });
  assert.equal(res.status, 200);
  assert.equal((await adminCall(ctx, { action: "lookup", target: rec.lid }, { authorization: "Bearer wrong" })).status, 401);
  assert.equal(ctx.logs.find((l) => l.msg === "admin action").via, "bearer");
  // Both configured: the cookie still works too.
  assert.equal((await adminCall(ctx, { action: "lookup", target: rec.lid }, { ...asSession(await sessionCookieValue(ctx)), origin: ORIGIN })).status, 200);
});

test("admin API: a bearer secret cannot be used as a cookie, and the cookie does not need TESSERA_ADMIN_SECRET", async () => {
  const { ctx, rec } = await adminSetup(); // no TESSERA_ADMIN_SECRET at all
  assert.equal(ctx.env.TESSERA_ADMIN_SECRET, undefined);
  assert.equal((await adminCall(ctx, { action: "lookup", target: rec.lid }, { authorization: `Bearer ${BEARER}` })).status, 401); // configured, so not 404
  assert.equal((await adminCall(ctx, { action: "lookup", target: rec.lid }, { ...asSession(await sessionCookieValue(ctx)), origin: ORIGIN })).status, 200);
});

test("admin API is 404 only when neither bearer nor Google admin is configured; a cookie alone does nothing without Google config", async () => {
  const { ctx, rec } = await adminSetup();
  const headers = { ...asSession(await sessionCookieValue(ctx)), origin: ORIGIN };
  for (const k of ["GOOGLE_CLIENT_ID", "TESSERA_ADMIN_SESSION_SECRET"]) delete ctx.env[k];
  assert.equal((await adminCall(ctx, { action: "lookup", target: rec.lid }, headers)).status, 404);
  ctx.env.TESSERA_ADMIN_SECRET = BEARER; // bearer only: cookies are ignored (401), bearer works
  assert.equal((await adminCall(ctx, { action: "lookup", target: rec.lid }, headers)).status, 401);
  assert.equal((await adminCall(ctx, { action: "lookup", target: rec.lid }, { authorization: `Bearer ${BEARER}` })).status, 200);
});
