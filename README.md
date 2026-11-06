# conorgriffin.com

Personal site. Static Vite + React + Tailwind v4, no backend.

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
