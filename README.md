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

Deploys from `master`: `netlify.toml` for Netlify, or `.github/workflows/deploy.yml` for GitHub Pages (`public/CNAME` carries the domain).
