import { useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

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

const POPOVER_WIDTH = 264;

export function isCurrentModelSelection(
  activeProvider: ModelProviderId,
  activeModel: string,
  optionProvider: ModelProviderId,
  optionModel: string,
): boolean {
  return activeProvider === optionProvider && activeModel === optionModel;
}

export function configuredModelForProvider(
  provider: ModelProviderId,
  settings: SettingsSnapshot | undefined,
  activeModel: string,
): string {
  if (provider !== "custom") return activeModel;
  return settings?.customModel.trim() || providerDetails(provider).defaultModel;
}

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

  function placePopover() {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setPosition(
      anchoredPopoverPosition(bounds, {
        width: POPOVER_WIDTH,
        align: "end",
        pin: "bottom",
      }),
    );
  }

  function openPopover() {
    setLevel({ step: "providers" });
    placePopover();
    setOpen(true);
  }

  function openModels(providerId: ModelProviderId) {
    setLevel({ step: "models", provider: providerId });
    placePopover();
  }

  function showProviders() {
    setLevel({ step: "providers" });
    placePopover();
  }

  function closePopover() {
    setOpen(false);
    setLevel({ step: "providers" });
  }

  function handleClose() {
    if (level.step === "models") {
      showProviders();
      return;
    }
    closePopover();
  }

  const modelRows =
    level.step === "models"
      ? (() => {
          const modelValue = configuredModelForProvider(
            level.provider,
            settings,
            effectiveModel,
          );
          const showConfiguredModel =
            level.provider === "custom" || level.provider === effectiveProvider;

          return [
            ...providerDetails(level.provider).models.map((option) => ({
              ...option,
              selected: isCurrentModelSelection(
                effectiveProvider,
                effectiveModel,
                level.provider,
                option.value,
              ),
            })),
            ...(!showConfiguredModel || isKnownModel(level.provider, modelValue)
              ? []
              : [
                  {
                    value: modelValue,
                    label: `${modelValue}`,
                    qualifier: "",
                    description: "",
                    selected: isCurrentModelSelection(
                      effectiveProvider,
                      effectiveModel,
                      level.provider,
                      modelValue,
                    ),
                  },
                ]),
          ];
        })()
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
        aria-haspopup="menu"
        aria-controls={open ? "composer-model-menu" : undefined}
        title={t("modelSelectorTitle", { model: effectiveModel })}
      >
        <span className="composer-model-label">
          {modelShortLabel(effectiveModel)}
        </span>
        <ChevronUp
          className="model-trigger-arrow"
          size={14}
          strokeWidth={2.2}
        />
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
                  aria-haspopup="menu"
                  onClick={() => openModels(providerOption.value)}
                >
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
                  <ChevronRight
                    className="model-provider-chevron"
                    size={14}
                    strokeWidth={2.2}
                  />
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
                onClick={showProviders}
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
