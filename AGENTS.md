# Threadlight contributor guide

- Follow the [`emilkowalski/skills`](https://github.com/emilkowalski/skills) design-engineering guidance for all product UI and interaction work.

## UI change demos and visual acceptance

- Every user-visible UI change must include a task-specific, runnable demo before the work is handed off for review. This includes changes to layout, spacing, typography, color, icons, motion, loading or error feedback, responsive behavior, and interaction states; a small CSS adjustment is not exempt.
- The demo must be a faithful rendering of the current Threadlight product UI. Reuse the production application shell, real product components, production CSS, design tokens, icons, fonts, assets, and layout. Show the changed UI in the same surrounding product context in which users encounter it. Do not substitute a hand-built approximation, copied mock UI, simplified standalone component, AI-generated image, or static screenshot for the product implementation.
- Keep demo-only behavior at the data or transport boundary. Script or mock the minimum state needed to trigger the scenario deterministically, while leaving the rendered product component tree and styles unchanged. For example, a stream-recovery demo should drive the real conversation UI through streaming, interruption, retry feedback, recovery, and resumed streaming instead of drawing a look-alike retry card.
- Demonstrate the complete behavior, not only its final frame. Affected states and transitions must be replayable or interactive, including relevant before, in-progress, success, failure, recovery, hover, focus, disabled, and responsive states. Dynamic behavior must run in real time when timing or continuity is part of the change.
- Run the demo as a local UI service at a stable URL and provide the exact URL plus concise replay instructions. Keep the service running while review is pending, and stop it when the reviewer asks. Screenshots may document the result, but they do not replace the runnable demo.
- Before handing off, inspect the demo in a real browser at the representative product viewport. Compare it with the current product UI and verify visual hierarchy, spacing, alignment, wrapping, clipping, motion timing, surrounding context, and light/dark or responsive variants affected by the change. Fix discrepancies before presenting it.
- A UI task is not complete until the production change, appropriate automated tests, faithful runnable demo, and browser-based visual verification all exist. In the handoff, state which product components and styles the demo reuses, which scenarios it covers, the demo URL, and what was visually verified.
- Temporary demo scaffolding should stay separate from production bundles and should not duplicate production styling. Do not commit throwaway demo artifacts unless requested; reusable demo or story infrastructure may be committed when it benefits ongoing development.

- Keep `agent-loop` provider-neutral; provider-specific wire formats stay in adapters.
- Keep `app-server` transport and protocol concerns out of the loop.
- Preserve opaque model state across tool turns so reasoning and call linkage survive.
- Every new behavior needs an offline test with a scripted model provider.
- Run `npm test` before committing.
- Never write API keys or secrets into source, fixtures, or logs.
- The production project website is `https://threadlight.xyz`, deployed from `apps/site` to the Cloudflare Pages project `threadlight`; deploy it with `npm run site:deploy`.
- GitHub Pages hosts the browser client from `apps/web` at `https://nagisa77.github.io/threadlight/`; do not confuse it with the project website.
