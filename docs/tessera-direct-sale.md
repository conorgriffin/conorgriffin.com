# Tessera direct sale: website and licensing server

How Tessera Pro is sold from conorgriffin.com outside the Mac App Store, and what to set up. The formats (license, revocation list) are defined in the Tessera repo, `docs/specs/direct-sale.md`. This repo only implements the server side and the pages.

## What was added

| Route | Purpose |
|---|---|
| `/tessera/buy` | Rewrite to `/api/tessera/buy`, which 302s to `TESSERA_PAYMENT_LINK_URL` |
| `/tessera/download` | Rewrite to `/api/tessera/download`, which 302s to `TESSERA_DOWNLOAD_URL` |
| `/tessera/thanks` | Success page after paying: shows the license key (copy, open in Tessera, download) |
| `/tessera/license` | "Find my license" form (emails the key again) |
| `/tessera/terms` | Terms of sale |
| `/tessera/appcast.xml` | Empty Sparkle 2 feed (served as `application/rss+xml`). Paste release `<item>`s into `public/tessera/appcast.xml` |
| `POST /api/tessera/stripe-webhook` | Stripe events: issue, revoke, un-revoke |
| `GET /api/tessera/license?session_id=cs_…` | Used by the thanks page. Issues the license if the webhook hasn't yet. Sessions up to 7 days old |
| `POST /api/tessera/resend` | Find my license. Always answers `{"ok":true}`; rate limited silently |
| `GET /api/tessera/revocations` | Signed revocation list the app polls weekly |
| `GET /api/tessera/reconcile` | Daily Vercel Cron safety net (last 3 days of sessions, refunds, disputes; retries unsent emails) |

Code lives in `api/_lib/` (shared, not routes) and `api/tessera/` (thin route files). No npm dependencies: Node 22 `crypto` and `fetch` only.

## Environment variables

Set these in Vercel, **Production scope only, marked Sensitive. Never add them to Preview** (a preview deploy must not be able to sign licenses or read the customer list).

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | Live secret key (`sk_live_…`), or a restricted key with read on Checkout Sessions, Charges, Refunds, Disputes and write on PaymentIntents |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` of the webhook endpoint below |
| `TESSERA_STRIPE_PRODUCT_ID` | `prod_…` of the Tessera Pro product. Only sessions containing it get a license |
| `TESSERA_PAYMENT_LINK_URL` | The Payment Link URL (`https://buy.stripe.com/…`) |
| `TESSERA_DOWNLOAD_URL` | HTTPS URL of the latest DMG (for example a GitHub release asset) |
| `VITE_TESSERA_SALES_OPEN` | `1` to launch: shows the "Get Tessera" section on /tessera (build time, so redeploy after changing it) and opens /tessera/buy and /tessera/download. Leave unset until launch; test purchases use the Stripe Payment Link URL directly. Not sensitive. |
| `TESSERA_LICENSE_KID` | `L1` |
| `TESSERA_LICENSE_PRIVATE_KEY` | L1 private key, PKCS8 DER, base64 |
| `TESSERA_REVOCATION_KID` | `R1` |
| `TESSERA_REVOCATION_PRIVATE_KEY` | R1 private key, PKCS8 DER, base64 |
| `RESEND_API_KEY` | Resend API key (sending access only) |
| `RESEND_FROM` | For example `Tessera <tessera@conorgriffin.com>` |
| `SUPPORT_EMAIL` | Shown in emails; also used as Reply-To |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Added automatically by the Upstash integration |
| `CRON_SECRET` | Any long random string. Vercel sends it as `Authorization: Bearer …` to the cron route; the route refuses everything if it's unset |
| `STRIPE_API_VERSION` | Optional. Leave unset to use the account's default API version (the code reads only long-stable fields). Set it only if you want to pin one |

Private keys never go in a repo or a chat. Generate them with `tools/licensing/keygen.mjs` in the Tessera repo (once each for L1, L2, R1, R2). The public halves go into the app's `ProductionKeys`; the L1 and R1 private halves go into the two variables above. Keep L2 and R2 offline.

## One-time setup, in order

1. **Keys.** Run the keygen for `L1`, `L2`, `R1`, `R2`. Put the public keys in the app. Store the L1 and R1 private keys in Vercel (step 5) and the others somewhere offline.
2. **Upstash.** Vercel project, Storage, Marketplace, Upstash Redis, create a database, connect it to this project for Production. Confirm `KV_REST_API_URL` and `KV_REST_API_TOKEN` exist.
3. **Resend.** Add the domain `conorgriffin.com`, add the DKIM/SPF DNS records Resend shows, wait for "Verified", then create an API key. Use a sender on that domain for `RESEND_FROM`.
4. **Stripe.**
   1. Create the product "Tessera Pro", one-time price $9.99. Copy its `prod_…` id.
   2. Turn on Managed Payments for the account/product (Stripe dashboard, Settings, Managed Payments) so Stripe is merchant of record. This depends on what Stripe offers your account; if it's unavailable you're the seller and tax is your job.
   3. Create a Payment Link for the price. Under After payment, choose "Don't show confirmation page", redirect to `https://conorgriffin.com/tessera/thanks?session_id={CHECKOUT_SESSION_ID}`. Copy the link URL.
   4. Developers, Webhooks, Add endpoint: `https://conorgriffin.com/api/tessera/stripe-webhook`, events exactly: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Copy the signing secret.
   5. Create the secret key (or a restricted key, see above).
5. **Vercel env vars.** Add every variable from the table: Production only, Sensitive. Then redeploy.
6. **Download.** Upload the DMG somewhere with a stable HTTPS URL and set `TESSERA_DOWNLOAD_URL`. Update it on each release.
7. **Cron.** Already in `vercel.json` (daily, 04:17 UTC). Vercel Cron runs on Production deployments only.
8. **Test mode first.** Do steps 4 to 5 once with Stripe test keys on a throwaway deployment (a separate Vercel project, or temporarily), buy with card 4242 4242 4242 4242, and check: thanks page shows a key, email arrives, `https://…/api/tessera/revocations` returns `{"payload","sig"}`, a refund in the Stripe dashboard adds your license id to the list. Then switch to live keys.
9. **Release the app** with the real public keys, `SUFeedURL` (`https://conorgriffin.com/tessera/appcast.xml`) and the release script from the Tessera repo.

## How it behaves

- **Idempotent issuing.** `session:<cs_id>` is claimed atomically, so the webhook and the thanks page racing produce one license and one email. The license id (`lid`) is 16 random bytes, never a Stripe id.
- **Revocation.** Full refund revokes. Dispute opened revokes. Dispute closed as won restores, only if the dispute caused the revocation. Partial refunds do nothing. Card-network inquiries (`warning_*` dispute statuses) do nothing, because they aren't chargebacks yet. One factual email is sent on revoke, none on restore.
- **Revocation list.** `seq` is the stored counter plus one, so it starts at 1 and strictly rises on every change. The response is CDN-cached for 10 minutes.
- **Failures.** Transient errors return 500 so Stripe retries (events are marked done only after success). A failed email is retried by the daily cron. Stripe metadata (`license_id`, `license_issued_at`, `license_revoked_at`, `license_revoke_reason`) is best effort and never fails a webhook.
- **Privacy.** Emails, licenses and IPs are never logged. IPs are only used as hashed, expiring rate-limit keys. The revocations route reads no request headers.
- **Find my license.** The response is always `{"ok":true}`. It waits at least 0.8 s before answering so timing doesn't reveal whether the address exists. Limits: 3 per address and 10 per IP per hour.

## Redis keys

`lic:<lid>`, `session:<cs_id>`, `pi:<pi_id>`, `email:<sha256(lowercased email)>` (set), `revoked` (set), `revocations:seq`, `evt:<event id>` (30-day expiry), `unsent` (set of licenses whose email failed), `ignored:<cs_id>` (4-day expiry, sessions for other products), `rl:email:<hash>` and `rl:ip:<hash>` (1-hour expiry).

To look at a license by hand, open the Upstash data browser and `GET lic:<lid>`.

## Tests

```
npm run test:api
```

This runs `node --test "api/**/*.test.js"` (Node 22 does not recurse into a bare directory, so a plain `node --test api/` finds nothing). The tests use the shared vectors in `api/_lib/__tests__/vectors.json` (test keys only) and fake Stripe, Redis and email.

## Not verified against the real services

- Stripe Managed Payments specifics: whether Checkout Sessions from a Managed Payments Payment Link carry `payment_intent`, `customer_details.email` and expandable `line_items`. The code copes with a missing PaymentIntent (it falls back to looking the session up by PaymentIntent, and the daily job covers anything missed), but a test-mode purchase is the real check.
- The Vercel Web-standard handler form (`export async function GET(request)`) in plain `.js` files under `api/`, with `"type": "module"`, and a `vercel.json` rewrite to an `/api` route.
- Upstash `EXPIRE … NX` (needs Redis 7 compatible; Upstash supports it).
