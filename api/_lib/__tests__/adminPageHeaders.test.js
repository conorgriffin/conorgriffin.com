// The admin page's security headers (vercel.json) must match what tessera/admin/index.html actually loads.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const config = JSON.parse(read("vercel.json"));
const html = read("tessera/admin/index.html");
const ADMIN_SOURCES = ["/tessera/admin", "/tessera/admin/"];

const headersFor = (source) => {
  const entry = config.headers.find((h) => h.source === source);
  assert.ok(entry, `vercel.json has a headers entry for ${source}`);
  return Object.fromEntries(entry.headers.map((h) => [h.key.toLowerCase(), h.value]));
};
const directives = (csp) => Object.fromEntries(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
  const [name, ...values] = d.split(/\s+/);
  return [name, values];
}));

/** The inline (src-less) <script> blocks of the HTML entry, exactly as written between the tags. */
const inlineScripts = () => [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const hashOf = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

test("the admin page is served with the same hardening headers on /tessera/admin and /tessera/admin/", () => {
  const [a, b] = ADMIN_SOURCES.map(headersFor);
  assert.deepEqual(a, b);
  assert.equal(a["x-frame-options"], "DENY");
  assert.equal(a["x-content-type-options"], "nosniff");
  assert.equal(a["cache-control"], "no-store");
  assert.equal(a["referrer-policy"], "no-referrer");
  assert.equal(a["x-robots-tag"], "noindex, nofollow");
  assert.ok(a["content-security-policy"]);
});

test("CSP: no framing, no base/object/form tricks, same-origin fetches, no unsafe-inline or unsafe-eval scripts", () => {
  const csp = directives(headersFor("/tessera/admin")["content-security-policy"]);
  assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
  assert.deepEqual(csp["base-uri"], ["'none'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
  assert.deepEqual(csp["form-action"], ["'self'"]);
  assert.deepEqual(csp["connect-src"], ["'self'"]);
  assert.deepEqual(csp["default-src"], ["'self'"]);
  assert.ok(!csp["script-src"].includes("'unsafe-inline'") && !csp["script-src"].includes("'unsafe-eval'"));
  assert.ok(!csp["script-src"].some((v) => v.startsWith("http") || v === "*"));
  // Google Fonts are the only third party, for styles and fonts.
  assert.deepEqual(csp["style-src"].filter((v) => v.startsWith("http")), ["https://fonts.googleapis.com"]);
  assert.deepEqual(csp["font-src"].filter((v) => v.startsWith("http")), ["https://fonts.gstatic.com"]);
});

test("CSP: script-src carries a hash for every inline script in tessera/admin/index.html, recomputed from the file", () => {
  const scripts = inlineScripts();
  assert.equal(scripts.length, 1, "the admin entry has exactly the theme bootstrap as an inline script");
  assert.match(scripts[0], /localStorage\.getItem\("theme"\)/);
  for (const source of ADMIN_SOURCES) {
    const csp = directives(headersFor(source)["content-security-policy"]);
    const hashes = csp["script-src"].filter((v) => v.startsWith("'sha256-"));
    assert.deepEqual(hashes, scripts.map(hashOf), `${source}: update the hash in vercel.json when the inline script changes`);
    assert.ok(csp["script-src"].includes("'self'"));
  }
});

test("CSP covers everything the HTML entry loads: external stylesheets/fonts only from Google Fonts, scripts only from this origin", () => {
  const csp = directives(headersFor("/tessera/admin")["content-security-policy"]);
  const urls = [...html.matchAll(/\b(?:href|src)="(https?:\/\/[^"]+)"/g)].map((m) => new URL(m[1]).origin);
  for (const origin of new Set(urls)) {
    assert.ok(
      csp["style-src"].includes(origin) || csp["font-src"].includes(origin),
      `${origin} is loaded by the page but not allowed by the CSP`,
    );
  }
  // The module entry and any other scripts are same-origin paths.
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) assert.ok(m[1].startsWith("/"), `script ${m[1]} is same-origin`);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "no inline event handlers (they would need unsafe-inline)");
  assert.doesNotMatch(html, /<style\b/i);
});
