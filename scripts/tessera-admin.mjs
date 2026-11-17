#!/usr/bin/env node
// Admin CLI for the licensing server (Node 22 built-ins only), for every app sold from this site.
//
//   TESSERA_ADMIN_SECRET=… node scripts/tessera-admin.mjs <lookup|revoke|unrevoke|reissue> <target> [--reason leaked|manual] [--base URL]
//   TESSERA_ADMIN_SECRET=… node scripts/tessera-admin.mjs issue-free <email> [--note "who it's for"] [--base URL]
//   SWITCHBOARD_ADMIN_SECRET=… node scripts/tessera-admin.mjs --app switchboard lookup <target>     (npm run switchboard:admin -- lookup <target>)
//
// --app picks the app (default tessera): it chooses the endpoint (/api/<app>/admin) and the secret variable. Each app
// has its own secret.
// <target> is a license id (32 hex), a full license key, or (lookup only) an email address.
// issue-free emails a free Pro license to <email>; the optional note (max 200 characters) is private.
// The secret comes from the environment only, so it never lands in shell history or the process list.
import { parseArgs } from "node:util";

const ACTIONS = ["lookup", "revoke", "unrevoke", "reissue", "issue-free"];
const APPS = { tessera: "TESSERA_ADMIN_SECRET", switchboard: "SWITCHBOARD_ADMIN_SECRET" };
const USAGE = `Usage: node scripts/tessera-admin.mjs [--app tessera|switchboard] <${ACTIONS.join("|")}> <target> [--reason leaked|manual] [--base https://www.conorgriffin.com]
       node scripts/tessera-admin.mjs [--app tessera|switchboard] issue-free <email> [--note "who it's for"] [--base https://www.conorgriffin.com]
Needs TESSERA_ADMIN_SECRET (or SWITCHBOARD_ADMIN_SECRET with --app switchboard) in the environment. <target>: license id, license key, or an email (lookup only).
issue-free gives a free Pro license and emails it; --note is private (max 200 characters).`;

const fail = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      app: { type: "string", default: "tessera" },
      reason: { type: "string" },
      note: { type: "string" },
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

if (!Object.hasOwn(APPS, values.app)) fail(`--app must be one of: ${Object.keys(APPS).join(", ")}.`, 2);
const secretName = APPS[values.app];
const secret = process.env[secretName];
if (!secret) fail(`${secretName} is not set.`, 2);
if (secret.length < 32) fail(`${secretName} must be at least 32 characters (the server ignores a shorter one). Generate one with: openssl rand -hex 32`, 2);
if (values.note !== undefined && action !== "issue-free") fail("--note only applies to issue-free.", 2);
if (values.note !== undefined && values.note.length > 200) fail("--note must be at most 200 characters.", 2);
if (values.reason && action !== "revoke") fail("--reason only applies to revoke.", 2);
if (values.reason && !["leaked", "manual"].includes(values.reason)) fail("--reason must be leaked or manual.", 2);

// The apex domain redirects to www, and a redirected POST is unsafe (it can drop the body or the auth header).
const url = new URL(`/api/${values.app}/admin`, values.base);
if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") fail("--base must be https.", 2);

const body = action === "issue-free"
  ? { action: "issue_free", email: target, ...(values.note ? { note: values.note } : {}) }
  : { action, target, ...(values.reason ? { reason: values.reason } : {}) };
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
