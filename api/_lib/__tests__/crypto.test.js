import assert from "node:assert/strict";
import { test } from "node:test";
import {
  b64urlDecode, signLicense, signRevocationList, verifyLicense, verifyRevocationList, verifyStripeSignature,
} from "../crypto.js";
import { stripeHeader, vectors } from "./helpers.js";

const licenseKeys = { T1: vectors.keys.license.publicKeyBase64 };
const revocationKeys = { TR1: vectors.keys.revocation.publicKeyBase64 };
const p = vectors.license.payload;

test("signing the vector payload with the T1 key reproduces the vector licence exactly", () => {
  const license = signLicense({
    privateKey: vectors.keys.license.privateKeyPkcs8Base64, kid: p.kid, lid: p.lid, email: p.email, iat: p.iat,
  });
  assert.equal(license, vectors.license.valid);
});

test("licence format: TSR1- prefix, compact JSON in the contract's key order, unpadded base64url", () => {
  assert.ok(vectors.license.valid.startsWith("TSR1-"));
  const [payloadB64, sigB64] = vectors.license.valid.slice(5).split(".");
  assert.doesNotMatch(vectors.license.valid, /[=+/]/);
  const text = b64urlDecode(payloadB64).toString("utf8");
  assert.equal(text, '{"v":1,"kid":"T1","lid":"0123456789abcdef0123456789abcdef","email":"buyer@example.com","iat":1762525200,"product":"tessera-pro"}');
  assert.equal(b64urlDecode(sigB64).length, 64);
});

test("the vector licence verifies; whitespace is ignored; tampered, wrong-key and malformed ones do not", () => {
  assert.equal(verifyLicense(vectors.license.valid, licenseKeys).ok, true);
  assert.equal(verifyLicense(vectors.license.validWithWhitespace, licenseKeys).ok, true);
  assert.deepEqual(verifyLicense(vectors.license.tamperedPayload, licenseKeys), { ok: false, error: "badSignature" });
  assert.deepEqual(verifyLicense(vectors.license.signedByOtherKey, licenseKeys), { ok: false, error: "badSignature" });
  assert.deepEqual(verifyLicense(vectors.license.unknownKid, licenseKeys), { ok: false, error: "unknownKey" });
  assert.deepEqual(verifyLicense(vectors.license.wrongProduct, licenseKeys), { ok: false, error: "wrongProduct" });
  for (const bad of vectors.license.malformed) assert.equal(verifyLicense(bad, licenseKeys).ok, false, bad);
});

test("a freshly issued licence round-trips", () => {
  const lic = signLicense({
    privateKey: vectors.keys.license.privateKeyPkcs8Base64, kid: "T1", lid: "a".repeat(32), email: "ünï@example.com", iat: 1,
  });
  const r = verifyLicense(lic, licenseKeys);
  assert.equal(r.ok, true);
  assert.equal(r.payload.email, "ünï@example.com");
});

test("signing refuses a missing or non-Ed25519 key", () => {
  assert.throws(() => signLicense({ privateKey: undefined, kid: "T1", lid: "a", email: "a@b.c", iat: 1 }));
  assert.throws(() => signLicense({ privateKey: "AAAA", kid: "T1", lid: "a", email: "a@b.c", iat: 1 }));
});

test("signing the revocation payload with the TR1 key reproduces the vector list exactly", () => {
  const rp = vectors.revocationList.payload;
  const list = signRevocationList({
    privateKey: vectors.keys.revocation.privateKeyPkcs8Base64, kid: rp.kid, seq: rp.seq, generated: rp.generated, revoked: rp.revoked,
  });
  assert.deepEqual(list, vectors.revocationList.valid);
});

test("revocation list: valid verifies under TR1; a list signed with the licence key is rejected", () => {
  assert.equal(verifyRevocationList(vectors.revocationList.valid, revocationKeys).ok, true);
  assert.deepEqual(verifyRevocationList(vectors.revocationList.signedWithLicenseKey, revocationKeys), { ok: false, error: "badSignature" });
  // And our own licence verifier does not accept a revocation list as a licence either.
  assert.equal(verifyLicense(`TSR1-${vectors.revocationList.valid.payload}.${vectors.revocationList.valid.sig}`, { TR1: revocationKeys.TR1 }).ok, false);
});

// ------------------------------------------------------------ Stripe-Signature

const body = '{"id":"evt_1"}';
const t = 1762600000;
const nowMs = t * 1000;
const check = (header, over = {}) => verifyStripeSignature({ payload: body, header, secret: "whsec_test", nowMs, ...over });

test("stripe signature: valid", () => {
  assert.deepEqual(check(stripeHeader(body, { t })), { ok: true });
});

test("stripe signature: wrong secret, tampered body, missing or malformed header", () => {
  assert.equal(check(stripeHeader(body, { t, secret: "whsec_other" })).ok, false);
  assert.equal(check(stripeHeader('{"id":"evt_2"}', { t })).ok, false);
  assert.equal(check(null).ok, false);
  assert.equal(check("garbage").ok, false);
  assert.equal(check(`t=${t}`).ok, false);
  assert.equal(check(`t=${t},v1=zz`).ok, false);
  assert.equal(check(stripeHeader(body, { t }), { secret: "" }).reason, "no_secret");
});

test("stripe signature: timestamp tolerance is 300 seconds either way", () => {
  assert.equal(check(stripeHeader(body, { t: t - 299 })).ok, true);
  assert.deepEqual(check(stripeHeader(body, { t: t - 301 })), { ok: false, reason: "stale" });
  assert.deepEqual(check(stripeHeader(body, { t: t + 301 })), { ok: false, reason: "stale" });
});

test("stripe signature: any one of several v1 values may match; the timestamp cannot be swapped", () => {
  const good = stripeHeader(body, { t }).split("v1=")[1];
  assert.equal(check(`t=${t},v1=${"0".repeat(64)},v1=${good}`).ok, true);
  assert.equal(check(`t=${t},v1=${good},v1=${"0".repeat(64)}`).ok, true);
  assert.equal(check(`t=${t},v1=${"0".repeat(64)},v1=${"1".repeat(64)}`).ok, false);
  assert.equal(check(`t=${t + 1},v1=${good}`).ok, false);
});
