import { useRef, useState, type ReactNode } from "react";
import type { TaskDevelopmentMode } from "@threadlight/protocol";
import { Check, ChevronUp, GitBranch, Laptop } from "lucide-react";

import { useI18n } from "./i18n.js";
import {
  ActionPopover,
  ActionPopoverHeading,
  anchoredPopoverPosition,
  type PopoverPosition,
} from "./popover.js";

export function DevelopmentModeControl({
  mode,
  disabled = false,
  onOpen,
  onChange,
}: {
  mode: TaskDevelopmentMode;
  disabled?: boolean;
  onOpen?(): void;
  onChange(mode: TaskDevelopmentMode): void;
}) {
  const { t } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<PopoverPosition>();
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  function open(fromKeyboard: boolean) {
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds) return;
    onOpen?.();
    setKeyboardOpen(fromKeyboard);
    setPosition(
      anchoredPopoverPosition(bounds, {
        width: 344,
        align: "start",
        pin: "bottom",
      }),
    );
  }

  function close() {
    setPosition(undefined);
  }

  function select(nextMode: TaskDevelopmentMode) {
    onChange(nextMode);
    close();
    trigger.current?.focus();
  }

  const label =
    mode === "worktree" ? t("worktreeDevelopment") : t("localDevelopment");

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`development-mode-trigger pressable ${mode}${keyboardOpen && position ? " keyboard-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
        disabled={disabled}
        title={`${t("developmentMode")}: ${label}`}
        onClick={(event) => (position ? close() : open(event.detail === 0))}
      >
        {mode === "worktree" ? <GitBranch size={15} /> : <Laptop size={15} />}
        <span>{label}</span>
        <ChevronUp className="development-mode-chevron" size={13} />
      </button>
      {position && (
        <ActionPopover
          label={t("developmentMode")}
          position={position}
          className={`development-mode-popover${keyboardOpen ? " keyboard-open" : ""}`}
          returnFocusRef={trigger}
          onClose={close}
        >
          <ActionPopoverHeading>{t("developmentMode")}</ActionPopoverHeading>
          <DevelopmentModeOption
            selected={mode === "local"}
            icon={<Laptop size={17} />}
            title={t("localDevelopment")}
            description={t("localDevelopmentDescription")}
            onSelect={() => select("local")}
          />
          <DevelopmentModeOption
            selected={mode === "worktree"}
            icon={<GitBranch size={17} />}
            title={t("worktreeDevelopment")}
            description={t("worktreeDevelopmentDescription")}
            onSelect={() => select("worktree")}
          />
        </ActionPopover>
      )}
    </>
  );
}

function DevelopmentModeOption({
  selected,
  icon,
  title,
  description,
  onSelect,
}: {
  selected: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      className="composer-popover-option development-mode-option"
      role="menuitemradio"
      aria-checked={selected}
      data-popover-item
      onClick={onSelect}
    >
      <span className="development-mode-option-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="composer-popover-option-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className="development-mode-check" aria-hidden="true">
        {selected && <Check size={16} strokeWidth={2.2} />}
      </span>
    </button>
  );
}
