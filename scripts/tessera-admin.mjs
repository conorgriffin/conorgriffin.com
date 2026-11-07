#!/usr/bin/env node
// Admin CLI for the Tessera licensing server (Node 22 built-ins only).
//
//   TESSERA_ADMIN_SECRET=… node scripts/tessera-admin.mjs <lookup|revoke|unrevoke|reissue> <target> [--reason leaked|manual] [--base URL]
//
// <target> is a license id (32 hex), a full license key, or (lookup only) an email address.
// The secret comes from the environment only, so it never lands in shell history or the process list.
import { parseArgs } from "node:util";

const ACTIONS = ["lookup", "revoke", "unrevoke", "reissue"];
const USAGE = `Usage: node scripts/tessera-admin.mjs <${ACTIONS.join("|")}> <target> [--reason leaked|manual] [--base https://www.conorgriffin.com]
Needs TESSERA_ADMIN_SECRET in the environment. <target>: license id, license key, or an email (lookup only).`;

const fail = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      reason: { type: "string" },
      base: { type: "string", default: "https://www.conorgriffin.com" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (e) {
  fail(`${e.message}\n${USAGE}`, 2);
}

const { values, positionals } = parsed;
if (values.help) { console.log(USAGE); process.exit(0); }
// A license key pasted with line breaks arrives as several arguments; join them back.
const [action, ...rest] = positionals;
const target = rest.join("");
if (!ACTIONS.includes(action) || !target) fail(USAGE, 2);

const secret = process.env.TESSERA_ADMIN_SECRET;
if (!secret) fail("TESSERA_ADMIN_SECRET is not set.", 2);
if (secret.length < 32) fail("TESSERA_ADMIN_SECRET must be at least 32 characters (the server ignores a shorter one). Generate one with: openssl rand -hex 32", 2);
if (values.reason && action !== "revoke") fail("--reason only applies to revoke.", 2);
if (values.reason && !["leaked", "manual"].includes(values.reason)) fail("--reason must be leaked or manual.", 2);

// The apex domain redirects to www, and a redirected POST is unsafe (it can drop the body or the auth header).
const url = new URL("/api/tessera/admin", values.base);
if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") fail("--base must be https.", 2);

const body = { action, target, ...(values.reason ? { reason: values.reason } : {}) };
let res;
try {
  res = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
} catch (e) {
  fail(`Request failed: ${e.cause?.code ?? e.message}`);
}
if (res.status >= 300 && res.status < 400) fail(`Refusing to follow a redirect to ${res.headers.get("location")}. Pass the final site with --base.`);

const text = await res.text();
let out = text;
try { out = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON: print as is */ }
console.log(out);
if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  process.exit(1);
}
