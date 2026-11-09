// Resend REST client and the email bodies. Email text never goes to logs.

export const SITE = "https://conorgriffin.com";
export const DOWNLOAD_URL = `${SITE}/tessera/download`;
export const FIND_LICENSE_URL = `${SITE}/tessera/license`;

/** @param {string} license */
export const activationUrl = (license) => `tessera-direct://activate?key=${encodeURIComponent(license)}`;

/** Gmail strips custom-scheme hrefs, so emails link to this https page, which hands the key to the app. @param {string} license */
export const activationLink = (license) => `https://www.conorgriffin.com/tessera/activate#key=${encodeURIComponent(license)}`;

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

export const GUIDE_URL = `${SITE}/tessera/guide`;
export const SUPPORT_URL = `${SITE}/tessera/support`;
export const ICON_URL = "https://www.conorgriffin.com/tessera/email-icon.png";

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const BODY = `font-family:${FONT};font-size:15px;line-height:1.55;color:#2a2b3d`;
const LINK = "color:#5d52b4;text-decoration:underline";

/** @param {string} href @param {string} label */
const link = (href, label) => `<a href="${esc(href)}" class="lnk" style="${LINK}">${label}</a>`;

/** @param {string} html */
const p = (html) => `<p class="ink" style="margin:0 0 16px;${BODY}">${html}</p>`;

/** One monospace key block, with an optional muted "Licensed to" line. @param {string} license @param {string} [email] */
const keyBlock = (license, email) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${email ? "6" : "16"}px"><tr><td class="keybox" style="font-family:${MONO};font-size:13px;line-height:1.5;color:#1e2034;background-color:#f3f2fb;border:1px solid #dcd8f3;border-radius:10px;padding:14px;word-break:break-all;overflow-wrap:anywhere">${esc(license)}</td></tr></table>` +
  (email ? `<p class="muted" style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:1.5;color:#6b6c80">Licensed to ${esc(email)}</p>` : "");

/** Bulletproof button: a table cell carries the colour so Outlook honours it. @param {string} href @param {string} label */
const button = (href, label) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px"><tr><td class="btn" align="center" bgcolor="#5d52b4" style="background-color:#5d52b4;border-radius:10px"><a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px">${label}</a></td></tr></table>`;

/**
 * Shared template for every email: table layout, inline styles, dark-mode overrides for clients that honour them.
 * @param {{ preheader: string, bodyHtml: string, footerLinks?: boolean }} o
 */
function layout({ preheader, bodyHtml, footerLinks = true }) {
  const links = footerLinks
    ? `<p class="muted" style="margin:0 0 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:#6b6c80">${[
        ["Download", DOWNLOAD_URL],
        ["Guide", GUIDE_URL],
        ["Support", SUPPORT_URL],
        ["Find my license", FIND_LICENSE_URL],
      ]
        .map(([l, h]) => `<a href="${esc(h)}" class="muted" style="color:#6b6c80;text-decoration:underline">${l}</a>`)
        .join(" &middot; ")}</p>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>Tessera</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme: dark){
.bg{background-color:#13141f !important}
.card{background-color:#1e2034 !important;border-color:#2e3048 !important}
.ink{color:#ececf4 !important}
.muted{color:#a7a8bd !important}
.keybox{background-color:#262842 !important;border-color:#3a3c5c !important;color:#ececf4 !important}
.lnk{color:#b3acf0 !important}
.btn{background-color:#5d52b4 !important}
}
</style></head>
<body class="bg" style="margin:0;padding:0;background-color:#f4f4f8">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${esc(preheader)}</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f8" style="background-color:#f4f4f8"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px">
<tr><td style="padding:0 0 20px 4px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding:0 12px 0 0;vertical-align:middle"><img src="${ICON_URL}" width="48" height="48" alt="Tessera" style="display:block;border:0;border-radius:11px"></td>
<td style="vertical-align:middle"><span class="ink" style="font-family:${FONT};font-size:22px;font-weight:600;line-height:1.2;color:#1e2034">Tessera</span></td>
</tr></table></td></tr>
<tr><td class="card" bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #e6e6ee;border-radius:12px;padding:32px">
${bodyHtml}
</td></tr>
<tr><td align="center" style="padding:20px 8px 0">
${links}
<p class="muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:#6b6c80">Tessera is made by Conor Griffin in Ireland. Payments are handled by Stripe.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

/** @param {string} supportEmail */
const questions = (supportEmail) =>
  p(`Questions? Reply to this email or write to ${link(`mailto:${supportEmail}`, esc(supportEmail))}.`);
const signoff = p("Conor").replace("margin:0 0 16px", "margin:0");

/** @param {{ license: string }} rec */
function licenseBlockText(rec) {
  return `${rec.license}\n\nOpen in Tessera: ${activationLink(rec.license)}`;
}

/** @param {{ license: string, email: string }} rec @param {string} supportEmail */
export function licenseEmail(rec, supportEmail) {
  const subject = "Your Tessera Pro license";
  const text = `Thanks for buying Tessera Pro.

Your license key:

${rec.license}

To activate, open Tessera, go to Settings › Purchases › Enter License… and paste the key. Or open this link on your Mac:
${activationLink(rec.license)}

If your email app wraps the key over several lines, that's fine. Tessera ignores line breaks and spaces.

Download Tessera: ${DOWNLOAD_URL}
Lost this email? Find your license: ${FIND_LICENSE_URL}

Questions? Reply to this email or write to ${supportEmail}.

Conor
`;
  const html = layout({
    preheader: "Your Tessera Pro license key is inside.",
    bodyHtml: [
      p("Thanks for buying Tessera Pro."),
      p("Your license key:"),
      keyBlock(rec.license, rec.email),
      button(activationLink(rec.license), "Open in Tessera &rarr;"),
      p(`To activate, open Tessera, go to <strong>Settings › Purchases › Enter License…</strong> and paste the key. Or ${link(activationLink(rec.license), "open it in Tessera")} on your Mac.`),
      p("If your email app wraps the key over several lines, that's fine. Tessera ignores line breaks and spaces."),
      p(`${link(DOWNLOAD_URL, "Download Tessera")} &middot; ${link(FIND_LICENSE_URL, "Lost this email? Find your license")}`),
      questions(supportEmail),
      signoff,
    ].join("\n"),
  });
  return { subject, text, html };
}

/** Sent with a replacement key. Deliberately says nothing about why. @param {{ license: string, email: string }} rec @param {string} supportEmail */
export function reissuedEmail(rec, supportEmail) {
  const subject = "Your new Tessera Pro license";
  const text = `Here is your new Tessera Pro license key. Your previous key has been replaced and will stop working, so please use this one from now on.

Your new license key:

${rec.license}

To activate, open Tessera, go to Settings › Purchases › Enter License… and paste the key. Or open this link on your Mac:
${activationLink(rec.license)}

If your email app wraps the key over several lines, that's fine. Tessera ignores line breaks and spaces.

Lost this email? Find your license: ${FIND_LICENSE_URL}

Questions? Reply to this email or write to ${supportEmail}.

Conor
`;
  const html = layout({
    preheader: "Your new Tessera Pro license key is inside.",
    bodyHtml: [
      p("Here is your new Tessera Pro license key. Your previous key has been replaced and will stop working, so please use this one from now on."),
      p("Your new license key:"),
      keyBlock(rec.license, rec.email),
      button(activationLink(rec.license), "Open in Tessera &rarr;"),
      p(`To activate, open Tessera, go to <strong>Settings › Purchases › Enter License…</strong> and paste the key. Or ${link(activationLink(rec.license), "open it in Tessera")} on your Mac.`),
      p("If your email app wraps the key over several lines, that's fine. Tessera ignores line breaks and spaces."),
      p(link(FIND_LICENSE_URL, "Lost this email? Find your license")),
      questions(supportEmail),
      signoff,
    ].join("\n"),
  });
  return { subject, text, html };
}

/** @param {{ license: string }[]} recs @param {string} supportEmail */
export function resendEmail(recs, supportEmail) {
  const subject = "Your Tessera Pro license";
  const many = recs.length > 1;
  const text = `Here ${many ? "are your licenses" : "is your license"} for Tessera Pro.

${recs.map((r) => licenseBlockText(r)).join("\n\n---\n\n")}

To activate, open Tessera, go to Settings › Purchases › Enter License… and paste the key. Tessera ignores line breaks and spaces.

Download Tessera: ${DOWNLOAD_URL}
Questions? Reply to this email or write to ${supportEmail}.

Conor
`;
  const html = layout({
    preheader: many ? "Your Tessera Pro license keys are inside." : "Your Tessera Pro license key is inside.",
    bodyHtml: [
      p(`Here ${many ? "are your licenses" : "is your license"} for Tessera Pro.`),
      ...recs.map((r) => keyBlock(r.license) + button(activationLink(r.license), "Open in Tessera &rarr;")),
      p("To activate, open Tessera, go to <strong>Settings › Purchases › Enter License…</strong> and paste the key. Tessera ignores line breaks and spaces."),
      p(link(DOWNLOAD_URL, "Download Tessera")),
      questions(supportEmail),
      signoff,
    ].join("\n"),
  });
  return { subject, text, html };
}

export function revokedEmail() {
  const subject = "Your Tessera Pro license has been deactivated";
  const text =
    "Your Tessera Pro license has been deactivated because the payment was refunded or disputed. Reply to this email if that's a mistake.\n";
  const html = layout({
    preheader: "Your Tessera Pro license has been deactivated.",
    bodyHtml: p("Your Tessera Pro license has been deactivated because the payment was refunded or disputed. Reply to this email if that's a mistake.").replace("margin:0 0 16px", "margin:0"),
  });
  return { subject, text, html };
}
