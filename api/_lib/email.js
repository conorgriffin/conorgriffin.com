// Resend REST client and the email bodies. Email text never goes to logs.

export const SITE = "https://conorgriffin.com";
export const DOWNLOAD_URL = `${SITE}/tessera/download`;
export const FIND_LICENSE_URL = `${SITE}/tessera/license`;

/** @param {string} license */
export const activationUrl = (license) => `tessera-direct://activate?key=${encodeURIComponent(license)}`;

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
      if (!res.ok) throw new Error(`resend failed (${res.status})`);
    },
  };
}

/** @param {{ license: string }} rec */
function licenseBlockText(rec) {
  return `${rec.license}\n\nOpen in Tessera: ${activationUrl(rec.license)}`;
}

/** @param {{ license: string, email: string }} rec @param {string} supportEmail */
export function licenseEmail(rec, supportEmail) {
  const subject = "Your Tessera Pro license";
  const text = `Thanks for buying Tessera Pro.

Your license key:

${rec.license}

To activate, open Tessera, go to Settings › Purchases › Enter License… and paste the key. Or open this link on your Mac:
${activationUrl(rec.license)}

If your email app wraps the key over several lines, that's fine. Tessera ignores line breaks and spaces.

Download Tessera: ${DOWNLOAD_URL}
Lost this email? Find your license: ${FIND_LICENSE_URL}

Questions? Reply to this email or write to ${supportEmail}.

Conor
`;
  const html = `<!doctype html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;line-height:1.5;color:#1c1d2b;max-width:560px">
<p>Thanks for buying Tessera Pro.</p>
<p>Your license key:</p>
<p style="font-family:ui-monospace,Menlo,monospace;font-size:13px;word-break:break-all;background:#f3f4f8;padding:12px;border-radius:8px">${esc(rec.license)}</p>
<p>To activate, open Tessera, go to <strong>Settings › Purchases › Enter License…</strong> and paste the key. Or <a href="${esc(activationUrl(rec.license))}">open it in Tessera</a> on your Mac.</p>
<p>If your email app wraps the key over several lines, that's fine. Tessera ignores line breaks and spaces.</p>
<p><a href="${DOWNLOAD_URL}">Download Tessera</a> · <a href="${FIND_LICENSE_URL}">Lost this email? Find your license</a></p>
<p>Questions? Reply to this email or write to <a href="mailto:${esc(supportEmail)}">${esc(supportEmail)}</a>.</p>
<p>Conor</p></body></html>`;
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
  const html = `<!doctype html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;line-height:1.5;color:#1c1d2b;max-width:560px">
<p>Here ${many ? "are your licenses" : "is your license"} for Tessera Pro.</p>
${recs
  .map(
    (r) => `<p style="font-family:ui-monospace,Menlo,monospace;font-size:13px;word-break:break-all;background:#f3f4f8;padding:12px;border-radius:8px">${esc(r.license)}</p>
<p><a href="${esc(activationUrl(r.license))}">Open in Tessera</a></p>`,
  )
  .join("\n")}
<p>To activate, open Tessera, go to <strong>Settings › Purchases › Enter License…</strong> and paste the key. Tessera ignores line breaks and spaces.</p>
<p><a href="${DOWNLOAD_URL}">Download Tessera</a></p>
<p>Questions? Reply to this email or write to <a href="mailto:${esc(supportEmail)}">${esc(supportEmail)}</a>.</p>
<p>Conor</p></body></html>`;
  return { subject, text, html };
}

export function revokedEmail() {
  const subject = "Your Tessera Pro license has been deactivated";
  const text =
    "Your Tessera Pro license has been deactivated because the payment was refunded or disputed. Reply to this email if that's a mistake.\n";
  const html = `<!doctype html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;line-height:1.5;color:#1c1d2b;max-width:560px"><p>Your Tessera Pro license has been deactivated because the payment was refunded or disputed. Reply to this email if that's a mistake.</p></body></html>`;
  return { subject, text, html };
}
