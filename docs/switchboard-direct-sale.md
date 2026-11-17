# Audio Switchboard direct sale: website and licensing server

How Audio Switchboard is sold from conorgriffin.com outside the Mac App Store, and what to set up. The contract (names, license format, revocation list, trial rules) is the Switchboard repo's `docs/specs/direct-sale.md`; this repo implements the server side and the pages. Tessera's setup, which this mirrors, is in [`tessera-direct-sale.md`](tessera-direct-sale.md); read that for the behaviour that is the same in both (idempotent issuing, revocation rules, the admin page, Redis key list).

## How the two apps share one server

Vercel Hobby allows 12 serverless functions and Tessera alone uses 12. So there is one function per route in `api/[app]/` (a dynamic segment), and `/api/tessera/x` and `/api/switchboard/x` are the same function with a different app. Adding a third app adds an entry to `api/_lib/apps.js` and pages, never a function.

- **`api/_lib/apps.js`** is the registry, keyed by slug: display name, license prefix and product string, URL scheme, Redis namespace, every environment variable name, email branding and copy, page paths. The licensing core, handlers, emails and admin all read from it.
- **Which app a request is for.** `appFromRequest` (apps.js) reads it from the URL path, `/api/<app>/<route>`. If the path is not an `/api/` path (the `/switchboard/buy` and `/switchboard/download` rewrites keep their public URL) or Vercel passes the segment unresolved (`[app]`), it falls back to the `app` query parameter, which the rewrites in `vercel.json` set. The path always wins over the query. An unknown slug answers 404 before any handler runs (`api/_lib/route.js`).
- **Tessera is unchanged.** Its URLs, environment variable names, Redis keys (stored under the `tessera:` prefix as before) and email output are exactly what they were; tests pin the emails byte for byte.
- **Isolation between apps.** Each app has its own Redis prefix (`switchboard:` for Audio Switchboard), signing keys, revocation list, Stripe webhook secret, bearer admin secret and admin allowlist. A webhook only fulfils sessions that contain that app's own Stripe product; a refund or dispute only looks up payments in that app's own records, so an event for another app's payment is `unknown` and touches nothing. A Tessera license (`TSR1-`, `tessera-pro`) never validates as Audio Switchboard (`SWB1-`, `switchboard-pro`) or the other way round.
- **Reconcile cron.** One cron entry, daily, calls `GET /api/all/reconcile` (`CRON_SECRET` bearer, as before). It reconciles every registered app in turn, skips an app whose product ID or license key is not set yet (Audio Switchboard before launch), and keeps a failure in one app from stopping the other. `GET /api/<app>/reconcile` still reconciles one app, and `/api/tessera/reconcile` works as before. Hobby allows 2 daily crons; this uses 1.
- **Admin.** One admin page, `/tessera/admin`, with an app picker (Tessera / Audio Switchboard), and one CLI. The Google sign-in, its OAuth client, cookie, secret and host check are shared and unchanged (the four sign-in routes exist under `/api/tessera/` only). Each app has its own bearer secret and its own email allowlist, checked when you act on that app: `POST /api/<app>/admin`. To use the page for Audio Switchboard, an email must be in both `TESSERA_ADMIN_EMAILS` (to sign in) and `SWITCHBOARD_ADMIN_EMAILS`. The CLI: `SWITCHBOARD_ADMIN_SECRET=… npm run switchboard:admin -- lookup buyer@example.com` (or `node scripts/tessera-admin.mjs --app switchboard …`).

## Routes

| Route | Purpose |
|---|---|
| `/switchboard` | Product page. Download and Buy appear only when `VITE_SWITCHBOARD_SALES_OPEN=1`; otherwise it links to the Mac App Store listing |
| `/switchboard/buy`, `/switchboard/download` | Rewrites to `/api/switchboard/go?to=buy|download&app=switchboard`, which count the click and 302 to `SWITCHBOARD_PAYMENT_LINK_URL` / `SWITCHBOARD_DOWNLOAD_URL`. 404 until sales are open |
| `/switchboard/thanks` | After paying: shows the key once (removes `?session_id=` from the address, `no-store`, `no-referrer`) |
| `/switchboard/license` | Find my license |
| `/switchboard/activate` | Bounce page for emails: `#key=SWB1-…` hands the key to the app via `switchboard-direct://activate?key=…` (`noindex`, `no-store`) |
| `/switchboard/terms`, `/switchboard/privacy`, `/switchboard/support` | Terms of sale, privacy policy (with a "Direct-download version" section), support and FAQ |
| `/switchboard/appcast.xml` | Sparkle feed, served as `application/rss+xml`. Empty channel: add release `<item>`s to `public/switchboard/appcast.xml` |
| `POST /api/switchboard/stripe-webhook` | Stripe events for this app |
| `GET /api/switchboard/license?session_id=cs_…`, `POST /api/switchboard/resend`, `GET /api/switchboard/revocations`, `GET /api/switchboard/price` | As for Tessera |
| `POST /api/switchboard/admin` | Admin actions for this app (bearer `SWITCHBOARD_ADMIN_SECRET`, or the Google session if the email is in `SWITCHBOARD_ADMIN_EMAILS`) |

## Environment variables

Production scope only, marked Sensitive (never Preview), as for Tessera.

**New for Audio Switchboard**

| Variable | Value |
|---|---|
| `SWITCHBOARD_STRIPE_PRODUCT_ID` | `prod_…` of the Audio Switchboard product. Only sessions containing it get a license |
| `SWITCHBOARD_STRIPE_WEBHOOK_SECRET` | `whsec_…` of the Audio Switchboard webhook endpoint (not Tessera's) |
| `SWITCHBOARD_PAYMENT_LINK_URL` | The Payment Link URL (`https://buy.stripe.com/…`) |
| `SWITCHBOARD_DOWNLOAD_URL` | HTTPS URL of the latest DMG, normally `https://github.com/conorgriffin/switchboard-releases/releases/latest/download/AudioSwitchboard.dmg` |
| `VITE_SWITCHBOARD_SALES_OPEN` | `1` to launch: shows Download and Buy on `/switchboard` (build time, so redeploy after changing it) and opens `/switchboard/buy` and `/switchboard/download`. Not sensitive. Leave unset until launch |
| `SWITCHBOARD_LICENSE_KID` | `L1` |
| `SWITCHBOARD_LICENSE_PRIVATE_KEY` | Switchboard's own L1 private key, PKCS8 DER, base64. Never Tessera's |
| `SWITCHBOARD_REVOCATION_KID` | `R1` |
| `SWITCHBOARD_REVOCATION_PRIVATE_KEY` | Switchboard's own R1 private key, PKCS8 DER, base64 |
| `SWITCHBOARD_RESEND_FROM` | Optional. Defaults to `Audio Switchboard <switchboard@conorgriffin.com>`. Reply-To is `SUPPORT_EMAIL` |
| `SWITCHBOARD_ADMIN_SECRET` | Optional bearer token for `POST /api/switchboard/admin` and the CLI. At least 32 characters (`openssl rand -hex 32`), otherwise ignored |
| `SWITCHBOARD_ADMIN_EMAILS` | Optional comma-separated Google accounts allowed to act on Audio Switchboard from the admin page. Each must also be in `TESSERA_ADMIN_EMAILS`, which controls who can sign in at all |
| `SALES_ALERT_PER_HOUR`, `SALES_ALERT_EMAIL` | Optional, shared by every app. When paid licenses for one app reach this many in a clock hour (default 5), and again at 10× that, the server emails `SALES_ALERT_EMAIL` (default `SUPPORT_EMAIL`), so a stolen-card spree can be refunded before it turns into disputes |

**Shared with Tessera, already set, nothing to change**: `STRIPE_SECRET_KEY` (the same Stripe account; the product ID tells the apps apart), `STRIPE_API_VERSION`, `RESEND_API_KEY`, `SUPPORT_EMAIL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `CRON_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TESSERA_ADMIN_SESSION_SECRET`, `TESSERA_ADMIN_BASE_URL`.

Until `SWITCHBOARD_STRIPE_PRODUCT_ID` and `SWITCHBOARD_LICENSE_PRIVATE_KEY` are set, the daily job skips Audio Switchboard, and `/api/switchboard/stripe-webhook` and `/api/switchboard/revocations` answer with an error (they have no secret or key to use).

Switchboard has its own key pairs (L1 current, L2 offline backup; R1, R2), never Tessera's. Generate them with the keygen tool in the Switchboard repo, put the public halves in the app and the L1 and R1 private halves in the variables above.

## One-time setup, in order

1. **Keys.** Generate `L1`, `L2`, `R1`, `R2` for Audio Switchboard. Public keys go in the app; L1 and R1 private keys go in Vercel; L2 and R2 stay offline.
2. **Stripe.**
   1. Create the product "Audio Switchboard" with **one price that has currency options**: EUR 9.99 (default), USD 9.99, GBP 8.99. Copy the `prod_…` id.
   2. Managed Payments on, as for Tessera, so Stripe is merchant of record.
   3. Create a Payment Link for the price. After payment, redirect to `https://www.conorgriffin.com/switchboard/thanks?session_id={CHECKOUT_SESSION_ID}`. Copy the link URL.
   4. Developers, Webhooks, Add endpoint: `https://www.conorgriffin.com/api/switchboard/stripe-webhook`, events exactly: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Copy the signing secret into `SWITCHBOARD_STRIPE_WEBHOOK_SECRET`. This is a second endpoint beside Tessera's: each endpoint receives every event it is subscribed to, and each app ignores sessions and payments that are not its own.
3. **Vercel env vars.** Add the table above (Production, Sensitive), then redeploy. `VITE_SWITCHBOARD_SALES_OPEN` stays unset until launch.
4. **Email.** Resend already has `conorgriffin.com` verified, so `switchboard@conorgriffin.com` can send with no new DNS records. Mail sent to that address (replies to a purchase email go to `SUPPORT_EMAIL` instead) needs a **Namecheap email forward**: Domain List, `conorgriffin.com`, Manage, Mail Settings (set to Email Forwarding), add an alias `switchboard` forwarding to your own inbox. Check that `support@conorgriffin.com` (the address on the pages and in `SUPPORT_EMAIL`) forwards too.
5. **Download.** The DMG lives in the `switchboard-releases` GitHub repo. Put its URL in `SWITCHBOARD_DOWNLOAD_URL`.
6. **Test mode first.** Do the Stripe steps with test keys on a throwaway deployment, buy with card 4242 4242 4242 4242, and check: the thanks page shows an `SWB1-` key, the email arrives from Audio Switchboard, `/api/switchboard/revocations` returns `{"payload","sig"}`, a refund adds the license id to that list and not to Tessera's. Then live keys.
7. **Release the app** with the real public keys and `SUFeedURL` set to `https://www.conorgriffin.com/switchboard/appcast.xml`.

## Redis

Same keys as Tessera's list (`lic:`, `session:`, `pi:`, `email:`, `revoked`, `revocations:seq`, `evt:`, `unsent`, `reissue:`, `ignored:`, `rl:…`, `clicks:…`), all stored under the prefix `switchboard:`. Admin sign-in sessions and failed-attempt counters are shared by both apps and live under `tessera:` (`tessera:adminsess:<sid>`, `tessera:rl:adminfail:<hash>`).

## Placeholders and open points

- `public/switchboard/icon.png` is the 176px app icon copied from the landing page repo (`switchboard-landing-page`). Emails and the pages use it. Replace it with a proper 256px export when there is one (Tessera's email icon is 256px).
- The product page has no screenshots yet and no version line.
- The Mac App Store link on the product page is `https://apps.apple.com/us/app/audio-switchboard/id6761267361`, taken from the landing page repo.
- The pages and emails say Switchboard's Settings has a Purchase section (spec: "the Purchase section in Settings"); adjust the wording in `api/_lib/apps.js` (`copy`) and `src/switchboard/` once the direct build's UI is final.
- Email branding colours for Audio Switchboard (`email` in `apps.js`) were taken from the landing page's accent colour.

## Not verified against the real services

- That Vercel resolves `/api/tessera/<route>` to `api/[app]/<route>.js` (it is the documented dynamic-route behaviour, but it was not deployed from here) and what `request.url` holds for a rewritten route. The code reads the app from the path and falls back to the `app` query parameter, and a unit test covers both, but a preview deployment should be checked: `/api/tessera/revocations`, `/api/switchboard/revocations`, `/tessera/buy`, `/switchboard/buy` (with sales open) and a 404 for `/api/nope/revocations`.
- The `/api/all/reconcile` cron: trigger it once from the Vercel dashboard (Cron Jobs, Run) after deploying and check that the response lists both apps.
- Stripe Managed Payments and webhook behaviour: see the end of the Tessera doc.
