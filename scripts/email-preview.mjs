// Writes sample renders of the four license emails to email-preview/ for eyeballing. Fake data only.
import { mkdirSync, writeFileSync } from "node:fs";
import { licenseEmail, reissuedEmail, resendEmail, revokedEmail } from "../api/_lib/email.js";

const rec = { license: "TSR1-eyJ2IjoxLCJraWQiOiJMMSIsImxpZCI6IlNBTVBMRTAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAiLCJlbWFpbCI6ImJ1eWVyQGV4YW1wbGUuY29tIiwiaWF0IjoxNzYyNjQ3NjAwLCJwcm9kIjoidGVzc2VyYS1wcm8ifQ.SAMPLE_SIGNATURE_doNotUse_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", email: "buyer@example.com" };
const rec2 = { license: "TSR1-eyJ2IjoxLCJsaWQiOiJTQU1QTEUyIn0.SAMPLESIGNATURE2doNotUse", email: "buyer@example.com" };
const support = "support@conorgriffin.com";

const out = new URL("../email-preview/", import.meta.url);
mkdirSync(out, { recursive: true });
const emails = {
  license: licenseEmail(rec, support),
  reissued: reissuedEmail(rec, support),
  resend: resendEmail([rec, rec2], support),
  revoked: revokedEmail(),
};
for (const [name, m] of Object.entries(emails)) {
  writeFileSync(new URL(`${name}.html`, out), m.html);
  console.log(`email-preview/${name}.html  (${m.subject})`);
}
