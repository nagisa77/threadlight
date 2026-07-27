import { useEffect, useRef, useState } from "react";
import { Files, Plus, SquareTerminal } from "lucide-react";
import { useI18n } from "./i18n.js";

export type PanelViewKind = "terminal" | "file";

export function PanelAddMenu({
  available,
  onSelect,
}: {
  available: readonly PanelViewKind[];
  onSelect(kind: PanelViewKind): void;
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
            onClick={() => {
              onSelect("terminal");
              setOpen(false);
            }}
          >
            <SquareTerminal size={16} />
            <span>{t("terminal")}</span>
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
      </div>
    </div>
  );
}
