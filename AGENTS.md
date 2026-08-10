# Threadlight contributor guide

- Follow the [`emilkowalski/skills`](https://github.com/emilkowalski/skills) design-engineering guidance for all product UI and interaction work.
- Keep `agent-loop` provider-neutral; provider-specific wire formats stay in adapters.
- Keep `app-server` transport and protocol concerns out of the loop.
- Preserve opaque model state across tool turns so reasoning and call linkage survive.
- Every new behavior needs an offline test with a scripted model provider.
- Run `npm test` before committing.
- Never write API keys or secrets into source, fixtures, or logs.
- The production project website is `https://threadlight.xyz`, deployed from `apps/site` to the Cloudflare Pages project `threadlight`; deploy it with `npm run site:deploy`.
- GitHub Pages hosts the browser client from `apps/web` at `https://nagisa77.github.io/threadlight/`; do not confuse it with the project website.
