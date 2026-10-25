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

Hosted on Vercel, which builds `master` with `npm run build` and serves `dist/`; every PR gets a preview deploy.
