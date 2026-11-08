# Tessera direct sale: website and licensing server

How Tessera Pro is sold from conorgriffin.com outside the Mac App Store, and what to set up. The formats (license, revocation list) are defined in the Tessera repo, `docs/specs/direct-sale.md`. This repo only implements the server side and the pages.

## What was added

| Route | Purpose |
|---|---|
| `/tessera/buy` | Rewrite to `/api/tessera/go?to=buy`, which 302s to `TESSERA_PAYMENT_LINK_URL` |
| `/tessera/download` | Rewrite to `/api/tessera/go?to=download`, which 302s to `TESSERA_DOWNLOAD_URL` |
| `/api/tessera/price` | Tessera Pro price in the visitor's currency, from Stripe |
| `/tessera/thanks` | Success page after paying: shows the license key (copy, open in Tessera, download). It removes `?session_id=` from the address bar as soon as it has read it, so a reload shows "find my license" instead of the key |
| `/tessera/license` | "Find my license" form (emails the key again) |
| `/tessera/terms` | Terms of sale |
| `/tessera/appcast.xml` | Empty Sparkle 2 feed (served as `application/rss+xml`). Paste release `<item>`s into `public/tessera/appcast.xml` |
| `POST /api/tessera/stripe-webhook` | Stripe events: issue, revoke, un-revoke |
| `GET /api/tessera/license?session_id=cs_…` | Used by the thanks page. Issues the license if the webhook hasn't yet. Only for purchases up to 7 days old (counted from the Checkout Session's creation, not from when the key was issued), and never for a session whose license has been reissued (404 with the find-my-license pointer) |
| `POST /api/tessera/resend` | Find my license. Always answers `{"ok":true}`; rate limited silently |
| `GET /api/tessera/revocations` | Signed revocation list the app polls weekly |
| `GET /api/tessera/reconcile` | Daily Vercel Cron safety net (last 3 days of sessions, refunds, disputes; retries unsent emails) |
| `POST /api/tessera/admin` | Admin only: look up, revoke, un-revoke or replace a license. Accepts the `TESSERA_ADMIN_SECRET` bearer token (CLI) or the signed-in Google session cookie (admin page). See "Admin: revoke or replace a leaked key". Answers 404 to everything while neither is configured, and to any request not addressed to the configured admin host (see `TESSERA_ADMIN_BASE_URL`). Failed attempts are rate limited per IP |
| `/tessera/admin` | Admin page (not linked from anywhere, `noindex`): "Sign in with Google", then search, revoke, un-revoke and reissue. See "Admin page (Sign in with Google)" |
| `GET /api/tessera/admin-login`, `GET /api/tessera/admin-callback`, `GET /api/tessera/admin-session`, `POST /api/tessera/admin-logout` | The Google sign-in flow behind the admin page. All four answer 404 until the Google admin variables below are set, and on any host other than the configured admin host |

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
| `TESSERA_ADMIN_SECRET` | Bearer token for `POST /api/tessera/admin` and the `tessera:admin` CLI. **At least 32 characters**: a shorter value is ignored as if it were unset (the server logs `admin secret too short` once per instance, never the value) and the CLI refuses it. Generate with `openssl rand -hex 32`. **Production only, Sensitive.** Leave it unset to switch the bearer path off (the admin route answers 404 to everything only if the Google admin variables below are unset too). Keep a copy in your password manager: Sensitive values can't be read back from Vercel |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TESSERA_ADMIN_EMAILS`, `TESSERA_ADMIN_SESSION_SECRET` | The admin page's Google sign-in; see "Admin page (Sign in with Google)". All four are needed; with any one missing the page shows "Admin sign-in isn't configured" |
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
- **Revocation.** Full refund revokes. Dispute opened revokes. A refund or dispute that arrives after an admin revoke (`leaked`/`manual`) is still recorded on the license (`paymentRevokedAt`, `paymentRevokeReason`), the customer gets the one factual email, and the admin Unrevoke and Reissue are refused; the revocation list's `seq` only moves when the revoked set changes. A refund or dispute also follows the reissue chain, so a replacement is revoked too. Dispute closed as won clears only a dispute mark, and restores only if the dispute was the only reason (never `leaked`, `manual`, `reissued`, and never after a refund). Partial refunds do nothing. Card-network inquiries (`warning_*` dispute statuses) do nothing, because they aren't chargebacks yet. One factual email is sent on revoke, none on restore.
- **Revocation list.** `seq` is the stored counter plus one, so it starts at 1 and strictly rises on every change. The response is CDN-cached for 10 minutes.
- **Failures.** Transient errors return 500 so Stripe retries (events are marked done only after success). A failed email is retried by the daily cron. Stripe metadata (`license_id`, `license_issued_at`, `license_revoked_at`, `license_revoke_reason`) is best effort and never fails a webhook.
- **Privacy.** Emails, licenses and IPs are never logged. IPs are only used as hashed, expiring rate-limit keys. The revocations route reads no request headers.
- **Find my license.** The response is always `{"ok":true}`. It waits at least 0.8 s before answering so timing doesn't reveal whether the address exists. Limits: 3 per address and 10 per IP per hour.

## Admin page (Sign in with Google)

`https://www.conorgriffin.com/tessera/admin` lets you look up a buyer (by email, license key or license ID), revoke, un-revoke and reissue licenses from a browser, behind "Sign in with Google". It does the same things as the CLI, through the same `POST /api/tessera/admin` route. The CLI keeps working and stays the fallback if Google sign-in is down or not set up.

### Google Cloud Console (one time)

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project (for example "Tessera admin"), or pick an existing one.
2. **APIs & Services > OAuth consent screen** (Google may call this "Google Auth platform > Branding / Audience"): user type **External**, app name **Tessera admin**, your email as support and developer contact. Scopes: only the defaults (`openid`, `email`). Publishing status can stay **Testing**; under Test users add the Google account that will sign in (for example `conorgriffin@gmail.com`). Nobody else needs to be able to sign in, and the server also checks the allowlist below.
3. **APIs & Services > Credentials > Create credentials > OAuth client ID**: application type **Web application**, name "Tessera admin web". Under **Authorized redirect URIs** add exactly `https://www.conorgriffin.com/api/tessera/admin-callback`. No JavaScript origins are needed. Create it and copy the client ID and client secret.

### Vercel environment variables

**Production only. Never add them to Preview.**

| Variable | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | The OAuth client ID (`…apps.googleusercontent.com`). Not sensitive |
| `GOOGLE_CLIENT_SECRET` | The OAuth client secret. **Sensitive** |
| `TESSERA_ADMIN_EMAILS` | Comma-separated list of Google accounts allowed in, for example `conorgriffin@gmail.com`. Compared lowercase and trimmed, and checked again on every admin request, so removing an address signs that person out at once |
| `TESSERA_ADMIN_SESSION_SECRET` | Key that signs the login and session cookies, at least 32 characters. Generate with `openssl rand -hex 32`. **Sensitive.** Changing it signs everyone out |
| `TESSERA_ADMIN_BASE_URL` | Optional. Defaults to `https://www.conorgriffin.com`. The OAuth redirect URI is this plus `/api/tessera/admin-callback`, the admin API only accepts cookie requests whose `Origin` is this origin, and **all five admin routes (`admin`, `admin-login`, `admin-callback`, `admin-session`, `admin-logout`) answer 404 to a request whose host (URL and `Host` header) is not this host**. An unusable value falls back to the default |

**Vercel Deployment Protection.** In Vercel, Settings, Deployment Protection, set Vercel Authentication to **Standard Protection** (or stricter), not "Only Preview Deployments" and not off. Every earlier production deployment keeps its own copy of the variables and stays reachable at its generated `conorgriffin-com-<hash>-….vercel.app` URL; Standard Protection puts those behind Vercel login, and the host check above makes the admin routes 404 there as well. After a secret leak, rotating the variable is not enough on its own for old deployments: also delete the old production deployments or rotate the Upstash, Stripe and Resend tokens, which cuts them all off at once.

Redeploy after adding them. With any of the first four missing, `admin-login`, `admin-callback`, `admin-session` and `admin-logout` answer 404 and the page says "Admin sign-in isn't configured".

### How it works

- **Sign in.** `GET /api/tessera/admin-login` makes a random `state`, `nonce` and PKCE verifier, stores them in a signed, `HttpOnly`, `Secure`, `SameSite=Lax` cookie (`tessera_admin_login`, `Path=/api/tessera`, 10 minutes; Lax so it survives Google's redirect back), and redirects to Google (authorization code flow with PKCE S256, scope `openid email`, `prompt=select_account`).
- **Callback.** `GET /api/tessera/admin-callback` checks `state` against the cookie, swaps the code for tokens at Google (with the client secret and the PKCE verifier), then verifies the ID token itself: RS256 signature against Google's published keys, issuer, audience (your client ID), expiry (60 s of skew), nonce, `email_verified` and that the email is in `TESSERA_ADMIN_EMAILS`. On success it sets the session cookie and redirects to `/tessera/admin`. On failure it redirects to `/tessera/admin?error=denied|state|token|not_allowed` (cancelled at Google, expired or mismatched attempt, token problem, account not allowed) and logs only a short reason, never an email or token.
- **Session.** `__Host-tessera_admin` is an HMAC-signed `{email, sid, exp, v}` cookie: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, no `Domain` (the `__Host-` prefix makes browsers insist on that, so a sibling subdomain can't plant or shadow it), valid 8 hours. `sid` is a random id, and the session also lives in Redis as `adminsess:<sid>` with an 8-hour expiry. Every cookie-authenticated request needs the signature, the Redis entry and the email still on the allowlist; if Redis can't be reached the request is refused. `GET /api/tessera/admin-session` answers `{"signedIn":true,"email":…}` or `{"signedIn":false}`. `POST /api/tessera/admin-logout` deletes the Redis entry and clears the cookie, so a copied cookie value is dead as soon as you sign out (if Redis can't delete it, logout answers 500 and keeps the cookie so you can retry). To end every session at once, change `TESSERA_ADMIN_SESSION_SECRET`. Cookies from before this change (named `tessera_admin`) are ignored: sign in again once.
- **Using it.** The page calls `POST /api/tessera/admin`. With a session cookie the request must also carry `Origin: https://www.conorgriffin.com` (browsers add it on their own; this is the CSRF guard on top of `SameSite=Strict`). Each action is logged as `action`, `lid` and `via: cookie|bearer`, with no emails or keys. Reissuing shows the new key on the page (copyable) and says whether the email went out. Keys are only ever sent in request bodies, never in a URL.
- **Headers.** `vercel.json` serves `/tessera/admin` and `/tessera/admin/` with `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and a `Content-Security-Policy`: `default-src 'self'`; `script-src 'self'` plus the sha256 hash of the one inline script (the dark-mode bootstrap in `tessera/admin/index.html`; no `'unsafe-inline'` for scripts); `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` (React sets a few `style` attributes); `font-src 'self' https://fonts.gstatic.com`; `img-src 'self' data:`; `connect-src 'self'`; `base-uri 'none'`; `object-src 'none'`; `form-action 'self'`; `frame-ancestors 'none'`. **If you edit the inline script in `tessera/admin/index.html`, update the hash in `vercel.json`**: `api/_lib/__tests__/adminPageHeaders.test.js` recomputes it and fails if they drift (`node -e` one-liner: sha256 of the exact text between `<script>` and `</script>`, base64). If the page ever loads another external resource, add its origin there too. The page is not linked from the site or any sitemap.

## Admin: revoke or replace a leaked key

For when a license key shows up somewhere public, or you need to pull one by hand. You can do all of this on the admin page above, or with the CLI. For the CLI, set `TESSERA_ADMIN_SECRET` first (table above; redeploy after adding it), then export it in the shell you use (not on the command line, so it stays out of your history):

```
export TESSERA_ADMIN_SECRET=…    # the value you stored in Vercel
npm run tessera:admin -- lookup buyer@example.com
node scripts/tessera-admin.mjs lookup 0123456789abcdef0123456789abcdef
node scripts/tessera-admin.mjs revoke 'TSR1-eyJ2…' --reason leaked
node scripts/tessera-admin.mjs reissue 0123456789abcdef0123456789abcdef
node scripts/tessera-admin.mjs unrevoke 0123456789abcdef0123456789abcdef
```

`<target>` is a license id (32 lowercase hex characters, the `lid` shown by `lookup`), a full license key (spaces and line breaks are fine; quote it; the signature is not checked, only the id is read), or, for `lookup` only, the buyer's email. `--base` defaults to `https://www.conorgriffin.com` (use the `www` host: the apex redirects, and a redirected POST is unsafe, so the CLI refuses to follow redirects). The CLI prints the JSON answer and exits non-zero on an HTTP error. Under the hood it is `POST /api/tessera/admin` with `Authorization: Bearer <secret>` and `{"action","target","reason"}`.

| Action | What it does |
|---|---|
| `lookup` | Returns `{licenses:[…]}` with `lid`, `email`, `issuedAt`, `revokedAt`, `revokeReason`, `paymentStatus` (`refund`, `dispute` or `null`: the payment itself, whatever else revoked the license first), `paymentRevokedAt`, `emailedAt`, `replacedBy`, `reissuedFrom`. Never the key, and no Stripe ids: the Checkout Session id is itself a link to the key on the thanks endpoint, so look the payment up in Stripe by the buyer's email |
| `revoke` | Adds the id to the revocation list and bumps `revocations:seq`. `--reason leaked` (default) or `manual`. No email to the customer. Stripe metadata is updated as for a refund. Answers `revoked`, `already` or `unknown` |
| `unrevoke` | Restores a license revoked as `leaked` or `manual` (removes it from the list, bumps the seq). Skipped, with the reason, for any license whose payment was refunded or disputed (even if you revoked it as `leaked`/`manual` first; a dispute that is later won clears itself), `reissued` licenses, and licenses that already have a replacement |
| `reissue` | Signs a new key for the same email and payment, points `session:<cs_id>` and `pi:<pi_id>` at it, revokes the old one (reason `reissued`, no email), sets the Stripe `license_id` to the new id, and emails the new key ("Your new Tessera Pro license"). The answer includes `license`, so you can paste it to the buyer if the email fails (it is also retried by the daily job). Works on a live key or one you already revoked as `leaked`/`manual`. Refused whenever the payment was refunded or disputed, including when that happened after your revoke. Safe to repeat: the second call returns `already` with the same replacement and sends nothing |

Typical leak: `lookup` the key, then `reissue` it (that revokes the old one too). To just kill a key with no replacement, `revoke` it.

What the customer sees: a revoked key stops working once the app next fetches the revocation list (it polls about weekly) or on the next update, not instantly. The list itself is CDN-cached for up to 10 minutes. After a reissue, "Find my license" shows only the new key, and the old thanks-page link (`?session_id=…`) answers "not found" instead of serving it. A later refund or dispute for that payment revokes the new key too. A refund or dispute is remembered on the license separately from the reason you gave (`paymentStatus` in `lookup`), so it still blocks `unrevoke` and `reissue` after a `leaked`/`manual` revoke, and a refund that lands while a reissue is running revokes the replacement as well. Reissue does not ask Stripe whether the payment was already refunded before the webhook arrives; check the dashboard first if in doubt.

The route logs no emails or keys. Wrong or missing credentials get 401. Failed attempts are counted per client IP (first `x-forwarded-for` value, stored only as a hash): after 20 in an hour that address gets 429 for everything, even a correct secret, until the hour is up. Keep the secret long (`openssl rand -hex 32`, minimum 32 characters) and rotate it by changing the variable and redeploying.

## Security review fixes

Fixes from the adversarial security review of the license admin:

- **M1** A refund or dispute after an admin revoke is no longer swallowed: it is stored as `paymentRevokedAt` / `paymentRevokeReason`, Unrevoke and Reissue refuse while it is set, a won dispute clears only a dispute mark, and the admin card and `lookup` show it.
- **M2** The thanks-page endpoint counts its 7 days from the purchase and refuses any session whose license was reissued; the thanks page removes `session_id` from the address bar and keeps it in memory only (a reload shows "find my license").
- **L2** A refund or dispute revokes the whole reissue chain, and reissue re-reads the old record before emailing and revokes the replacement if a refund landed meanwhile.
- **L1** Admin routes answer 404 on any host but the configured one. Also set Deployment Protection to Standard (above).
- **L3** CSP, `X-Frame-Options: DENY` and `nosniff` on `/tessera/admin` and `/tessera/admin/`, with a test that keeps the inline-script hash in sync.
- **L4 / I2** Server-side sessions (`adminsess:<sid>` in Redis) so Sign out really ends the session; the cookie is now `__Host-tessera_admin`.
- **L5** `TESSERA_ADMIN_SECRET` must be 32+ characters; failed admin attempts are limited to 20 an hour per IP.
- **I1** `lookup` no longer returns `sessionId` or `paymentIntent`.
- Not done: `CRON_SECRET` has no length rule (the review suggested one; existing deployments may use shorter values), and concurrent read-modify-write of one license record by two admins at the same instant (I4) is unchanged.

## Redis keys

`lic:<lid>`, `session:<cs_id>`, `pi:<pi_id>`, `email:<sha256(lowercased email)>` (set), `revoked` (set), `revocations:seq`, `evt:<event id>` (30-day expiry), `unsent` (set of licenses whose email failed), `reissue:<old lid>` (the replacement's id; claimed atomically so a reissue happens once), `ignored:<cs_id>` (4-day expiry, sessions for other products), `rl:email:<hash>` and `rl:ip:<hash>` (1-hour expiry), `rl:adminfail:<hash of IP>` (failed admin attempts, 1-hour expiry), `adminsess:<sid>` (admin page session, 8-hour expiry), `clicks:download:<YYYY-MM-DD>` and `clicks:buy:<YYYY-MM-DD>` (site clicks per UTC day, counted by `/api/tessera/go` for non-bot GETs, 400-day expiry; shown on the admin page). Licence records also carry `purchasedAt` (the Checkout Session's created time), and `paymentRevokedAt` / `paymentRevokeReason` once the payment was refunded or disputed.

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
