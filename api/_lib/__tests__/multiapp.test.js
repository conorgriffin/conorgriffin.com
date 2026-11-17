// Guards for the multi-app layout: the function count (Vercel Hobby allows 12), Tessera's unchanged URLs, cron and
// rewrites, and Tessera's emails staying byte-for-byte what they were before the app registry existed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { licenseEmail, freeLicenseEmail, reissuedEmail, resendEmail, revokedEmail } from "../email.js";

const root = new URL("../../../", import.meta.url);
const vercel = JSON.parse(readFileSync(new URL("vercel.json", root), "utf8"));
const sha = (s) => createHash("sha256").update(s).digest("hex");

test("one function per route serves every app: api/[app]/*.js, 12 in all, no per-app folders", () => {
  const entries = readdirSync(new URL("api/", root), { withFileTypes: true }).filter((e) => !e.name.startsWith("_"));
  assert.deepEqual(entries.map((e) => e.name), ["[app]"]);
  const routes = readdirSync(new URL("api/[app]/", root)).filter((f) => f.endsWith(".js")).sort();
  assert.deepEqual(routes, [
    "admin-callback.js", "admin-login.js", "admin-logout.js", "admin-session.js", "admin.js", "go.js", "license.js", "price.js",
    "reconcile.js", "resend.js", "revocations.js", "stripe-webhook.js",
  ]);
  assert.ok(routes.length <= 12, "Vercel Hobby: at most 12 serverless functions");
  assert.equal(existsSync(new URL("api/tessera/", root)), false);
});

test("vercel.json: the cron stays within Hobby's limits and the buy/download rewrites exist for both apps", () => {
  assert.equal(vercel.crons.length, 1); // Hobby: 2 cron jobs at most, once a day each
  assert.equal(vercel.crons[0].path, "/api/all/reconcile");
  assert.match(vercel.crons[0].schedule, /^\d+ \d+ \* \* \*$/);
  const rewrites = Object.fromEntries(vercel.rewrites.map((r) => [r.source, r.destination]));
  assert.equal(rewrites["/tessera/buy"], "/api/tessera/go?to=buy&app=tessera");
  assert.equal(rewrites["/tessera/download"], "/api/tessera/go?to=download&app=tessera");
  assert.equal(rewrites["/switchboard/buy"], "/api/switchboard/go?to=buy&app=switchboard");
  assert.equal(rewrites["/switchboard/download"], "/api/switchboard/go?to=download&app=switchboard");
});

test("vercel.json: Switchboard's appcast type and its private pages' headers match Tessera's", () => {
  const headersFor = (source) => Object.fromEntries((vercel.headers.find((h) => h.source === source)?.headers ?? []).map((h) => [h.key, h.value]));
  assert.equal(headersFor("/switchboard/appcast.xml")["Content-Type"], "application/rss+xml; charset=utf-8");
  for (const page of ["thanks", "activate"]) {
    assert.deepEqual(headersFor(`/switchboard/${page}`), headersFor(`/tessera/${page}`));
  }
  assert.ok(readFileSync(new URL("public/switchboard/appcast.xml", root), "utf8").includes("<channel>"));
});

// The five emails for the sample records of scripts/email-preview.mjs, hashed from the code as it was before the
// registry existed. If Tessera's emails are changed on purpose, update these.
const TESSERA_EMAIL_SHA256 = {
  license: "a6c86145b0c455feb77a7ca2238779a98b990df373dd4a8dad6e22a461dac5f6",
  free: "5e4478e0bf67f3f7339b2b22590572135b9e481681c75675b2e11c3aab37c72b",
  reissued: "066fe8902b3b0d71d95abde375f001ebc13bf223925d27bf5c7e0b08352a12ba",
  resend: "0e9a66ee388a4361b917afddc74bf053e82b84a3495a4e64ae0b4cdaf1736d21",
  revoked: "f55ed771ff26bd8f236aa4905646e52b268ee2a76589e9d2f38a92f06a644e84",
};

test("Tessera's emails are byte-for-byte unchanged", () => {
  const rec = { license: "TSR1-eyJ2IjoxLCJraWQiOiJMMSIsImxpZCI6IlNBTVBMRTAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAiLCJlbWFpbCI6ImJ1eWVyQGV4YW1wbGUuY29tIiwiaWF0IjoxNzYyNjQ3NjAwLCJwcm9kIjoidGVzc2VyYS1wcm8ifQ.SAMPLE_SIGNATURE_doNotUse_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", email: "buyer@example.com" };
  const rec2 = { license: "TSR1-eyJ2IjoxLCJsaWQiOiJTQU1QTEUyIn0.SAMPLESIGNATURE2doNotUse", email: "buyer@example.com" };
  const support = "support@conorgriffin.com";
  const emails = {
    license: licenseEmail(rec, support),
    free: freeLicenseEmail(rec, support),
    reissued: reissuedEmail(rec, support),
    resend: resendEmail([rec, rec2], support),
    revoked: revokedEmail({ lid: "3f9c2a7be41d4c0a9e6b8d1f2a7c5e90", email: rec.email }, support),
  };
  for (const [name, m] of Object.entries(emails)) assert.equal(sha(m.html), TESSERA_EMAIL_SHA256[name], name);
});
