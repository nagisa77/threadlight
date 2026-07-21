# Threadlight contributor guide

- Keep `agent-loop` provider-neutral; provider-specific wire formats stay in adapters.
- Keep `app-server` transport and protocol concerns out of the loop.
- Preserve opaque model state across tool turns so reasoning and call linkage survive.
- Every new behavior needs an offline test with a scripted model provider.
- Run `npm test` before committing.
- Never write API keys or secrets into source, fixtures, or logs.
