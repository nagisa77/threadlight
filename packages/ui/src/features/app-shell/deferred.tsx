import { lazy } from "react";
import { LoaderCircle } from "lucide-react";

export const LazyFirstRunGuide = lazy(() =>
  import("../../first-run.js").then(({ FirstRunGuide }) => ({
    default: FirstRunGuide,
  })),
);

export const LazySettingsPage = lazy(() =>
  import("../../settings.js").then(({ SettingsPage }) => ({
    default: SettingsPage,
  })),
);

export const LazyAutomationsPage = lazy(() =>
  import("../../automations.js").then(({ AutomationsPage }) => ({
    default: AutomationsPage,
  })),
);

export const LazyWorkspacePanel = lazy(() =>
  import("../../workspace-panel.js").then(({ WorkspacePanel }) => ({
    default: WorkspacePanel,
  })),
);

export const LazyTerminalPanel = lazy(() =>
  import("../../terminal.js").then(({ TerminalPanel }) => ({
    default: TerminalPanel,
  })),
);

export function DeferredView({ label }: { label: string }) {
  return (
    <div className="deferred-view" role="status">
      <LoaderCircle className="spin" size={17} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function DeferredWorkspacePanel({
  hidden,
  label,
}: {
  hidden: boolean;
  label: string;
}) {
  return (
    <aside className="workspace-panel deferred-panel" hidden={hidden}>
      <DeferredView label={label} />
    </aside>
  );
}

export function DeferredTerminalPanel({ label }: { label: string }) {
  return (
    <section className="terminal-panel panel-container deferred-panel">
      <DeferredView label={label} />
    </section>
  );
}
