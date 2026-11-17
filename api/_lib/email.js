// Resend REST client and the email bodies. Email text never goes to logs.

import { DEFAULT_APP } from "./apps.js";

// Tessera's links, kept as constants for the existing callers; every email function takes an app (default Tessera).
export const SITE = "https://conorgriffin.com";
export const DOWNLOAD_URL = DEFAULT_APP.urls.download;
export const FIND_LICENSE_URL = DEFAULT_APP.urls.findLicense;

/** @typedef {import("./apps.js").AppConfig} AppConfig */

/** @param {string} license @param {AppConfig} [app] */
export const activationUrl = (license, app = DEFAULT_APP) => `${app.urlScheme}://activate?key=${encodeURIComponent(license)}`;

/** Gmail strips custom-scheme hrefs, so emails link to this https page, which hands the key to the app. @param {string} license @param {AppConfig} [app] */
export const activationLink = (license, app = DEFAULT_APP) => `${app.urls.activate}#key=${encodeURIComponent(license)}`;

/** @param {string} s */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * @param {{ apiKey: string | undefined, from: string | undefined, replyTo?: string, fetch?: typeof fetch }} cfg
 */
export function createMailer({ apiKey, from, replyTo, fetch: fetchImpl = fetch }) {
  if (!apiKey || !from) throw new Error("RESEND_API_KEY and RESEND_FROM are required");
  return {
    /**
     * @param {{ to: string, subject: string, text: string, html?: string, idempotencyKey?: string }} m
     */
    async send({ to, subject, text, html, idempotencyKey }) {
      /** @type {Record<string, string>} */
      const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers,
        body: JSON.stringify({ from, to: [to], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
      });
      if (!res.ok) {
        // Resend explains failures in the body (e.g. a domain that isn't verified). Keep only its short error name.
        let name = "";
        try {
          const body = await res.json();
          if (typeof body?.name === "string" && /^[a-z_]{1,64}$/i.test(body.name)) name = `: ${body.name}`;
        } catch {}
        throw Object.assign(new Error(`resend failed (${res.status})${name}`), { status: res.status, mailer: true });
      }
    },
  };
}

export const GUIDE_URL = DEFAULT_APP.urls.guide ?? "";
export const SUPPORT_URL = DEFAULT_APP.urls.support;
export const ICON_URL = DEFAULT_APP.urls.icon;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const BODY = `font-family:${FONT};font-size:15px;line-height:1.55;color:#2a2b3d`;

/** @param {AppConfig} a @param {string} href @param {string} label */
const link = (a, href, label) => `<a href="${esc(href)}" class="lnk" style="color:${a.email.accent};text-decoration:underline">${label}</a>`;

/** @param {string} html */
const p = (html) => `<p class="ink" style="margin:0 0 16px;${BODY}">${html}</p>`;

/** One monospace key block, with an optional muted "Licensed to" line. @param {AppConfig} a @param {string} license @param {string} [email] */
const keyBlock = (a, license, email) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${email ? "6" : "16"}px"><tr><td class="keybox" style="font-family:${MONO};font-size:13px;line-height:1.5;color:#1e2034;background-color:${a.email.keyBg};border:1px solid ${a.email.keyBorder};border-radius:10px;padding:14px;word-break:break-all;overflow-wrap:anywhere">${esc(license)}</td></tr></table>` +
  (email ? `<p class="muted" style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:1.5;color:#6b6c80">Licensed to ${esc(email)}</p>` : "");

/** Bulletproof button: a table cell carries the colour so Outlook honours it. @param {AppConfig} a @param {string} href @param {string} label */
const button = (a, href, label) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px"><tr><td class="btn" align="center" bgcolor="${a.email.accent}" style="background-color:${a.email.accent};border-radius:10px"><a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px">${label}</a></td></tr></table>`;

/**
 * Shared template for every email, branded by the app: table layout, inline styles, dark-mode overrides for clients that honour them.
 * @param {AppConfig} a
 * @param {{ preheader: string, bodyHtml: string, footerLinks?: boolean }} o
 */
function layout(a, { preheader, bodyHtml, footerLinks = true }) {
  const links = footerLinks
    ? `<p class="muted" style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:#6b6c80">${a.email.footerLinks
        .map(([l, key]) => `<a href="${esc(/** @type {string} */ (a.urls[key]))}" class="muted" style="color:#6b6c80;text-decoration:underline">${l}</a>`)
        .join(" &middot; ")}</p>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(a.name)}</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme: dark){
.bg{background-color:#13141f !important}
.card{background-color:#1e2034 !important;border-color:#2e3048 !important}
.ink{color:#ececf4 !important}
.muted{color:#a7a8bd !important}
.keybox{background-color:${a.email.keyBgDark} !important;border-color:${a.email.keyBorderDark} !important;color:#ececf4 !important}
.lnk{color:${a.email.linkDark} !important}
.btn{background-color:${a.email.accent} !important}
}
</style></head>
<body class="bg" style="margin:0;padding:0;background-color:#f4f4f8">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${esc(preheader)}</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f8" style="background-color:#f4f4f8"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px">
<tr><td style="padding:0 0 20px 4px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding:0 12px 0 0;vertical-align:middle"><img src="${a.urls.icon}" width="48" height="48" alt="${esc(a.name)}" style="display:block;border:0;border-radius:11px"></td>
<td style="vertical-align:middle"><span class="ink" style="font-family:${FONT};font-size:22px;font-weight:600;line-height:1.2;color:#1e2034">${esc(a.name)}</span></td>
</tr></table></td></tr>
<tr><td class="card" bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #e6e6ee;border-radius:12px;padding:32px">
${bodyHtml}
</td></tr>
<tr><td align="center" style="padding:20px 8px 0">
${links}
<p class="muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:#6b6c80">${esc(a.name)} is made by Conor Griffin in Ireland. Payments are handled by Stripe.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

/** @param {AppConfig} a @param {string} supportEmail */
const questions = (a, supportEmail) =>
  p(`Questions? Reply to this email or write to ${link(a, `mailto:${supportEmail}`, esc(supportEmail))}.`);
const signoff = p("Conor").replace("margin:0 0 16px", "margin:0");

/** @param {AppConfig} a @param {{ license: string }} rec */
function licenseBlockText(a, rec) {
  return `${rec.license}\n\nOpen in ${a.name}: ${activationLink(rec.license, a)}`;
}

/** The two ways to activate, as plain text and as html. @param {AppConfig} a */
const activateText = (a) => `${a.copy.activateOpen} ${a.copy.activateMenu} and paste the key.`;
const activateHtml = (/** @type {AppConfig} */ a) => `${a.copy.activateOpen} <strong>${a.copy.activateMenu}</strong> and paste the key.`;

/** @param {{ license: string, email: string }} rec @param {string} supportEmail @param {AppConfig} [a] */
export function licenseEmail(rec, supportEmail, a = DEFAULT_APP) {
  const subject = `Your ${a.productName} license`;
  const text = `Thanks for buying ${a.productName}.

Your license key:

${rec.license}

To activate, ${activateText(a)} Or open this link on your Mac:
${activationLink(rec.license, a)}

If your email app wraps the key over several lines, that's fine. ${a.name} ignores line breaks and spaces.

Download ${a.name}: ${a.urls.download}
Lost this email? Find your license: ${a.urls.findLicense}

Questions? Reply to this email or write to ${supportEmail}.

Conor
`;
  const html = layout(a, {
    preheader: `Your ${a.productName} license key is inside.`,
    bodyHtml: [
      p(`Thanks for buying ${esc(a.productName)}.`),
      p("Your license key:"),
      keyBlock(a, rec.license, rec.email),
      button(a, activationLink(rec.license, a), `Open in ${esc(a.name)} &rarr;`),
      p(`To activate, ${activateHtml(a)} Or ${link(a, activationLink(rec.license, a), `open it in ${esc(a.name)}`)} on your Mac.`),
      p(`If your email app wraps the key over several lines, that's fine. ${esc(a.name)} ignores line breaks and spaces.`),
      p(`${link(a, a.urls.download, `Download ${esc(a.name)}`)} &middot; ${link(a, a.urls.findLicense, "Lost this email? Find your license")}`),
      questions(a, supportEmail),
      signoff,
    ].join("\n"),
  });
  return { subject, text, html };
}

/** Sent when the owner gives a free licence. Never mentions the admin's private note. @param {{ license: string, email: string }} rec @param {string} supportEmail @param {AppConfig} [a] */
export function freeLicenseEmail(rec, supportEmail, a = DEFAULT_APP) {
  const subject = `Your free ${a.productName} license`;
  const text = `Here's a ${a.productName} license for you, on me. Enjoy!

Your license key:

${rec.license}

Licensed to ${rec.email}

To activate, ${activateText(a)} Or open this link on your Mac:
${activationLink(rec.license, a)}

If your email app wraps the key over several lines, that's fine. ${a.name} ignores line breaks and spaces.

Download ${a.name}: ${a.urls.download}
Lost this email? Find your license: ${a.urls.findLicense}

Questions? Reply to this email or write to ${supportEmail}.

Conor
`;
  const html = layout(a, {
    preheader: `A free ${a.productName} license, on me.`,
    bodyHtml: [
      p(`Here's a ${esc(a.productName)} license for you, on me. Enjoy!`),
      p("Your license key:"),
      keyBlock(a, rec.license, rec.email),
      button(a, activationLink(rec.license, a), `Open in ${esc(a.name)} &rarr;`),
      p(`To activate, ${activateHtml(a)} Or ${link(a, activationLink(rec.license, a), `open it in ${esc(a.name)}`)} on your Mac.`),
      p(`If your email app wraps the key over several lines, that's fine. ${esc(a.name)} ignores line breaks and spaces.`),
      p(`${link(a, a.urls.download, `Download ${esc(a.name)}`)} &middot; ${link(a, a.urls.findLicense, "Lost this email? Find your license")}`),
      questions(a, supportEmail),
      signoff,
    ].join("\n"),
  });
  return { subject, text, html };
}

/** Sent with a replacement key. Deliberately says nothing about why. @param {{ license: string, email: string }} rec @param {string} supportEmail @param {AppConfig} [a] */
export function reissuedEmail(rec, supportEmail, a = DEFAULT_APP) {
  const subject = `Your new ${a.productName} license`;
  const text = `Here is your new ${a.productName} license key. Your previous key has been replaced and will stop working, so please use this one from now on.

Your new license key:

${rec.license}

To activate, ${activateText(a)} Or open this link on your Mac:
${activationLink(rec.license, a)}

If your email app wraps the key over several lines, that's fine. ${a.name} ignores line breaks and spaces.

Lost this email? Find your license: ${a.urls.findLicense}

Questions? Reply to this email or write to ${supportEmail}.

Conor
`;
  const html = layout(a, {
    preheader: `Your new ${a.productName} license key is inside.`,
    bodyHtml: [
      p(`Here is your new ${esc(a.productName)} license key. Your previous key has been replaced and will stop working, so please use this one from now on.`),
      p("Your new license key:"),
      keyBlock(a, rec.license, rec.email),
      button(a, activationLink(rec.license, a), `Open in ${esc(a.name)} &rarr;`),
      p(`To activate, ${activateHtml(a)} Or ${link(a, activationLink(rec.license, a), `open it in ${esc(a.name)}`)} on your Mac.`),
      p(`If your email app wraps the key over several lines, that's fine. ${esc(a.name)} ignores line breaks and spaces.`),
      p(link(a, a.urls.findLicense, "Lost this email? Find your license")),
      questions(a, supportEmail),
      signoff,
    ].join("\n"),
  });
  return { subject, text, html };
}

/** @param {{ license: string }[]} recs @param {string} supportEmail @param {AppConfig} [a] */
export function resendEmail(recs, supportEmail, a = DEFAULT_APP) {
  const subject = `Your ${a.productName} license`;
  const many = recs.length > 1;
  const text = `Here ${many ? "are your licenses" : "is your license"} for ${a.productName}.

${recs.map((r) => licenseBlockText(a, r)).join("\n\n---\n\n")}

To activate, ${activateText(a)} ${a.name} ignores line breaks and spaces.

Download ${a.name}: ${a.urls.download}
Questions? Reply to this email or write to ${supportEmail}.

Conor
`;
  const html = layout(a, {
    preheader: many ? `Your ${a.productName} license keys are inside.` : `Your ${a.productName} license key is inside.`,
    bodyHtml: [
      p(`Here ${many ? "are your licenses" : "is your license"} for ${esc(a.productName)}.`),
      ...recs.map((r) => keyBlock(a, r.license) + button(a, activationLink(r.license, a), `Open in ${esc(a.name)} &rarr;`)),
      p(`To activate, ${activateHtml(a)} ${esc(a.name)} ignores line breaks and spaces.`),
      p(link(a, a.urls.download, `Download ${esc(a.name)}`)),
      questions(a, supportEmail),
      signoff,
    ].join("\n"),
  });
  return { subject, text, html };
}

export const BUY_URL = DEFAULT_APP.urls.buy;

/**
 * Sent once when a refund or dispute deactivates a licence. Neutral wording: the app quietly drops back to its free state.
 * @param {{ lid: string, email: string }} rec @param {string} supportEmail @param {AppConfig} [a]
 */
export function revokedEmail(rec, supportEmail, a = DEFAULT_APP) {
  const subject = `Your ${a.productName} license has been deactivated`;
  const text = `Your ${a.productName} license is no longer active. This happens when a payment is refunded or disputed.

Licensed to: ${rec.email}
License ID: ${rec.lid}

${a.copy.revokedKeepsWorking}

If you think this is a mistake, reply to this email with the license ID above and I'll sort it out. You can buy ${a.productName} again at any time: ${a.urls.buy}

Questions? Reply to this email or write to ${supportEmail}.

Conor
`;
  const meta = `<p class="muted" style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:1.6;color:#6b6c80">Licensed to ${esc(rec.email)}<br>License ID ${esc(rec.lid)}</p>`;
  const html = layout(a, {
    preheader: `Your ${a.productName} license is no longer active.`,
    bodyHtml: [
      p(`Your ${esc(a.productName)} license is no longer active. This happens when a payment is refunded or disputed.`),
      meta,
      p(esc(a.copy.revokedKeepsWorking)),
      p(`If you think this is a mistake, reply to this email with the license ID above and I'll sort it out. You can also buy ${esc(a.productName)} again at any time.`),
      button(a, a.urls.buy, `Buy ${esc(a.productName)} &rarr;`),
      questions(a, supportEmail),
      signoff,
    ].join("\n"),
  });
  return { subject, text, html };
}
