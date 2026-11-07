import assert from "node:assert/strict";
import { test } from "node:test";
import { resetPriceCache, tesseraPrice } from "../handlers.js";
import { NOW_MS, makeCtx } from "./helpers.js";

const prices = { default: "eur", amounts: { eur: 999, gbp: 899, usd: 999 } };
const req = (country) => new Request("https://x/api/tessera/price", { headers: country ? { "x-vercel-ip-country": country } : {} });
function ctxWith({ open = true, lookup = async () => prices, now = () => NOW_MS } = {}) {
  let calls = 0;
  const ctx = makeCtx({ now, stripe: { retrieveProductPrices: async (id) => { calls++; return lookup(id); } } });
  if (open) ctx.env.VITE_TESSERA_SALES_OPEN = "1";
  return { ctx, calls: () => calls };
}

test("price: picks the visitor's currency, else the price's default", async () => {
  resetPriceCache();
  const { ctx } = ctxWith();
  for (const [country, want] of [["GB", { currency: "gbp", amount: 899 }], ["US", { currency: "usd", amount: 999 }],
    ["DE", { currency: "eur", amount: 999 }], ["CA", { currency: "eur", amount: 999 }], [undefined, { currency: "eur", amount: 999 }]]) {
    const res = await tesseraPrice(() => ctx, req(country));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), want, String(country));
    assert.match(res.headers.get("cache-control"), /^private/);
  }
});

test("price: Stripe is asked once an hour, not per visit", async () => {
  resetPriceCache();
  let t = NOW_MS;
  const { ctx, calls } = ctxWith({ now: () => t });
  await tesseraPrice(() => ctx, req("IE"));
  await tesseraPrice(() => ctx, req("GB"));
  assert.equal(calls(), 1);
  t += 61 * 60 * 1000;
  await tesseraPrice(() => ctx, req("GB"));
  assert.equal(calls(), 2);
});

test("price: hidden until sales open, and a Stripe failure is a 502 with nothing cached", async () => {
  resetPriceCache();
  assert.equal((await tesseraPrice(() => ctxWith({ open: false }).ctx, req("IE"))).status, 404);
  const failing = ctxWith({ lookup: async () => { throw new Error("boom"); } });
  assert.equal((await tesseraPrice(() => failing.ctx, req("IE"))).status, 502);
  assert.equal((await tesseraPrice(() => ctxWith().ctx, req("IE"))).status, 200);
  resetPriceCache();
  assert.equal((await tesseraPrice(() => ctxWith({ lookup: async () => null }).ctx, req("IE"))).status, 503);
});
