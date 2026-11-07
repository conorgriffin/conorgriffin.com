// Ed25519 licence and revocation-list signing, plus Stripe webhook signature checks.
// Contract: docs/specs/direct-sale.md in the Tessera repo. No dependencies, Node built-ins only.
import crypto from "node:crypto";

export const LICENSE_PREFIX = "TSR1-";
export const PRODUCT = "tessera-pro";

/** @param {Uint8Array | Buffer} bytes */
export const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

/** Decodes base64url without padding; rejects any other character. @param {string} s */
export function b64urlDecode(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error("bad base64url");
  return Buffer.from(s, "base64url");
}

/**
 * @param {string | undefined} pkcs8Base64 PKCS8 DER, base64
 * @returns {crypto.KeyObject}
 */
export function loadPrivateKey(pkcs8Base64) {
  if (!pkcs8Base64) throw new Error("signing key is not configured");
  const key = crypto.createPrivateKey({ key: Buffer.from(pkcs8Base64, "base64"), format: "der", type: "pkcs8" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("signing key is not Ed25519");
  return key;
}

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** @param {string} rawBase64 raw 32-byte Ed25519 public key, base64 */
export function publicKeyFromRaw(rawBase64) {
  const raw = Buffer.from(rawBase64, "base64");
  if (raw.length !== 32) throw new Error("public key must be 32 bytes");
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: "der", type: "spki" });
}

/**
 * Signs exactly the bytes it encodes, then checks the signature with the matching public key
 * so a wrong or corrupt key fails here and not in a customer's app.
 * @param {object} payload
 * @param {string | undefined} privateKeyBase64
 */
function signPayload(payload, privateKeyBase64) {
  const key = loadPrivateKey(privateKeyBase64);
  const bytes = Buffer.from(JSON.stringify(payload), "utf8"); // compact, key order as written
  const sig = crypto.sign(null, bytes, key);
  if (!crypto.verify(null, bytes, crypto.createPublicKey(key), sig)) throw new Error("self-check failed");
  return { payloadB64: b64url(bytes), sigB64: b64url(sig) };
}

/**
 * @param {{ privateKey: string | undefined, kid: string, lid: string, email: string, iat: number }} p
 * @returns {string} TSR1-<payload>.<signature>
 */
export function signLicense({ privateKey, kid, lid, email, iat }) {
  // Key order is part of the contract: v, kid, lid, email, iat, product.
  const { payloadB64, sigB64 } = signPayload({ v: 1, kid, lid, email, iat, product: PRODUCT }, privateKey);
  return `${LICENSE_PREFIX}${payloadB64}.${sigB64}`;
}

/**
 * @param {{ privateKey: string | undefined, kid: string, seq: number, generated: number, revoked: string[] }} p
 * @returns {{ payload: string, sig: string }}
 */
export function signRevocationList({ privateKey, kid, seq, generated, revoked }) {
  const { payloadB64, sigB64 } = signPayload({ v: 1, kid, seq, generated, revoked }, privateKey);
  return { payload: payloadB64, sig: sigB64 };
}

/**
 * Mirrors the app's verifier; used by tests and as a deploy-time sanity check.
 * @param {string} license
 * @param {Record<string, string>} publicKeys kid → raw public key (base64)
 * @returns {{ ok: true, payload: any } | { ok: false, error: string }}
 */
export function verifyLicense(license, publicKeys) {
  try {
    const s = String(license).replace(/\s+/g, "");
    if (!s.startsWith(LICENSE_PREFIX)) return { ok: false, error: "malformed" };
    const parts = s.slice(LICENSE_PREFIX.length).split(".");
    if (parts.length !== 2) return { ok: false, error: "malformed" };
    const bytes = b64urlDecode(parts[0]);
    const sig = b64urlDecode(parts[1]);
    const payload = JSON.parse(bytes.toString("utf8"));
    const raw = publicKeys[payload.kid];
    if (!raw) return { ok: false, error: "unknownKey" };
    if (!crypto.verify(null, bytes, publicKeyFromRaw(raw), sig)) return { ok: false, error: "badSignature" };
    if (payload.v !== 1) return { ok: false, error: "unsupportedVersion" };
    if (payload.product !== PRODUCT) return { ok: false, error: "wrongProduct" };
    return { ok: true, payload };
  } catch {
    return { ok: false, error: "malformed" };
  }
}

/**
 * @param {{ payload: string, sig: string }} list
 * @param {Record<string, string>} publicKeys kid → raw public key (base64)
 */
export function verifyRevocationList(list, publicKeys) {
  try {
    const bytes = b64urlDecode(list.payload);
    const sig = b64urlDecode(list.sig);
    const payload = JSON.parse(bytes.toString("utf8"));
    const raw = publicKeys[payload.kid];
    if (!raw) return { ok: false, error: "unknownKey" };
    if (!crypto.verify(null, bytes, publicKeyFromRaw(raw), sig)) return { ok: false, error: "badSignature" };
    return { ok: true, payload };
  } catch {
    return { ok: false, error: "malformed" };
  }
}

/** 32 lowercase hex characters from 16 random bytes. */
export const randomLicenseId = () => crypto.randomBytes(16).toString("hex");

/** @param {string} email */
export const emailHash = (email) => crypto.createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex");

/** @param {string} value */
export const sha256Hex = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

/** Constant-time string comparison that tolerates different lengths. */
export function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Verifies a `Stripe-Signature` header: `t=<ts>,v1=<hex>[,v1=<hex>…]`, HMAC-SHA256 of `${t}.${rawBody}`.
 * @param {{ payload: string, header: string | null, secret: string | undefined, nowMs: number, toleranceSeconds?: number }} p
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyStripeSignature({ payload, header, secret, nowMs, toleranceSeconds = 300 }) {
  if (!secret) return { ok: false, reason: "no_secret" };
  if (!header) return { ok: false, reason: "no_header" };
  let timestamp = "";
  /** @type {string[]} */
  const candidates = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") timestamp = v;
    else if (k === "v1") candidates.push(v);
  }
  if (!/^\d{1,12}$/.test(timestamp) || candidates.length === 0) return { ok: false, reason: "malformed_header" };
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest();
  const matched = candidates.some((c) => {
    if (!/^[0-9a-fA-F]{64}$/.test(c)) return false;
    return crypto.timingSafeEqual(expected, Buffer.from(c, "hex"));
  });
  if (!matched) return { ok: false, reason: "mismatch" };
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > toleranceSeconds) return { ok: false, reason: "stale" };
  return { ok: true };
}
