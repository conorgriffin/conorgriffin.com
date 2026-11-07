// Minimal Stripe REST client (form-encoded). Only the calls this site needs.
// Errors carry the HTTP status only: Stripe error bodies can echo customer data, so they are never logged.

const API = "https://api.stripe.com";

/**
 * Encodes nested params the way Stripe expects: `metadata[a]=b`, `expand[]=x`, `created[gte]=1`.
 * @param {Record<string, any>} params
 * @returns {string}
 */
export function encodeForm(params) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} prefix @param {any} value */
  const add = (prefix, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (v !== null && typeof v === "object") add(`${prefix}[${i}]`, v);
        else out.push(`${prefix}[]=${encodeURIComponent(String(v))}`);
      });
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) add(`${prefix}[${encodeURIComponent(k)}]`, v);
    } else {
      out.push(`${prefix}=${encodeURIComponent(String(value))}`);
    }
  };
  for (const [k, v] of Object.entries(params)) add(encodeURIComponent(k), v);
  return out.join("&");
}

export class StripeError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.name = "StripeError";
    this.status = status;
  }
}

/**
 * @param {{ secretKey: string | undefined, apiVersion?: string, fetch?: typeof fetch }} cfg
 */
export function createStripe({ secretKey, apiVersion, fetch: fetchImpl = fetch }) {
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is required");

  /**
   * @param {"GET" | "POST"} method
   * @param {string} path
   * @param {Record<string, any>} [params]
   */
  async function call(method, path, params = {}) {
    /** @type {Record<string, string>} */
    const headers = { Authorization: `Bearer ${secretKey}` };
    if (apiVersion) headers["Stripe-Version"] = apiVersion;
    const encoded = encodeForm(params);
    let url = `${API}${path}`;
    /** @type {RequestInit} */
    const init = { method, headers };
    if (method === "GET") {
      if (encoded) url += `?${encoded}`;
    } else {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      init.body = encoded;
    }
    const res = await fetchImpl(url, init);
    if (res.status === 404) return null;
    if (!res.ok) throw new StripeError(`stripe ${method} ${path.split("/").slice(0, 3).join("/")} failed (${res.status})`, res.status);
    return res.json();
  }

  /** Lists every page, up to `maxPages`. @param {string} path @param {Record<string, any>} params */
  async function listAll(path, params, maxPages = 10) {
    /** @type {any[]} */
    const items = [];
    let startingAfter;
    for (let page = 0; page < maxPages; page++) {
      const body = await call("GET", path, { ...params, limit: 100, starting_after: startingAfter });
      const data = body?.data ?? [];
      items.push(...data);
      if (!body?.has_more || data.length === 0) break;
      startingAfter = data[data.length - 1].id;
    }
    return items;
  }

  return {
    /**
     * The product's default price in every currency it's sold in, e.g. { default: "eur", amounts: { eur: 999, gbp: 899 } }.
     * Null if the product or its default price is missing.
     * @param {string} productId
     */
    async retrieveProductPrices(productId) {
      const product = await call("GET", `/v1/products/${encodeURIComponent(productId)}`);
      let priceId = typeof product?.default_price === "string" ? product.default_price : product?.default_price?.id;
      if (!priceId) {
        // No default set: fall back to the product's newest active price.
        const list = await call("GET", "/v1/prices", { product: productId, active: true, limit: 1 });
        priceId = list?.data?.[0]?.id;
      }
      if (!priceId) return null;
      const price = await call("GET", `/v1/prices/${encodeURIComponent(priceId)}`, { expand: ["currency_options"] });
      if (!price || typeof price.unit_amount !== "number") return null;
      /** @type {Record<string, number>} */
      const amounts = { [price.currency]: price.unit_amount };
      for (const [cur, opt] of Object.entries(price.currency_options ?? {})) {
        if (typeof (/** @type {any} */ (opt))?.unit_amount === "number") amounts[cur] = /** @type {any} */ (opt).unit_amount;
      }
      return { default: price.currency, amounts };
    },
    /** Checkout Session with line items, or null if Stripe has no such session. @param {string} id */
    retrieveSession: (id) => call("GET", `/v1/checkout/sessions/${encodeURIComponent(id)}`, { expand: ["line_items"] }),
    /** @param {string} id */
    retrieveCharge: (id) => call("GET", `/v1/charges/${encodeURIComponent(id)}`),
    /** Id of the Checkout Session that created a PaymentIntent, or null. @param {string} paymentIntent */
    async findSessionIdByPaymentIntent(paymentIntent) {
      const body = await call("GET", "/v1/checkout/sessions", { payment_intent: paymentIntent, limit: 1 });
      return body?.data?.[0]?.id ?? null;
    },
    /** @param {number} createdGte unix seconds */
    listCompletedSessions: (createdGte) => listAll("/v1/checkout/sessions", { "created": { gte: createdGte }, status: "complete" }),
    /** @param {number} createdGte unix seconds */
    listRefunds: (createdGte) => listAll("/v1/refunds", { created: { gte: createdGte } }),
    /** @param {number} createdGte unix seconds */
    listDisputes: (createdGte) => listAll("/v1/disputes", { created: { gte: createdGte } }),
    /** Best-effort metadata for the dashboard. An empty string removes a key. @param {string} paymentIntent @param {Record<string, string>} metadata */
    updatePaymentIntentMetadata: (paymentIntent, metadata) =>
      call("POST", `/v1/payment_intents/${encodeURIComponent(paymentIntent)}`, { metadata }),
  };
}
