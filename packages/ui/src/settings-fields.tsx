import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Search,
  Sparkles,
} from "lucide-react";
import { useI18n } from "./i18n.js";
import type { ThemePreference } from "./theme.js";
import {
  ProjectOpenerIcon,
  type ProjectOpenerOption,
} from "./project-opener.js";
import type { SecretDraft } from "./settings.js";

export function SettingsSelectField({
  id,
  label,
  description,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: string;
  options: readonly {
    value: string;
    label: string;
    iconDataUrl?: string;
    disabled?: boolean;
    opener?: ProjectOpenerOption;
  }[];
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const optionButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("pointerdown", closeFromOutside);
    window.addEventListener("keydown", closeFromKeyboard);
    return () => {
      window.removeEventListener("pointerdown", closeFromOutside);
      window.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [options, value]);

  function openAndFocus(index = selectedIndex) {
    setOpen(true);
    const targetIndex = options[index]?.disabled
      ? options.findIndex((option) => !option.disabled)
      : index;
    requestAnimationFrame(() => optionButtons.current[targetIndex]?.focus());
  }

  function choose(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openAndFocus(
        open ? Math.min(selectedIndex + 1, options.length - 1) : selectedIndex,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAndFocus(open ? Math.max(selectedIndex - 1, 0) : selectedIndex);
    } else if (event.key === "Home") {
      event.preventDefault();
      openAndFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      openAndFocus(options.length - 1);
    }
  }

  function handleOptionKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") {
      nextIndex = Math.min(index + 1, options.length - 1);
    } else if (event.key === "ArrowUp") {
      nextIndex = Math.max(index - 1, 0);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    optionButtons.current[nextIndex]?.focus();
  }

  return (
    <div className="settings-field model-field">
      <div className="settings-field-label">
        <div>
          <label id={`${id}-label`} htmlFor={id}>
            {label}
          </label>
          <p>{description}</p>
        </div>
      </div>
      <div className={`model-select-wrap ${open ? "open" : ""}`} ref={root}>
        <button
          ref={trigger}
          type="button"
          id={id}
          className="model-select-trigger pressable"
          role="combobox"
          aria-labelledby={`${id}-label ${id}`}
          aria-controls={`${id}-options`}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => {
            if (open) setOpen(false);
            else openAndFocus();
          }}
          onKeyDown={handleTriggerKeyDown}
        >
          <span className="settings-select-value">
            {selectedOption?.opener && (
              <ProjectOpenerIcon opener={selectedOption.opener} />
            )}
            <span>{selectedOption?.label ?? value}</span>
          </span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <div
          id={`${id}-options`}
          className="settings-select-popover"
          role="listbox"
          aria-labelledby={`${id}-label`}
          hidden={!open}
        >
          {options.map((option) => (
            <button
              key={option.value}
              ref={(element) => {
                optionButtons.current[options.indexOf(option)] = element;
              }}
              type="button"
              className="settings-select-option pressable"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              onClick={() => choose(option.value)}
              onKeyDown={(event) =>
                handleOptionKeyDown(event, options.indexOf(option))
              }
            >
              <span className="settings-select-option-label">
                {option.opener && <ProjectOpenerIcon opener={option.opener} />}
                <span>{option.label}</span>
              </span>
              {option.value === value && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ThemePicker({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange(value: ThemePreference): void;
}) {
  const { t } = useI18n();
  const options: readonly {
    value: ThemePreference;
    label: string;
  }[] = [
    { value: "system", label: t("themeSystem") },
    { value: "light", label: t("themeLight") },
    { value: "dark", label: t("themeDark") },
  ];

  return (
    <fieldset className="theme-picker">
      <legend>{t("theme")}</legend>
      <p>{t("themeDescription")}</p>
      <div
        className="theme-options"
        role="radiogroup"
        aria-label={t("themeChoice")}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={`theme-option pressable${option.value === value ? " selected" : ""}`}
          >
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span
              className={`theme-preview ${option.value}`}
              aria-hidden="true"
            >
              <span className="theme-preview-title" />
              <span className="theme-preview-subtitle" />
              <span className="theme-preview-card">
                <span />
                <span />
                <span />
              </span>
            </span>
            <span className="theme-option-label">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SecretField({
  id,
  label,
  description,
  configured,
  draft,
  icon,
  onChange,
  onClear,
}: {
  id: string;
  label: string;
  description: string;
  configured: boolean;
  draft: SecretDraft;
  icon?: "search";
  onChange(value: string): void;
  onClear(): void;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const active = configured && !draft.cleared;

  return (
    <div className="settings-field">
      <div className="settings-field-label">
        <div>
          <label htmlFor={id}>{label}</label>
          <p>{description}</p>
        </div>
        {draft.cleared ? (
          <span className="key-status pending">{t("pendingRemoval")}</span>
        ) : active ? (
          <span className="key-status">{t("configured")}</span>
        ) : null}
      </div>
      <div className="secret-input-wrap">
        <span className="secret-leading" aria-hidden="true">
          {icon === "search" ? <Search size={14} /> : <KeyRound size={14} />}
        </span>
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={draft.value}
          autoComplete="off"
          spellCheck={false}
          placeholder={active ? t("replaceKey") : t("pasteApiKey")}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="secret-action pressable"
          aria-label={
            visible ? t("hideLabel", { label }) : t("showLabel", { label })
          }
          title={visible ? t("hide") : t("show")}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        {active && (
          <button
            type="button"
            className="secret-clear pressable"
            onClick={onClear}
          >
            {t("clear")}
          </button>
        )}
      </div>
    </div>
  );
}

export function TextField({
  id,
  label,
  description,
  value,
  placeholder,
  inputType = "url",
  icon = "link",
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: string;
  placeholder: string;
  inputType?: "text" | "url";
  icon?: "link" | "model";
  onChange(value: string): void;
}) {
  return (
    <div className="settings-field">
      <div className="settings-field-label">
        <div>
          <label htmlFor={id}>{label}</label>
          <p>{description}</p>
        </div>
      </div>
      <div className="secret-input-wrap">
        <span className="secret-leading" aria-hidden="true">
          {icon === "model" ? <Sparkles size={14} /> : <Link2 size={14} />}
        </span>
        <input
          id={id}
          type={inputType}
          value={value}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}
