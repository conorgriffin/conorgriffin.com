# conorgriffin.com

Personal site. Vite + React + Tailwind v4. Static, apart from the small Tessera licensing server in `api/`.

```
npm install
npm run dev      # local preview
npm run build    # outputs dist/
```

All the copy that changes lives in `src/content/`:

- `experience.ts` – the timeline, grouped by company
- `now.ts` – the "What I'm working on" cards
- `skills.ts` – the skill pills
- `apps.ts` – the app cards (set `url` once an app has a website)
- `site.ts` – social links

The Tessera app pages live in `src/tessera/` and are served at `/tessera`, `/tessera/privacy` and `/tessera/support` (one HTML entry per page under `tessera/`). Tessera links to the privacy and support URLs from inside the app and from its App Store listing, so keep those paths stable. `npm run build` prerenders these pages to static HTML (`scripts/prerender.mjs`) so they work without JavaScript.

Hosted on Vercel, which builds `master` with `npm run build` and serves `dist/`; every PR gets a preview deploy.

The direct-download sale of Tessera Pro adds `/tessera/thanks`, `/tessera/license` and `/tessera/terms`, the redirects `/tessera/buy` and `/tessera/download`, the Sparkle feed `/tessera/appcast.xml`, and serverless functions in `api/` (Stripe webhook, license delivery, revocation list). There is also a private admin page at `/tessera/admin` (not linked anywhere, `noindex`) for looking up, revoking and reissuing licenses behind "Sign in with Google". Setup, environment variables and behaviour are in [`docs/tessera-direct-sale.md`](docs/tessera-direct-sale.md). `npm run test:api` runs the server tests.
