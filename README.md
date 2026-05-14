# Template SPA

A GitHub template for React + Vite + TypeScript SPAs with automated GitHub Pages deployment and branch previews.

## Features

- **React 19 + Vite + TypeScript** — fast, type-safe development
- **GitHub Pages deployment** — every push builds and deploys automatically
- **Branch preview URLs** — non-main branches deploy to `/{repo}/{branch-slug}/`
- **PR preview comments** — GitHub Actions posts the preview URL on open pull requests
- **Branch indicator banner** — preview builds show which branch and commit they’re from

## Using this template

1. Click **Use this template** on GitHub to create a new repository
2. Enable GitHub Pages: Settings → Pages → Source → **GitHub Actions**
3. Mark as template (optional): Settings → General → **Template repository**
4. Push to any branch — the workflow handles the rest

## Development

```bash
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # production build → build/
npm run lint      # ESLint
npm run format    # Prettier (write)
```

## Deployment

| Branch | URL |
|--------|-----|
| `main` | `https://{owner}.github.io/{repo}/` |
| any other | `https://{owner}.github.io/{repo}/{branch-slug}/` |

Branch previews display an amber banner showing the branch name and commit SHA.
