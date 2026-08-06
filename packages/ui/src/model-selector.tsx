import { useRef, useState } from "react";
import { Check, ChevronLeft, Cpu } from "lucide-react";

import {
  ActionPopover,
  anchoredPopoverPosition,
  type PopoverPosition,
} from "./popover.js";
import type { Translate } from "./i18n.js";
import {
  isKnownModel,
  modelDescription,
  modelQualifier,
  PROVIDER_OPTIONS,
  providerDetails,
  providerLabel,
  type ModelProviderId,
} from "./model-catalog.js";
import type { SettingsSnapshot } from "./settings.js";
import { providerIsConfiguredFor } from "./settings-readiness.js";

export interface ModelSelection {
  provider: ModelProviderId;
  model: string;
}

const PROVIDER_DOTS: Record<ModelProviderId, string> = {
  openai: "#10a37f",
  deepseek: "#4d6bfe",
  qwen: "#615ced",
  kimi: "#1f8fff",
  doubao: "#e8433f",
  gemini: "#4285f4",
  grok: "#6f6f6f",
  custom: "#b47a1f",
};

const POPOVER_WIDTH = 264;
const PROVIDER_ROW_HEIGHT = 42;
const MODEL_ROW_HEIGHT = 54;

function isProviderId(value: string | undefined): value is ModelProviderId {
  return PROVIDER_OPTIONS.some((option) => option.value === value);
}

export function ModelSelector({
  settings,
  provider,
  model,
  disabled,
  t,
  onSelect,
}: {
  settings?: SettingsSnapshot;
  provider?: string;
  model?: string;
  disabled: boolean;
  t: Translate;
  onSelect(selection: ModelSelection): void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<
    { step: "providers" } | { step: "models"; provider: ModelProviderId }
  >({ step: "providers" });
  const [position, setPosition] = useState<PopoverPosition>();

  const effectiveProvider: ModelProviderId = isProviderId(provider)
    ? provider
    : (settings?.provider ?? "openai");
  const effectiveModel =
    model ?? settings?.model ?? providerDetails(effectiveProvider).defaultModel;

  function providerListHeight(): number {
    return 10 + PROVIDER_OPTIONS.length * PROVIDER_ROW_HEIGHT;
  }

  function modelListHeight(providerId: ModelProviderId): number {
    const providerOption = providerDetails(providerId);
    const rows =
      providerOption.models.length +
      (isKnownModel(providerId, effectiveModel) ? 0 : 1);
    return 10 + 34 + rows * MODEL_ROW_HEIGHT;
  }

  function openPopover() {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setLevel({ step: "providers" });
    setPosition(
      anchoredPopoverPosition(bounds, {
        width: POPOVER_WIDTH,
        height: providerListHeight(),
        align: "end",
      }),
    );
    setOpen(true);
  }

  function openModels(providerId: ModelProviderId) {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setLevel({ step: "models", provider: providerId });
    setPosition(
      anchoredPopoverPosition(bounds, {
        width: POPOVER_WIDTH,
        height: modelListHeight(providerId),
        align: "end",
      }),
    );
  }

  function closePopover() {
    setOpen(false);
    setLevel({ step: "providers" });
  }

  function handleClose() {
    if (level.step === "models") {
      setLevel({ step: "providers" });
      const bounds = triggerRef.current?.getBoundingClientRect();
      if (bounds) {
        setPosition(
          anchoredPopoverPosition(bounds, {
            width: POPOVER_WIDTH,
            height: providerListHeight(),
            align: "end",
          }),
        );
      }
      return;
    }
    closePopover();
  }

  const modelRows =
    level.step === "models"
      ? [
          ...providerDetails(level.provider).models.map((option) => ({
            ...option,
            selected: option.value === effectiveModel,
          })),
          ...(isKnownModel(level.provider, effectiveModel)
            ? []
            : [
                {
                  value: effectiveModel,
                  label: `${effectiveModel}`,
                  qualifier: "",
                  description: "",
                  selected: true,
                },
              ]),
        ]
      : [];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`composer-action model pressable ${open ? "active" : ""}`}
        onClick={openPopover}
        disabled={disabled}
        aria-label={t("modelSelector")}
        aria-expanded={open}
        aria-controls={open ? "composer-model-menu" : undefined}
        title={t("modelSelectorTitle", { model: effectiveModel })}
      >
        <Cpu size={15} strokeWidth={2.2} />
        <span className="composer-model-label">
          {modelShortLabel(effectiveModel)}
        </span>
      </button>
      {open && position && (
        <ActionPopover
          label={t("modelSelector")}
          position={position}
          className="model-selector-popover"
          returnFocusRef={triggerRef}
          onClose={handleClose}
        >
          {level.step === "providers" ? (
            PROVIDER_OPTIONS.map((providerOption) => {
              const configured = Boolean(
                settings &&
                providerIsConfiguredFor(settings, providerOption.value),
              );
              const selected = providerOption.value === effectiveProvider;
              return (
                <button
                  key={providerOption.value}
                  type="button"
                  role="menuitem"
                  data-popover-item
                  className="model-provider-option"
                  disabled={!configured}
                  aria-checked={selected}
                  onClick={() => openModels(providerOption.value)}
                >
                  <span
                    className="model-provider-dot"
                    style={{ background: PROVIDER_DOTS[providerOption.value] }}
                    aria-hidden="true"
                  />
                  <span className="model-option-copy">
                    <strong>{providerLabel(providerOption.value, t)}</strong>
                    <small>
                      {configured
                        ? providerOption.description
                        : t("modelProviderNotConfigured")}
                    </small>
                  </span>
                  {selected && (
                    <Check
                      className="model-option-check"
                      size={15}
                      strokeWidth={2.4}
                    />
                  )}
                </button>
              );
            })
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                data-popover-item
                className="model-back-option"
                onClick={() => setLevel({ step: "providers" })}
              >
                <ChevronLeft size={15} strokeWidth={2.2} />
                <span>{providerLabel(level.provider, t)}</span>
              </button>
              <div className="model-list" role="group">
                {modelRows.map((option) => (
                  <button
                    key={`${level.provider}:${option.value}`}
                    type="button"
                    role="menuitemradio"
                    data-popover-item
                    className="model-option"
                    aria-checked={option.selected}
                    onClick={() => {
                      onSelect({
                        provider: level.provider,
                        model: option.value,
                      });
                      closePopover();
                    }}
                  >
                    <span className="model-option-copy">
                      <strong>
                        {option.label}
                        {option.qualifier ? (
                          <em className="model-qualifier">
                            {modelQualifier(option.value, t)}
                          </em>
                        ) : null}
                      </strong>
                      <small>
                        {option.description ||
                          modelDescription(level.provider, option.value, t)}
                      </small>
                    </span>
                    {option.selected && (
                      <Check
                        className="model-option-check"
                        size={15}
                        strokeWidth={2.4}
                      />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </ActionPopover>
      )}
    </>
  );
}

function modelShortLabel(model: string): string {
  return model.length > 18 ? `${model.slice(0, 17)}…` : model;
}
