// Writes sample renders of the license emails to email-preview/ for eyeballing (Tessera as license.html, …;
// Audio Switchboard as switchboard-license.html, …). Fake data only.
import { mkdirSync, writeFileSync } from "node:fs";
import { APPS } from "../api/_lib/apps.js";
import { freeLicenseEmail, licenseEmail, reissuedEmail, resendEmail, revokedEmail } from "../api/_lib/email.js";

const rec = { license: "TSR1-eyJ2IjoxLCJraWQiOiJMMSIsImxpZCI6IlNBTVBMRTAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAiLCJlbWFpbCI6ImJ1eWVyQGV4YW1wbGUuY29tIiwiaWF0IjoxNzYyNjQ3NjAwLCJwcm9kIjoidGVzc2VyYS1wcm8ifQ.SAMPLE_SIGNATURE_doNotUse_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", email: "buyer@example.com" };
const rec2 = { license: "TSR1-eyJ2IjoxLCJsaWQiOiJTQU1QTEUyIn0.SAMPLESIGNATURE2doNotUse", email: "buyer@example.com" };
const support = "support@conorgriffin.com";

const out = new URL("../email-preview/", import.meta.url);
mkdirSync(out, { recursive: true });
const emails = {
  license: licenseEmail(rec, support),
  free: freeLicenseEmail(rec, support),
  reissued: reissuedEmail(rec, support),
  resend: resendEmail([rec, rec2], support),
  revoked: revokedEmail({ lid: "3f9c2a7be41d4c0a9e6b8d1f2a7c5e90", email: rec.email }, "support@conorgriffin.com"),
};
const swb = APPS.switchboard;
const swbRec = { license: rec.license.replace(/^TSR1-/, "SWB1-"), email: rec.email };
const swbRec2 = { license: rec2.license.replace(/^TSR1-/, "SWB1-"), email: rec.email };
const swbEmails = {
  "switchboard-license": licenseEmail(swbRec, support, swb),
  "switchboard-free": freeLicenseEmail(swbRec, support, swb),
  "switchboard-reissued": reissuedEmail(swbRec, support, swb),
  "switchboard-resend": resendEmail([swbRec, swbRec2], support, swb),
  "switchboard-revoked": revokedEmail({ lid: "3f9c2a7be41d4c0a9e6b8d1f2a7c5e90", email: rec.email }, support, swb),
};
for (const [name, m] of Object.entries({ ...emails, ...swbEmails })) {
  writeFileSync(new URL(`${name}.html`, out), m.html);
  console.log(`email-preview/${name}.html  (${m.subject})`);
}
