# Contributing to Threadlight

Thanks for helping make local agents more observable, recoverable, and extensible.

## Start here

- [Development guide](./docs/DEVELOPMENT.md)
- [开发指南（简体中文）](./docs/DEVELOPMENT.zh-CN.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Security policy](./SECURITY.md)

Before starting a large feature or architecture change, open an issue describing the problem, proposed boundary, and offline test strategy. Small fixes and documentation improvements can go directly to a pull request.

## Pull requests

1. Fork the repository and create a focused branch.
2. Add or update offline tests for every behavior change.
3. Run:

   ```bash
   npm run typecheck
   npm test
   git diff --check
   ```

4. Update `CHANGELOG.md` under `Unreleased` for user-visible changes.
5. Explain what changed, why, and how it was verified in the pull request.

Keep each pull request focused. Do not include generated build output, API keys, access tokens, personal data, or unrelated formatting changes.

## Architecture rules

- Keep `agent-loop` provider-neutral; vendor wire formats belong in adapters.
- Keep transport and protocol concerns in `app-server`, outside the loop.
- Preserve opaque model state across tool turns and resumed tasks.
- Use a scripted model provider for deterministic, offline behavior tests.
- Keep secrets out of source, fixtures, project files, and logs.

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
