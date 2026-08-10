# Deployment

Threadlight has two separate web surfaces. Keep their deployment targets distinct.

## Project website

- Production URL: <https://threadlight.xyz>
- Source: `apps/site`
- Platform: Cloudflare Pages
- Cloudflare Pages project: `threadlight`
- Deployment mode: direct upload with Wrangler

Deploy the production website from the repository root:

```bash
npm run site:deploy
```

The command builds the Astro site and uploads `apps/site/dist` to the production
`main` branch of the existing Cloudflare Pages project. Wrangler authentication
must already be configured locally. Never store Cloudflare tokens in the repository.

After deployment, verify both language routes:

- <https://threadlight.xyz/>
- <https://threadlight.xyz/en/>

## Browser client

- Production URL: <https://nagisa77.github.io/threadlight/>
- Source: `apps/web`
- Platform: GitHub Pages
- Workflow: `.github/workflows/deploy-pages.yml`

The browser client deploys automatically after a push to `main`. It is not the
project website and should not replace the Cloudflare Pages deployment.
