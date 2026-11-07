// Fakes shared by the tests: in-memory Redis, a scripted Stripe, a recording mailer.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createMemoryStore } from "../store.js";

export const vectors = JSON.parse(readFileSync(new URL("./vectors.json", import.meta.url), "utf8"));

export const PRODUCT_ID = "prod_tessera";
export const WEBHOOK_SECRET = "whsec_test";
export const NOW_MS = 1762600000000; // 2025-11-08, inside the vectors' era

export const baseEnv = {
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  TESSERA_STRIPE_PRODUCT_ID: PRODUCT_ID,
  TESSERA_LICENSE_KID: "T1",
  TESSERA_LICENSE_PRIVATE_KEY: vectors.keys.license.privateKeyPkcs8Base64,
  TESSERA_REVOCATION_KID: "TR1",
  TESSERA_REVOCATION_PRIVATE_KEY: vectors.keys.revocation.privateKeyPkcs8Base64,
  SUPPORT_EMAIL: "support@example.com",
  CRON_SECRET: "cron-secret",
  TESSERA_PAYMENT_LINK_URL: "https://buy.stripe.com/test_link",
  TESSERA_DOWNLOAD_URL: "https://example.com/Tessera.dmg",
};

/** A paid Checkout Session as Stripe returns it with expand[]=line_items. */
export function makeSession(over = {}) {
  return {
    id: "cs_test_abc12345",
    object: "checkout.session",
    created: Math.floor(NOW_MS / 1000) - 60,
    status: "complete",
    payment_status: "paid",
    payment_intent: "pi_1",
    customer_details: { email: "Buyer@Example.com" },
    line_items: { data: [{ price: { product: PRODUCT_ID } }] },
    ...over,
  };
}

export function makeStripe() {
  const state = {
    sessions: new Map(),
    charges: new Map(),
    refunds: [],
    disputes: [],
    metadata: [],
    failMetadata: false,
    calls: [],
  };
  return {
    state,
    async retrieveSession(id) {
      state.calls.push(["retrieveSession", id]);
      return state.sessions.get(id) ?? null;
    },
    async retrieveCharge(id) {
      state.calls.push(["retrieveCharge", id]);
      return state.charges.get(id) ?? null;
    },
    async findSessionIdByPaymentIntent(pi) {
      for (const s of state.sessions.values()) if (s.payment_intent === pi) return s.id;
      return null;
    },
    async listCompletedSessions() {
      return [...state.sessions.values()].filter((s) => s.status === "complete");
    },
    async listRefunds() {
      return state.refunds;
    },
    async listDisputes() {
      return state.disputes;
    },
    async updatePaymentIntentMetadata(pi, metadata) {
      if (state.failMetadata) throw new Error("stripe down");
      state.metadata.push({ pi, metadata });
    },
  };
}

export function makeMailer() {
  const sent = [];
  return {
    sent,
    fail: false,
    async send(message) {
      if (this.fail) throw new Error("resend down");
      sent.push(message);
    },
  };
}

export function makeCtx(overrides = {}) {
  const logs = [];
  const record = (level) => (msg, fields = {}) => logs.push({ level, msg, ...fields });
  const ctx = {
    env: { ...baseEnv },
    store: createMemoryStore(),
    stripe: makeStripe(),
    mailer: makeMailer(),
    now: () => NOW_MS,
    log: { warn: record("warn"), error: record("error") },
    logs,
    resendMinMs: 0,
    ...overrides,
  };
  return ctx;
}

export function stripeHeader(body, { secret = WEBHOOK_SECRET, t = Math.floor(NOW_MS / 1000) } = {}) {
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${sig}`;
}

/** A signed webhook Request for an event. */
export function webhookRequest(event, headerOverride) {
  const body = JSON.stringify(event);
  return new Request("https://conorgriffin.com/api/tessera/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": headerOverride ?? stripeHeader(body) },
    body,
  });
}

let eventCounter = 0;
export const event = (type, object, id = `evt_${++eventCounter}`) => ({ id, type, data: { object } });
