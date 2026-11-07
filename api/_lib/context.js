// Builds the real context (Upstash, Stripe, Resend) from environment variables, once per warm function.
import { createMailer } from "./email.js";
import { createRedisStore } from "./store.js";
import { createStripe } from "./stripe.js";

/** Structured logging with a fixed shape. Callers pass names and counts only: never emails, licences or IPs. */
export const log = {
  /** @param {string} msg @param {Record<string, unknown>} [fields] */
  warn: (msg, fields = {}) => console.warn(JSON.stringify({ level: "warn", msg, ...fields })),
  /** @param {string} msg @param {Record<string, unknown>} [fields] */
  error: (msg, fields = {}) => console.error(JSON.stringify({ level: "error", msg, ...fields })),
};

/** @type {any} */
let cached;

/** @param {NodeJS.ProcessEnv} [env] */
export function createContext(env = process.env) {
  // Clients are built on first use, so a route only needs the settings it actually touches
  // (the revocation list needs Redis and the signing key, not Stripe or Resend).
  /** @template T @param {() => T} make @returns {() => T} */
  const lazy = (make) => {
    /** @type {T | undefined} */ let v;
    return () => (v ??= make());
  };
  const store = lazy(() => createRedisStore({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN, namespace: "tessera:" }));
  const stripe = lazy(() => createStripe({ secretKey: env.STRIPE_SECRET_KEY, apiVersion: env.STRIPE_API_VERSION || undefined }));
  const mailer = lazy(() => createMailer({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM, replyTo: env.SUPPORT_EMAIL || undefined }));
  return {
    env,
    get store() { return store(); },
    get stripe() { return stripe(); },
    get mailer() { return mailer(); },
    now: () => Date.now(),
    log,
    resendMinMs: 800,
  };
}

export function getContext() {
  cached ??= createContext();
  return cached;
}
