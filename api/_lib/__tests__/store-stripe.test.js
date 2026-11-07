import assert from "node:assert/strict";
import { test } from "node:test";
import { createRedisStore } from "../store.js";
import { createStripe, encodeForm } from "../stripe.js";
import { createMailer } from "../email.js";

test("encodeForm handles nesting and arrays the way Stripe expects", () => {
  assert.equal(
    encodeForm({ expand: ["line_items"], metadata: { license_id: "abc", empty: "" }, created: { gte: 5 }, skip: undefined }),
    "expand[]=line_items&metadata[license_id]=abc&metadata[empty]=&created[gte]=5",
  );
  assert.equal(encodeForm({ a: "x y&z" }), "a=x%20y%26z");
});

test("Stripe client: form-encoded POST, bearer auth, optional version header, 404 → null", async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    return url.includes("missing") ? new Response("{}", { status: 404 }) : Response.json({ id: "pi_1" });
  };
  const stripe = createStripe({ secretKey: "sk_test", fetch: fake });
  await stripe.updatePaymentIntentMetadata("pi_1", { license_id: "L", license_issued_at: "1" });
  assert.equal(calls[0].url, "https://api.stripe.com/v1/payment_intents/pi_1");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, "metadata[license_id]=L&metadata[license_issued_at]=1");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk_test");
  assert.equal(calls[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(calls[0].init.headers["Stripe-Version"], undefined);

  await stripe.retrieveSession("cs_test_1");
  assert.equal(calls[1].url, "https://api.stripe.com/v1/checkout/sessions/cs_test_1?expand[]=line_items");
  assert.equal(calls[1].init.body, undefined);
  assert.equal(await stripe.retrieveSession("missing"), null);

  const pinned = createStripe({ secretKey: "sk_test", apiVersion: "2025-01-01", fetch: fake });
  await pinned.retrieveCharge("ch_1");
  assert.equal(calls.at(-1).init.headers["Stripe-Version"], "2025-01-01");
});

test("Stripe client: errors carry the status and no response body", async () => {
  const stripe = createStripe({ secretKey: "sk", fetch: async () => new Response('{"error":{"message":"buyer@example.com"}}', { status: 500 }) });
  await assert.rejects(stripe.retrieveCharge("ch_1"), (e) => e.status === 500 && !/buyer@/.test(e.message));
});

test("Stripe client: lists page through has_more", async () => {
  const pages = [
    { data: [{ id: "a" }, { id: "b" }], has_more: true },
    { data: [{ id: "c" }], has_more: false },
  ];
  const urls = [];
  const stripe = createStripe({ secretKey: "sk", fetch: async (u) => (urls.push(u), Response.json(pages.shift())) });
  const items = await stripe.listCompletedSessions(100);
  assert.deepEqual(items.map((i) => i.id), ["a", "b", "c"]);
  assert.match(urls[0], /created\[gte\]=100&status=complete&limit=100$/);
  assert.match(urls[1], /starting_after=b$/);
});

test("Redis store speaks the Upstash REST protocol", async () => {
  const calls = [];
  const fake = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, auth: init.headers.Authorization });
    if (url.endsWith("/pipeline")) return Response.json([{ result: 3 }, { result: 1 }]);
    if (body[0] === "SET" && body.includes("NX")) return Response.json({ result: null });
    return Response.json({ result: body[0] === "GET" ? null : "OK" });
  };
  const store = createRedisStore({ url: "https://kv.example/", token: "tok", fetch: fake });
  assert.equal(await store.get("k"), null);
  assert.equal(await store.set("k", "v", { ex: 60 }), true);
  assert.equal(await store.set("k", "v", { nx: true }), false);
  assert.equal(await store.incrWithExpiry("rl", 3600), 3);
  assert.deepEqual(calls[1].body, ["SET", "k", "v", "EX", 60]);
  assert.deepEqual(calls[2].body, ["SET", "k", "v", "NX"]);
  assert.equal(calls[3].url, "https://kv.example/pipeline");
  assert.deepEqual(calls[3].body, [["INCR", "rl"], ["EXPIRE", "rl", 3600, "NX"]]);
  assert.equal(calls[0].auth, "Bearer tok");
  assert.throws(() => createRedisStore({ url: "", token: "" }));
});

test("Redis store prefixes every key with its namespace", async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push(JSON.parse(init.body));
    if (url.endsWith("/pipeline")) return Response.json([{ result: 1 }, { result: 1 }]);
    return Response.json({ result: "OK" });
  };
  const store = createRedisStore({ url: "https://kv.example", token: "tok", namespace: "tessera:", fetch: fake });
  await store.set("lic:abc", "v");
  await store.sadd("revoked", "abc");
  await store.incrWithExpiry("rl", 60);
  assert.deepEqual(calls[0], ["SET", "tessera:lic:abc", "v"]);
  assert.deepEqual(calls[1], ["SADD", "tessera:revoked", "abc"]);
  assert.deepEqual(calls[2], [["INCR", "tessera:rl"], ["EXPIRE", "tessera:rl", 60, "NX"]]);
});

test("Redis store surfaces errors without the response body", async () => {
  const store = createRedisStore({ url: "https://kv.example", token: "t", fetch: async () => Response.json({ error: "WRONGPASS secret" }, { status: 401 }) });
  await assert.rejects(store.get("k"), (e) => /401/.test(e.message) && !/WRONGPASS/.test(e.message));
});

test("Resend mailer posts JSON with an idempotency key", async () => {
  let seen;
  const mailer = createMailer({ apiKey: "re_1", from: "Tessera <t@example.com>", replyTo: "s@example.com", fetch: async (u, i) => (seen = { u, i }, new Response("{}")) });
  await mailer.send({ to: "a@b.co", subject: "S", text: "T", html: "<p>T</p>", idempotencyKey: "k1" });
  assert.equal(seen.u, "https://api.resend.com/emails");
  assert.equal(seen.i.headers["Idempotency-Key"], "k1");
  assert.deepEqual(JSON.parse(seen.i.body), { from: "Tessera <t@example.com>", to: ["a@b.co"], subject: "S", text: "T", html: "<p>T</p>", reply_to: "s@example.com" });
  const failing = createMailer({ apiKey: "x", from: "f", fetch: async () => new Response("no", { status: 422 }) });
  await assert.rejects(failing.send({ to: "a@b.co", subject: "s", text: "t" }));
});

test("Stripe client: product prices come from the default price and its currency options", async () => {
  const urls = [];
  const fake = async (url) => {
    urls.push(url);
    if (url.includes("/v1/products/")) return Response.json({ id: "prod_1", default_price: "price_1" });
    return Response.json({ id: "price_1", currency: "eur", unit_amount: 999,
      currency_options: { eur: { unit_amount: 999 }, gbp: { unit_amount: 899 }, usd: { unit_amount: 999 } } });
  };
  const stripe = createStripe({ secretKey: "sk_test", fetch: fake });
  assert.deepEqual(await stripe.retrieveProductPrices("prod_1"), { default: "eur", amounts: { eur: 999, gbp: 899, usd: 999 } });
  assert.equal(urls[1], "https://api.stripe.com/v1/prices/price_1?expand[]=currency_options");
});

test("Stripe client: product prices fall back to the newest active price when no default is set", async () => {
  const fake = async (url) => {
    if (url.includes("/v1/products/")) return Response.json({ id: "prod_1", default_price: null });
    if (url.includes("/v1/prices?")) return Response.json({ data: [{ id: "price_2" }] });
    return Response.json({ id: "price_2", currency: "usd", unit_amount: 1299 });
  };
  const stripe = createStripe({ secretKey: "sk_test", fetch: fake });
  assert.deepEqual(await stripe.retrieveProductPrices("prod_1"), { default: "usd", amounts: { usd: 1299 } });
});
