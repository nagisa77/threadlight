import type { ReactNode } from "react";

export function ChangeCounts({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  return (
    <span className="change-counts">
      <span className="change-additions">+{additions}</span>
      <span className="change-deletions">-{deletions}</span>
    </span>
  );
}

export function PanelState({
  icon,
  error,
  children,
}: {
  icon: ReactNode;
  error?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`workspace-panel-state ${error ? "error" : ""}`}>
      <span>{icon}</span>
      {typeof children === "string" ? <p>{children}</p> : children}
    </div>
  );
}
