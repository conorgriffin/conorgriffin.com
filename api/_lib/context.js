// Builds the real context (Upstash, Stripe, Resend) from environment variables, once per warm function.
import { DEFAULT_APP, getApp } from "./apps.js";
import { createMailer } from "./email.js";
import { createRedisStore } from "./store.js";
import { createStripe } from "./stripe.js";

/** Structured logging with a fixed shape. Callers pass names and counts only: never emails, licences or IPs. */
export const log = {
  /** @param {string} msg @param {Record<string, unknown>} [fields] */
  info: (msg, fields = {}) => console.log(JSON.stringify({ level: "info", msg, ...fields })),
  /** @param {string} msg @param {Record<string, unknown>} [fields] */
  warn: (msg, fields = {}) => console.warn(JSON.stringify({ level: "warn", msg, ...fields })),
  /** @param {string} msg @param {Record<string, unknown>} [fields] */
  error: (msg, fields = {}) => console.error(JSON.stringify({ level: "error", msg, ...fields })),
};

/** @type {Map<string, any>} */
const cached = new Map();

/**
 * The context for one app: its Redis namespace, its sender, its settings (`ctx.app`). Everything else (Stripe, Resend
 * key, Redis connection) is shared. `adminStore` is always Tessera's namespace: the admin sign-in sessions and the
 * failed-attempt counters belong to the one admin identity, not to an app.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {import("./apps.js").AppConfig} [app]
 */
export function createContext(env = process.env, app = DEFAULT_APP) {
  // Clients are built on first use, so a route only needs the settings it actually touches
  // (the revocation list needs Redis and the signing key, not Stripe or Resend).
  /** @template T @param {() => T} make @returns {() => T} */
  const lazy = (make) => {
    /** @type {T | undefined} */ let v;
    return () => (v ??= make());
  };
  const redis = (/** @type {string} */ namespace) => createRedisStore({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN, namespace });
  const store = lazy(() => redis(app.redisNamespace));
  const adminStore = lazy(() => (app.redisNamespace === DEFAULT_APP.redisNamespace ? store() : redis(DEFAULT_APP.redisNamespace)));
  const stripe = lazy(() => createStripe({ secretKey: env.STRIPE_SECRET_KEY, apiVersion: env.STRIPE_API_VERSION || undefined }));
  const mailer = lazy(() => createMailer({ apiKey: env.RESEND_API_KEY, from: env[app.env.resendFrom] || app.defaultFrom, replyTo: env.SUPPORT_EMAIL || undefined }));
  return {
    env,
    app,
    get store() { return store(); },
    get adminStore() { return adminStore(); },
    get stripe() { return stripe(); },
    get mailer() { return mailer(); },
    now: () => Date.now(),
    fetch: (/** @type {any} */ url, /** @type {any} */ init) => fetch(url, init),
    log,
    resendMinMs: 800,
  };
}

/** The (cached) real context for an app slug. Unknown slugs throw: routes check the slug first. @param {string} [slug] */
export function getContext(slug = DEFAULT_APP.slug) {
  const app = getApp(slug);
  if (!app) throw new Error("unknown app");
  if (!cached.has(app.slug)) cached.set(app.slug, createContext(process.env, app));
  return cached.get(app.slug);
}
