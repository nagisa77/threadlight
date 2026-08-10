# Threadlight website

Static project website for `threadlight.xyz`. The remote Host browser client
remains a separate application in `apps/web`.

## Local development

```bash
npm run site:dev
```

The Chinese homepage is served from `/`; the English version is served from
`/en/`.

## Production build

```bash
npm run site:build
```

The static output is written to `apps/site/dist`.

## Cloudflare Pages

Create a Pages project from this repository with:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | repository root |
| Build command | `npm run site:build` |
| Build output directory | `apps/site/dist` |

Use `threadlight.xyz` as the production custom domain and redirect
`www.threadlight.xyz` to the apex domain. The `/app` redirect intentionally
continues to use the existing GitHub Pages web client until `apps/web` is moved
to `app.threadlight.xyz`.

Recommended build watch paths:

```text
apps/site/*
apps/desktop/resources/app-icon.svg
docs/images/*
package.json
package-lock.json
```
