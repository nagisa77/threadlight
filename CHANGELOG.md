# Changelog

All notable changes to Threadlight are documented here. The project follows [Semantic Versioning](https://semver.org/).

## Unreleased

## 1.1.0 - 2026-08-23

### Highlights

- Made OpenAI-compatible streaming more resilient to provider retry and status events while keeping provider wire formats inside the adapter.
- Added a privacy-minimized, first-party activation funnel from website visit through first completed task, with documented opt-out controls and no prompt, code, project, credential, or model data.
- Refined progress and retry feedback across desktop and web so long-running model work remains legible without adding visual noise.

### Changed

- Split collaboration contracts, orchestration transcript bookkeeping, generated-content parsing, application shell state, and voice input lifecycle out of the largest runtime and UI orchestrators.
- Reworked the project website and bilingual READMEs around the runtime architecture, complete Showcase results, clearer launch paths, and explicit production boundaries.
- Pinned website self-host commands and release downloads to 1.1.0 so installs are reproducible instead of following the latest source checkout.

### Added

- Added three publish-ready Xiaohongshu campaigns with 19 original carousel pages built from real Threadlight task evidence and Showcase results.
- Added English Remote Host and separate Web deployment guides, structured GitHub issue forms, and a read-only self-host service-manager version command.
- Added GitHub Discussions and unrestricted public issue entry points for community questions and bug reports.
- Added anonymous website, install, and first-task events backed by Cloudflare Pages and D1, plus an owner-only funnel report.

### Fixed

- Copy controls on the project website now announce success to screen readers without changing the visual interaction.
- OpenAI-compatible model retries now retain visible progress and avoid surfacing transient provider status records as assistant content.

## 1.0.0 - 2026-08-10

First stable release of Threadlight.

### Highlights

- Runtime-level multi-agent orchestration with durable child-agent state, follow-ups, interruption, result collection, and visible agent activity.
- A shared desktop and web workspace for local or remote Hosts, with model selection, terminals, files, diffs, review, and delivery in one task timeline.
- A provider-neutral runtime that preserves opaque model state across tool turns and verifies new behavior with scripted-provider offline tests.

### Added

- Git projects now start each task in an isolated `threadlight/*` worktree while preserving the project's current tracked and untracked working state; non-Git projects use direct folder mode.
- The Diff panel can restore one changed file or all task changes to the task baseline, with revision and filesystem conflict checks before any restore.
- The project sidebar now supports task search, lifecycle filters, rename, pinning, and archiving; permanent deletion is available only after a task has been archived.
- Remote Host and browser-client workflows, including authenticated terminal streaming and remembered Host preferences.
- Model selection for supported providers and custom OpenAI-compatible endpoints.
- Project-level skill discovery, plugin support, diagnostics export, and delivery status tracking.

### Changed

- Reworked the desktop and web interfaces for multi-agent tasks, responsive layouts, connection management, and clearer loading and error states.
- Expanded the public project site and added automated deployment to GitHub Pages.

### Fixed

- Preserved conversation context and child-agent state across long-running and resumed work.
- Improved crash recovery, custom-model handling, task creation, title updates, and project navigation.
- Corrected mobile keyboard behavior, Chinese IME submission, terminal lifecycle handling, and diff layout edge cases.

## 0.1.0 - 2026-07-27

First public Alpha release.

### Highlights

- Provider-neutral agent loop with streaming output, tool execution, cancellation, token usage, and opaque model-state continuity.
- OpenAI Responses, DeepSeek, and Qwen-compatible model adapters.
- JSON-RPC app server with task persistence, resume, interruption, attachments, suggestions, and structured execution events.
- Built-in commands, managed background processes, MCP, web search, project memory, plan progress, and macOS Computer Use.
- Electron desktop workspace with file and diff review, multi-tab terminals, voice input, themes, and five interface languages.
- Type-safe transport-neutral client and reusable React UI packages.
- Deterministic offline tests built around scripted model providers.

[Unreleased]: https://github.com/nagisa77/threadlight/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/nagisa77/threadlight/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/nagisa77/threadlight/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/nagisa77/threadlight/releases/tag/v0.1.0
