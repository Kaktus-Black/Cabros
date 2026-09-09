# Cabro Yard — Production & Inventory Management

A mobile-first app for tracking cabro (paving block) production, stock
movement, physical counts, and reports at a production site.

## Run it locally

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

## Build for production

```bash
npm run build
npm run preview   # to test the production build locally
```

The output goes to `dist/` — deployable to any static host (Vercel,
Netlify, GitHub Pages, Cloudflare Pages, etc.).

## Data storage — read this first

This build stores data in the browser's `localStorage`, so it's
**per-device/per-browser**, not shared across workers automatically.
That's fine for trying it out or single-device use; for a real
production site where multiple phones/tablets need to see the same
stock, swap the two functions `loadJSON` / `saveJSON` near the top of
`src/App.jsx` for calls to a small backend (Supabase, Firebase,
a REST API — anything that can store/retrieve JSON by key). Every
other part of the app already goes through those two functions, so
that's the only place you need to change.

## Push this to GitHub

From inside this folder:

```bash
git init
git add .
git commit -m "Initial commit: Cabro Yard app"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

(Create the empty repo on GitHub first — either on github.com via
"New repository", or with the GitHub CLI: `gh repo create <your-repo> --public --source=. --remote=origin`.)

## Deploy

**Vercel**
```bash
npm i -g vercel
vercel
```

**Netlify**
```bash
npm i -g netlify-cli
netlify deploy --build
```

**GitHub Pages** — add `base: "/<your-repo>/"` to `vite.config.js`,
run `npm run build`, then push the `dist/` folder to a `gh-pages`
branch (or use the `gh-pages` npm package / a GitHub Actions workflow).

## Project structure

```
cabro-yard/
├── index.html
├── package.json
├── vite.config.js
├── src/
│   ├── main.jsx      # React entry point
│   └── App.jsx        # the entire app (types, stock, quick update,
│                       # physical counts, history, reports, settings)
└── README.md
```
