# CLAUDE.md

## Project Overview

Template SPA is a GitHub template for bootstrapping React + Vite + TypeScript single-page applications with automated GitHub Pages deployment and branch previews.

## Tech Stack

- **Framework**: React 19 + TypeScript (strict mode)
- **Build**: Vite 7, output to `build/`
- **Linting**: ESLint 9 + Prettier 3
- **Deployment**: GitHub Actions → GitHub Pages (with branch preview URLs)
- **No runtime dependencies** beyond React

## Key Commands

```bash
npm run dev          # Dev server at localhost:5173
npm run build        # Production build → build/ (includes tsc -b type check)
npm run lint         # ESLint
npm run format       # Prettier (write)
npm run format:check # Prettier (check only)
```

Always run `npm run format && npm run lint` before committing. Run `npm run build` to verify nothing breaks.

## Project Structure

```
src/
├── App.tsx          # Root component; includes BranchBanner
├── App.css          # Global styles + .branch-banner
├── main.tsx         # React entry point
└── vite-env.d.ts    # ImportMetaEnv type augmentation for VITE_ vars
index.html           # Vite HTML entry point
.github/workflows/
└── deploy.yml       # CI: lint → format:check → build → deploy
```

## Branch Preview System

The CI workflow bakes these into the bundle at build time as static string replacements:

| Variable | Description |
|----------|-------------|
| `VITE_BUILD_BRANCH` | Full branch name (e.g. `feature/my-thing`) |
| `VITE_BUILD_SHA` | Short git SHA (7 chars) |
| `VITE_BUILD_TIMESTAMP` | ISO 8601 build timestamp |
| `VITE_GITHUB_REPOSITORY` | `owner/repo` string |

`BranchBanner` in `App.tsx` reads `VITE_BUILD_BRANCH` and shows an amber top bar on non-main preview builds. In local dev these vars are undefined so the banner is hidden.

## CI/CD

1. Lint + format check
2. `npm run build` (includes `tsc -b` TypeScript check + Vite bundle)
3. Deploy to GitHub Pages
   - `main` → `https://{owner}.github.io/{repo}/`
   - other branches → `https://{owner}.github.io/{repo}/{branch-slug}/`
4. Post or update preview URL comment on any open PR for the branch

## No Test Framework

Validation relies on TypeScript strict mode, ESLint, and the build step.
