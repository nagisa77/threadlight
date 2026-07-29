# Changelog

All notable changes to Threadlight are documented here. The project follows [Semantic Versioning](https://semver.org/) while public APIs are in active `0.x` development.

## Unreleased

### Added

- Git projects now start each task in an isolated `threadlight/*` worktree while preserving the project's current tracked and untracked working state; non-Git projects use direct folder mode.
- The Diff panel can restore one changed file or all task changes to the task baseline, with revision and filesystem conflict checks before any restore.
- The project sidebar now supports task search, lifecycle filters, rename, pinning, and archiving; permanent deletion is available only after a task has been archived.

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

[Unreleased]: https://github.com/nagisa77/threadlight/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nagisa77/threadlight/releases/tag/v0.1.0
