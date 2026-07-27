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
  LoaderCircle,
  Palette,
  Search,
  Sparkles,
} from "lucide-react";

import {
  LANGUAGE_OPTIONS,
  useI18n,
  type Language,
  type Translate,
} from "./i18n.js";
import { type ThemePreference } from "./theme.js";
import {
  ProjectOpenerIcon,
  resolvePreferredProjectOpener,
  type ProjectOpenerId,
  type ProjectOpenerOption,
} from "./project-opener.js";

export type ModelProviderId = "openai" | "deepseek" | "qwen";

interface ModelOption {
  value: string;
  label: string;
  qualifier: string;
  description: string;
}

interface ProviderOption {
  value: ModelProviderId;
  label: string;
  description: string;
  keyLabel: string;
  keyDescription: string;
  defaultModel: string;
  models: readonly ModelOption[];
}

export const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  {
    value: "openai",
    label: "OpenAI",
    description: "使用 OpenAI Responses API，适合 GPT 系列模型。",
    keyLabel: "OpenAI API Key",
    keyDescription: "用于 OpenAI 模型请求和语音输入转写，通常以 sk- 开头。",
    defaultModel: "gpt-5.6-sol",
    models: [
      {
        value: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        qualifier: "性能优先",
        description: "适合复杂推理和编程任务，优先获得最佳质量。",
      },
      {
        value: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
        qualifier: "均衡",
        description: "在能力、速度和成本之间取得平衡。",
      },
      {
        value: "gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        qualifier: "成本优先",
        description: "适合成本敏感的高频和轻量任务。",
      },
      {
        value: "gpt-5.4-mini",
        label: "GPT-5.4 mini",
        qualifier: "强力 mini",
        description: "更快的编程和工具调用模型，兼顾能力与成本。",
      },
      {
        value: "gpt-5-mini",
        label: "GPT-5 mini",
        qualifier: "经济 mini",
        description: "适合目标清晰、低延迟和高吞吐的任务。",
      },
      {
        value: "gpt-4.1-mini",
        label: "GPT-4.1 mini",
        qualifier: "低延迟 mini",
        description: "无额外推理步骤，擅长指令遵循和工具调用。",
      },
    ],
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    description: "直连 DeepSeek API，支持推理和工具调用。",
    keyLabel: "DeepSeek API Key",
    keyDescription: "用于 DeepSeek 模型请求。",
    defaultModel: "deepseek-v4-pro",
    models: [
      {
        value: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        qualifier: "性能优先",
        description: "面向复杂推理、编程和长上下文 Agent 任务。",
      },
      {
        value: "deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        qualifier: "速度优先",
        description: "更低延迟和成本，适合日常 Agent 与高频任务。",
      },
    ],
  },
  {
    value: "qwen",
    label: "阿里云百炼 · 千问",
    description: "通过百炼 OpenAI 兼容接口使用千问模型。",
    keyLabel: "百炼 API Key",
    keyDescription: "用于阿里云百炼模型请求；密钥与服务地域对应。",
    defaultModel: "qwen3.7-plus",
    models: [
      {
        value: "qwen3.7-max",
        label: "Qwen3.7 Max",
        qualifier: "性能优先",
        description: "适合复杂、多步骤推理和高难度 Agent 任务。",
      },
      {
        value: "qwen3.7-plus",
        label: "Qwen3.7 Plus",
        qualifier: "均衡",
        description: "在能力、速度和成本之间取得平衡，适合多数任务。",
      },
      {
        value: "qwen3.6-flash",
        label: "Qwen3.6 Flash",
        qualifier: "低延迟",
        description: "面向简单、高频任务，优先响应速度与成本。",
      },
    ],
  },
];

export const MODEL_OPTIONS = PROVIDER_OPTIONS[0].models;
export const DEFAULT_QWEN_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";

export interface SettingsSnapshot {
  language: Language;
  theme: ThemePreference;
  preferredProjectOpener: ProjectOpenerId;
  provider: ModelProviderId;
  openAIApiKeyConfigured: boolean;
  deepSeekApiKeyConfigured: boolean;
  qwenApiKeyConfigured: boolean;
  searchApiKeyConfigured: boolean;
  qwenBaseUrl: string;
  model: string;
}

export interface SettingsUpdate {
  language: Language;
  theme: ThemePreference;
  preferredProjectOpener: ProjectOpenerId;
  provider: ModelProviderId;
  openAIApiKey?: string | null;
  deepSeekApiKey?: string | null;
  qwenApiKey?: string | null;
  searchApiKey?: string | null;
  qwenBaseUrl: string;
  model: string;
}

export interface SettingsAdapter {
  load(): Promise<SettingsSnapshot>;
  save(update: SettingsUpdate): Promise<SettingsSnapshot>;
}

export interface SecretDraft {
  value: string;
  cleared: boolean;
}

export type ProviderSecretDrafts = Record<ModelProviderId, SecretDraft>;

const EMPTY_SECRET: SecretDraft = { value: "", cleared: false };
const EMPTY_PROVIDER_SECRETS: ProviderSecretDrafts = {
  openai: EMPTY_SECRET,
  deepseek: EMPTY_SECRET,
  qwen: EMPTY_SECRET,
};

export function SettingsPage({
  adapter,
  onRuntimeRestart,
  onLanguageChange,
  onThemeChange,
  projectOpeners = [],
  onPreferredProjectOpenerChange,
}: {
  adapter: SettingsAdapter;
  onRuntimeRestart(): Promise<void>;
  onLanguageChange?(language: Language): void;
  onThemeChange?(theme: ThemePreference): void;
  projectOpeners?: readonly ProjectOpenerOption[];
  onPreferredProjectOpenerChange?(opener: ProjectOpenerId): void;
}) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<SettingsSnapshot>();
  const [providerKeys, setProviderKeys] = useState<ProviderSecretDrafts>(
    EMPTY_PROVIDER_SECRETS,
  );
  const [searchKey, setSearchKey] = useState<SecretDraft>(EMPTY_SECRET);
  const [provider, setProvider] = useState<ModelProviderId>("openai");
  const [qwenBaseUrl, setQwenBaseUrl] = useState(DEFAULT_QWEN_BASE_URL);
  const [model, setModel] = useState<string>(MODEL_OPTIONS[0].value);
  const [language, setLanguage] = useState<Language>("zh-CN");
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [preferredProjectOpener, setPreferredProjectOpener] =
    useState<ProjectOpenerId>("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedWithRestart, setSavedWithRestart] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void adapter
      .load()
      .then((snapshot) => {
        if (!active) return;
        setSettings(snapshot);
        setLanguage(snapshot.language);
        onLanguageChange?.(snapshot.language);
        setTheme(snapshot.theme);
        onThemeChange?.(snapshot.theme);
        setPreferredProjectOpener(snapshot.preferredProjectOpener);
        onPreferredProjectOpenerChange?.(snapshot.preferredProjectOpener);
        setProvider(snapshot.provider);
        setQwenBaseUrl(snapshot.qwenBaseUrl);
        setModel(snapshot.model);
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [adapter]);

  useEffect(() => {
    if (!settings || !preferredProjectOpener || projectOpeners.length === 0) {
      return;
    }
    const resolved = resolvePreferredProjectOpener(
      projectOpeners,
      preferredProjectOpener,
    );
    if (resolved && resolved.id !== preferredProjectOpener) {
      setPreferredProjectOpener(resolved.id);
    }
  }, [preferredProjectOpener, projectOpeners, settings]);

  const providerOption = providerDetails(provider);
  const providerKey = providerKeys[provider];
  const dirty = settings
    ? Object.values(providerKeys).some(
        (draft) => draft.value.trim().length > 0 || draft.cleared,
      ) ||
      searchKey.value.trim().length > 0 ||
      searchKey.cleared ||
      provider !== settings.provider ||
      qwenBaseUrl.trim() !== settings.qwenBaseUrl ||
      model !== settings.model ||
      language !== settings.language ||
      theme !== settings.theme ||
      preferredProjectOpener !== settings.preferredProjectOpener
    : false;
  const runtimeDirty = settings
    ? Object.values(providerKeys).some(
        (draft) => draft.value.trim().length > 0 || draft.cleared,
      ) ||
      searchKey.value.trim().length > 0 ||
      searchKey.cleared ||
      provider !== settings.provider ||
      qwenBaseUrl.trim() !== settings.qwenBaseUrl ||
      model !== settings.model
    : false;

  function markEdited() {
    setSaved(false);
    setSavedWithRestart(false);
    setError(undefined);
  }

  function editProviderSecret(
    targetProvider: ModelProviderId,
    value: string,
  ) {
    setProviderKeys((drafts) => ({
      ...drafts,
      [targetProvider]: { value, cleared: false },
    }));
    markEdited();
  }

  function clearProviderSecret(targetProvider: ModelProviderId) {
    setProviderKeys((drafts) => ({
      ...drafts,
      [targetProvider]: { value: "", cleared: true },
    }));
    markEdited();
  }

  async function save() {
    if (!settings || !dirty || saving) return;
    setSaving(true);
    setSaved(false);
    setError(undefined);

    try {
      const shouldRestart = runtimeDirty;
      const snapshot = await adapter.save(
        createSettingsUpdate(
          providerKeys,
          searchKey,
          provider,
          qwenBaseUrl,
          model,
          language,
          theme,
          preferredProjectOpener,
        ),
      );
      setSettings(snapshot);
      setProviderKeys(EMPTY_PROVIDER_SECRETS);
      setSearchKey(EMPTY_SECRET);
      setSaved(true);
      setSavedWithRestart(shouldRestart);
      setPreferredProjectOpener(snapshot.preferredProjectOpener);
      onPreferredProjectOpenerChange?.(snapshot.preferredProjectOpener);
      if (shouldRestart) await onRuntimeRestart();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="workspace-header settings-header">
        <div>
          <h1>{t("settings")}</h1>
          <p>{t("settingsSubtitle")}</p>
        </div>
      </header>

      <section className="settings-scroll">
        <div className="settings-page">
          <div className="settings-intro">
            <h2>{t("preferences")}</h2>
            <p>{t("secretsNotice")}</p>
          </div>

          {!settings && !error ? (
            <div className="settings-loading">
              <LoaderCircle className="spin" size={16} /> {t("loadingSettings")}
            </div>
          ) : (
            <>
              <section
                className="settings-section"
                aria-labelledby="language-title"
              >
                <div className="settings-section-heading">
                  <span className="settings-section-icon">
                    <Palette size={16} />
                  </span>
                  <div>
                    <h3 id="language-title">{t("interface")}</h3>
                    <p>{t("interfaceDescription")}</p>
                  </div>
                </div>
                <div className="settings-fields">
                  <ThemePicker
                    value={theme}
                    onChange={(nextTheme) => {
                      setTheme(nextTheme);
                      onThemeChange?.(nextTheme);
                      markEdited();
                    }}
                  />
                  <SettingsSelectField
                    id="language-select"
                    label={t("language")}
                    description={t("languageDescription")}
                    value={language}
                    onChange={(value) => {
                      const nextLanguage = value as Language;
                      setLanguage(nextLanguage);
                      onLanguageChange?.(nextLanguage);
                      markEdited();
                    }}
                    options={LANGUAGE_OPTIONS}
                  />
                  {projectOpeners.length > 0 && (
                    <SettingsSelectField
                      id="project-opener-select"
                      label={t("preferredProjectOpener")}
                      description={t("preferredProjectOpenerDescription")}
                      value={preferredProjectOpener}
                      onChange={(value) => {
                        setPreferredProjectOpener(value as ProjectOpenerId);
                        markEdited();
                      }}
                      options={projectOpeners.map((opener) => ({
                        value: opener.id,
                        label: opener.available
                          ? opener.label
                          : `${opener.label}（${t("notInstalled")}）`,
                        iconDataUrl: opener.iconDataUrl,
                        disabled: !opener.available,
                        opener,
                      }))}
                    />
                  )}
                </div>
              </section>

              <section
                className="settings-section"
                aria-labelledby="model-title"
              >
                <div className="settings-section-heading">
                  <span className="settings-section-icon">
                    <Sparkles size={16} />
                  </span>
                  <div>
                    <h3 id="model-title">{t("modelService")}</h3>
                    <p>{t("modelServiceDescription")}</p>
                  </div>
                </div>

                <div className="settings-fields">
                  <SettingsSelectField
                    id="provider-select"
                    label={t("provider")}
                    description={providerDescription(provider, t)}
                    value={provider}
                    onChange={(value) => {
                      const nextProvider = value as ModelProviderId;
                      setProvider(nextProvider);
                      setModel(providerDetails(nextProvider).defaultModel);
                      markEdited();
                    }}
                    options={PROVIDER_OPTIONS.map((option) => ({
                      value: option.value,
                      label: providerLabel(option.value, t),
                    }))}
                  />
                  <SettingsSelectField
                    id="model-select"
                    label={t("defaultModel")}
                    description={modelDescription(provider, model, t)}
                    value={model}
                    onChange={(value) => {
                      setModel(value);
                      markEdited();
                    }}
                    options={[
                      ...(!isKnownModel(provider, model)
                        ? [{ value: model, label: `${model} (${t("currentConfiguration")})` }]
                        : []),
                      ...providerOption.models.map((option) => ({
                        value: option.value,
                        label: `${option.label} — ${modelQualifier(option.value, t)}`,
                      })),
                    ]}
                  />
                </div>
              </section>

              <section className="settings-section" aria-labelledby="api-title">
                <div className="settings-section-heading">
                  <span className="settings-section-icon">
                    <KeyRound size={16} />
                  </span>
                  <div>
                    <h3 id="api-title">{t("connectionAndKeys")}</h3>
                    <p>{t("connectionAndKeysDescription")}</p>
                  </div>
                </div>

                <div className="settings-fields">
                  <SecretField
                    key={provider}
                    id={`${provider}-api-key`}
                    label={
                      provider === "qwen"
                        ? t("qwenApiKey")
                        : providerOption.keyLabel
                    }
                    description={providerKeyDescription(provider, t)}
                    configured={providerKeyConfigured(settings, provider)}
                    draft={providerKey}
                    onChange={(value) => editProviderSecret(provider, value)}
                    onClear={() => clearProviderSecret(provider)}
                  />
                  {provider !== "openai" && (
                    <SecretField
                      id="voice-openai-api-key"
                      label={t("voiceOpenAIKey")}
                      description={t("voiceKeyDescription", {
                        provider: providerLabel(provider, t),
                      })}
                      configured={providerKeyConfigured(settings, "openai")}
                      draft={providerKeys.openai}
                      onChange={(value) => editProviderSecret("openai", value)}
                      onClear={() => clearProviderSecret("openai")}
                    />
                  )}
                  {provider === "qwen" && (
                    <TextField
                      id="qwen-base-url"
                      label="Base URL"
                      description={t("qwenBaseUrlDescription")}
                      value={qwenBaseUrl}
                      onChange={(value) => {
                        setQwenBaseUrl(value);
                        markEdited();
                      }}
                    />
                  )}
                  <SecretField
                    id="search-api-key"
                    label={t("searchApiKey")}
                    description={t("searchApiKeyDescription")}
                    configured={settings?.searchApiKeyConfigured ?? false}
                    draft={searchKey}
                    icon="search"
                    onChange={(value) => {
                      setSearchKey({ value, cleared: false });
                      markEdited();
                    }}
                    onClear={() => {
                      setSearchKey({ value: "", cleared: true });
                      markEdited();
                    }}
                  />
                </div>
              </section>

            </>
          )}

          <div className="settings-save-row">
            <div className="settings-save-status" aria-live="polite">
              {error ? (
                <span className="settings-error">{error}</span>
              ) : saved ? (
                <span className="settings-saved">
                  <Check size={13} />{" "}
                  {savedWithRestart ? t("savedAndReconnected") : t("saved")}
                </span>
              ) : (
                <span>{t("saveRestartNotice")}</span>
              )}
            </div>
            <button
              type="button"
              className="settings-save-button pressable"
              disabled={!dirty || saving || !settings}
              onClick={() => void save()}
            >
              {saving && <LoaderCircle className="spin" size={14} />}
              {saving ? t("saving") : t("saveChanges")}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

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
      openAndFocus(open ? Math.min(selectedIndex + 1, options.length - 1) : selectedIndex);
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
          <label id={`${id}-label`} htmlFor={id}>{label}</label>
          <p>{description}</p>
        </div>
      </div>
      <div
        className={`model-select-wrap ${open ? "open" : ""}`}
        ref={root}
      >
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

function SecretField({
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

function TextField({
  id,
  label,
  description,
  value,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  value: string;
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
          <Link2 size={14} />
        </span>
        <input
          id={id}
          type="url"
          value={value}
          autoComplete="off"
          spellCheck={false}
          placeholder={DEFAULT_QWEN_BASE_URL}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

export function createSettingsUpdate(
  providerKeys: ProviderSecretDrafts,
  searchKey: SecretDraft,
  provider: ModelProviderId,
  qwenBaseUrl: string,
  model: string,
  language: Language = "zh-CN",
  theme: ThemePreference = "system",
  preferredProjectOpener: ProjectOpenerId = "",
): SettingsUpdate {
  return {
    language,
    theme,
    preferredProjectOpener,
    provider,
    qwenBaseUrl: qwenBaseUrl.trim(),
    model,
    ...secretUpdate("openAIApiKey", providerKeys.openai),
    ...secretUpdate("deepSeekApiKey", providerKeys.deepseek),
    ...secretUpdate("qwenApiKey", providerKeys.qwen),
    ...secretUpdate("searchApiKey", searchKey),
  };
}

function providerDetails(provider: ModelProviderId): ProviderOption {
  return (
    PROVIDER_OPTIONS.find((option) => option.value === provider) ??
    PROVIDER_OPTIONS[0]
  );
}

function providerKeyConfigured(
  settings: SettingsSnapshot | undefined,
  provider: ModelProviderId,
): boolean {
  if (!settings) return false;
  if (provider === "deepseek") return settings.deepSeekApiKeyConfigured;
  if (provider === "qwen") return settings.qwenApiKeyConfigured;
  return settings.openAIApiKeyConfigured;
}

function isKnownModel(provider: ModelProviderId, model: string): boolean {
  return providerDetails(provider).models.some((option) => option.value === model);
}

function providerDescription(
  provider: ModelProviderId,
  t: Translate,
): string {
  if (provider === "deepseek") return t("providerDeepSeekDescription");
  if (provider === "qwen") return t("providerQwenDescription");
  return t("providerOpenAIDescription");
}

function providerLabel(provider: ModelProviderId, t: Translate): string {
  if (provider === "qwen") return t("providerQwenLabel");
  return providerDetails(provider).label;
}

function providerKeyDescription(
  provider: ModelProviderId,
  t: Translate,
): string {
  if (provider === "deepseek") return t("providerDeepSeekKeyDescription");
  if (provider === "qwen") return t("providerQwenKeyDescription");
  return t("providerOpenAIKeyDescription");
}

function modelDescription(
  provider: ModelProviderId,
  model: string,
  t: Translate,
): string {
  const descriptions: Record<string, Parameters<Translate>[0]> = {
    "gpt-5.6-sol": "modelComplex",
    "gpt-5.6-terra": "modelBalanced",
    "gpt-5.6-luna": "modelCost",
    "gpt-5.4-mini": "modelFastCoding",
    "gpt-5-mini": "modelClearGoals",
    "gpt-4.1-mini": "modelNoReasoning",
    "deepseek-v4-pro": "modelAgentComplex",
    "deepseek-v4-flash": "modelAgentFast",
    "qwen3.7-max": "modelQwenMax",
    "qwen3.7-plus": "modelQwenPlus",
    "qwen3.6-flash": "modelQwenFlash",
  };
  const key = descriptions[model];
  return (
    (key ? t(key) : undefined) ??
    providerDetails(provider).models.find((option) => option.value === model)
      ?.description ??
    t("externalModelDescription")
  );
}

function modelQualifier(model: string, t: Translate): string {
  if (model === "gpt-5.6-sol" || model === "deepseek-v4-pro" || model === "qwen3.7-max") {
    return t("performanceFirst");
  }
  if (model === "gpt-5.6-terra" || model === "qwen3.7-plus") return t("balanced");
  if (model === "gpt-5.6-luna") return t("costFirst");
  if (model === "gpt-5.4-mini") return t("powerfulMini");
  if (model === "gpt-5-mini") return t("economicalMini");
  if (model === "gpt-4.1-mini") return t("lowLatencyMini");
  if (model === "deepseek-v4-flash") return t("speedFirst");
  return t("lowLatency");
}

function secretUpdate<K extends keyof Pick<
  SettingsUpdate,
  "openAIApiKey" | "deepSeekApiKey" | "qwenApiKey" | "searchApiKey"
>>(
  key: K,
  draft: SecretDraft,
): Pick<SettingsUpdate, K> | Record<string, never> {
  const value = draft.value.trim();
  if (value) return { [key]: value } as Pick<SettingsUpdate, K>;
  if (draft.cleared) return { [key]: null } as Pick<SettingsUpdate, K>;
  return {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
