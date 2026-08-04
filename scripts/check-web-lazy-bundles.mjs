import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(
  root,
  "apps/web/dist/.vite/manifest.json",
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const records = Object.entries(manifest);

const entry = records.find(([, record]) => record.isEntry);
if (!entry) fail("Web manifest has no entry chunk.");

const app = recordNamed("app");
const settings = recordNamed("settings");
const automations = recordNamed("automations");
const workspace = recordNamed("workspace-panel");
const diffViewer = recordNamed("diff-viewer");
const syntaxHighlighter = recordNamed("syntax-highlighter");
const terminalViewport = recordNamed("terminal-viewport");

assertDynamic(app, "Threadlight app");
assertDynamic(settings, "Settings");
assertDynamic(automations, "Automations");
assertDynamic(workspace, "Workspace panel");
assertDynamic(diffViewer, "Diff viewer");
assertDynamic(syntaxHighlighter, "Refractor syntax highlighter");
assertDynamic(terminalViewport, "xterm viewport");

const connectionStatic = staticClosure(entry[0]);
for (const [key, label] of [
  [app[0], "Threadlight app"],
  [settings[0], "Settings"],
  [automations[0], "Automations"],
  [workspace[0], "Workspace panel"],
  [diffViewer[0], "Diff viewer"],
  [syntaxHighlighter[0], "Refractor"],
  [terminalViewport[0], "xterm"],
]) {
  if (connectionStatic.has(key)) {
    fail(`${label} leaked into the Web connection-page static bundle.`);
  }
}

assertDynamicReference(entry[1], app[0], "connection page", "Threadlight app");
assertDynamicReference(app[1], settings[0], "Threadlight app", "Settings");
assertDynamicReference(app[1], automations[0], "Threadlight app", "Automations");
assertDynamicReference(app[1], workspace[0], "Threadlight app", "Workspace panel");
assertDynamicReference(workspace[1], diffViewer[0], "Workspace panel", "Diff viewer");
assertDynamicReference(
  workspace[1],
  syntaxHighlighter[0],
  "Workspace panel",
  "Refractor syntax highlighter",
);
assertDynamicReference(
  workspace[1],
  terminalViewport[0],
  "Workspace panel",
  "xterm viewport",
);

console.log(
  "Verified Web lazy bundles: app, Settings, Automations, workspace, Diff, Refractor, and xterm.",
);

function recordNamed(name) {
  const match = records.find(([, record]) => record.name === name);
  if (!match) fail(`Web manifest is missing the ${name} chunk.`);
  return match;
}

function staticClosure(key, seen = new Set()) {
  if (seen.has(key)) return seen;
  seen.add(key);
  const record = manifest[key];
  for (const dependency of record?.imports ?? []) {
    staticClosure(dependency, seen);
  }
  return seen;
}

function assertDynamic([, record], label) {
  if (!record.isDynamicEntry) fail(`${label} is not a dynamic entry.`);
}

function assertDynamicReference(record, dependency, owner, label) {
  if (!(record.dynamicImports ?? []).includes(dependency)) {
    fail(`${owner} does not dynamically import ${label}.`);
  }
}

function fail(message) {
  throw new Error(`[web-lazy-bundles] ${message}`);
}
