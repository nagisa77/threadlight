import { useEffect, useRef, useState } from "react";
import { Files, GitBranch, PackageCheck, Plus, Terminal } from "lucide-react";
import { useI18n } from "./i18n.js";

export type PanelViewKind =
  "terminal" | "original-terminal" | "delivery" | "agents" | "file";

export function PanelAddMenu({
  available,
  onSelect,
  taskTerminalLabel,
  originalTerminalLabel,
}: {
  available: readonly PanelViewKind[];
  onSelect(kind: PanelViewKind): void;
  taskTerminalLabel?: string;
  originalTerminalLabel?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeFromOutside);
    window.addEventListener("keydown", closeFromKeyboard);
    return () => {
      window.removeEventListener("pointerdown", closeFromOutside);
      window.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [open]);

  return (
    <div className="panel-add-menu" ref={root}>
      <button
        type="button"
        className="panel-add-trigger pressable"
        aria-label={t("newPanelTab")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("newPanelTab")}
        onClick={() => setOpen((current) => !current)}
      >
        <Plus size={16} />
      </button>
      <div className="panel-add-popover" role="menu" hidden={!open}>
        {available.includes("terminal") && (
          <button
            type="button"
            className="panel-add-option pressable"
            role="menuitem"
            aria-label={taskTerminalLabel ?? t("taskTerminal")}
            title={taskTerminalLabel ?? t("taskTerminal")}
            onClick={() => {
              onSelect("terminal");
              setOpen(false);
            }}
          >
            <Terminal size={16} />
            <span>{taskTerminalLabel ?? t("taskTerminal")}</span>
          </button>
        )}
        {available.includes("original-terminal") && (
          <button
            type="button"
            className="panel-add-option pressable"
            role="menuitem"
            aria-label={originalTerminalLabel ?? t("originalWorkspaceTerminal")}
            title={originalTerminalLabel ?? t("originalWorkspaceTerminal")}
            onClick={() => {
              onSelect("original-terminal");
              setOpen(false);
            }}
          >
            <Terminal size={16} />
            <span>
              {originalTerminalLabel ?? t("originalWorkspaceTerminal")}
            </span>
          </button>
        )}
        {available.includes("file") && (
          <button
            type="button"
            className="panel-add-option pressable"
            role="menuitem"
            onClick={() => {
              onSelect("file");
              setOpen(false);
            }}
          >
            <Files size={16} />
            <span>{t("file")}</span>
          </button>
        )}
        {available.includes("delivery") && (
          <button
            type="button"
            className="panel-add-option pressable"
            role="menuitem"
            onClick={() => {
              onSelect("delivery");
              setOpen(false);
            }}
          >
            <PackageCheck size={16} />
            <span>{t("deliveryCenter")}</span>
          </button>
        )}
        {available.includes("agents") && (
          <button
            type="button"
            className="panel-add-option pressable"
            role="menuitem"
            onClick={() => {
              onSelect("agents");
              setOpen(false);
            }}
          >
            <GitBranch size={16} />
            <span>{t("agents")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
