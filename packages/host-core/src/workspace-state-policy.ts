import ignore, { type Ignore } from "ignore";

export const WORKSPACE_EPHEMERAL_PATTERNS = [
  ".git/",
  ".threadlight/",
  ".next/",
  ".turbo/",
  ".mypy_cache/",
  ".pytest_cache/",
  ".ruff_cache/",
  ".tox/",
  ".venv/",
  "__pycache__/",
  "build/",
  "coverage/",
  "dist/",
  "node_modules/",
  "out/",
  "venv/",
];

export const WORKSPACE_RUNTIME_LINK_PATTERNS = [
  ".venv/",
  "node_modules/",
  "venv/",
];

const WORKSPACE_SENSITIVE_PATTERNS = [
  ".env",
  ".env.*",
  "*.key",
  "*.pem",
  "credentials.json",
  "credentials.*.json",
  "secrets.json",
  "secrets.*.json",
];

export function workspaceEphemeralMatcher(): Ignore {
  return ignore().add(WORKSPACE_EPHEMERAL_PATTERNS);
}

export function workspaceRuntimeLinkMatcher(): Ignore {
  return ignore().add(WORKSPACE_RUNTIME_LINK_PATTERNS);
}

export function workspaceSensitiveMatcher(): Ignore {
  return ignore().add(WORKSPACE_SENSITIVE_PATTERNS);
}
