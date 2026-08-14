import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
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
export {
  providerIsConfigured,
  providerIsConfiguredFor,
} from "./settings-readiness.js";
export {
  PROVIDER_OPTIONS,
  isKnownModel,
  modelDescription,
  modelQualifier,
  providerDescription,
  providerDetails,
  providerKeyDescription,
  providerKeyLabel,
  providerLabel,
  type ModelOption,
  type ModelProviderId,
  type ProviderOption,
} from "./model-catalog.js";
import {
  PROVIDER_OPTIONS,
  isKnownModel,
  modelDescription,
  modelQualifier,
  providerDescription,
  providerDetails,
  providerKeyDescription,
  providerKeyLabel,
  providerLabel,
  type ModelProviderId,
} from "./model-catalog.js";

export const MODEL_OPTIONS = PROVIDER_OPTIONS[0].models;
export const DEFAULT_QWEN_BASE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const DEFAULT_KIMI_BASE_URL = "https://api.moonshot.ai/v1";
export const DEFAULT_DOUBAO_BASE_URL =
  "https://ark.cn-beijing.volces.com/api/v3";
export const DEFAULT_GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";
export const DEFAULT_GROK_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_CUSTOM_BASE_URL = "http://127.0.0.1:11434/v1";

export interface SettingsSnapshot {
  language: Language;
  theme: ThemePreference;
  preferredProjectOpener: ProjectOpenerId;
  provider: ModelProviderId;
  openAIApiKeyConfigured: boolean;
  deepSeekApiKeyConfigured: boolean;
  qwenApiKeyConfigured: boolean;
  kimiApiKeyConfigured: boolean;
  doubaoApiKeyConfigured: boolean;
  geminiApiKeyConfigured: boolean;
  grokApiKeyConfigured: boolean;
  customApiKeyConfigured: boolean;
  searchProvider: SearchProviderId;
  searchApiKeyConfigured: boolean;
  linkupApiKeyConfigured: boolean;
  qwenBaseUrl: string;
  kimiBaseUrl: string;
  doubaoBaseUrl: string;
  geminiBaseUrl: string;
  grokBaseUrl: string;
  customBaseUrl: string;
  customModel: string;
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
  kimiApiKey?: string | null;
  doubaoApiKey?: string | null;
  geminiApiKey?: string | null;
  grokApiKey?: string | null;
  customApiKey?: string | null;
  searchProvider: SearchProviderId;
  searchApiKey?: string | null;
  linkupApiKey?: string | null;
  qwenBaseUrl: string;
  kimiBaseUrl: string;
  doubaoBaseUrl: string;
  geminiBaseUrl: string;
  grokBaseUrl: string;
  customBaseUrl: string;
  customModel: string;
  model: string;
}

export interface SettingsAdapter {
  load(): Promise<SettingsSnapshot>;
  save(update: SettingsUpdate): Promise<SettingsSnapshot>;
  testProvider?(request: ProviderTestRequest): Promise<ProviderDiagnostic>;
}

export type SecretStorageBoundary = "system" | "host-file";

export interface ProviderTestRequest {
  provider: ModelProviderId;
  model: string;
  baseUrl?: string;
  apiKey?: string | null;
}

export type ProviderDiagnosticCode =
  | "ok"
  | "missing_key"
  | "invalid_url"
  | "unauthorized"
  | "endpoint_not_found"
  | "model_not_found"
  | "rate_limited"
  | "timeout"
  | "network"
  | "provider_error";

export interface ProviderDiagnostic {
  status: "success" | "warning" | "error";
  code: ProviderDiagnosticCode;
  provider: ModelProviderId;
  model: string;
  endpoint: string;
  checkedAt: string;
  latencyMs: number;
  httpStatus?: number;
  detail?: string;
}

export interface SecretDraft {
  value: string;
  cleared: boolean;
}

export type ProviderSecretDrafts = Record<ModelProviderId, SecretDraft>;
export type SearchProviderId = "brave" | "linkup";
export type SearchSecretDrafts = Record<SearchProviderId, SecretDraft>;

const EMPTY_SECRET: SecretDraft = { value: "", cleared: false };
const EMPTY_PROVIDER_SECRETS: ProviderSecretDrafts = {
  openai: EMPTY_SECRET,
  deepseek: EMPTY_SECRET,
  qwen: EMPTY_SECRET,
  kimi: EMPTY_SECRET,
  doubao: EMPTY_SECRET,
  gemini: EMPTY_SECRET,
  grok: EMPTY_SECRET,
  custom: EMPTY_SECRET,
};
export const EMPTY_SEARCH_SECRETS: SearchSecretDrafts = {
  brave: EMPTY_SECRET,
  linkup: EMPTY_SECRET,
};

export function SettingsPage({
  adapter,
  secretStorageBoundary = "system",
  onRuntimeRestart,
  onLanguageChange,
  onThemeChange,
  projectOpeners = [],
  onPreferredProjectOpenerChange,
  onSettingsChange,
}: {
  adapter: SettingsAdapter;
  secretStorageBoundary?: SecretStorageBoundary;
  onRuntimeRestart(): Promise<void>;
  onLanguageChange?(language: Language): void;
  onThemeChange?(theme: ThemePreference): void;
  projectOpeners?: readonly ProjectOpenerOption[];
  onPreferredProjectOpenerChange?(opener: ProjectOpenerId): void;
  onSettingsChange?(settings: SettingsSnapshot): void;
}) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<SettingsSnapshot>();
  const [providerKeys, setProviderKeys] = useState<ProviderSecretDrafts>(
    EMPTY_PROVIDER_SECRETS,
  );
  const [searchKeys, setSearchKeys] =
    useState<SearchSecretDrafts>(EMPTY_SEARCH_SECRETS);
  const [searchProvider, setSearchProvider] =
    useState<SearchProviderId>("brave");
  const [provider, setProvider] = useState<ModelProviderId>("openai");
  const [qwenBaseUrl, setQwenBaseUrl] = useState(DEFAULT_QWEN_BASE_URL);
  const [kimiBaseUrl, setKimiBaseUrl] = useState(DEFAULT_KIMI_BASE_URL);
  const [doubaoBaseUrl, setDoubaoBaseUrl] = useState(DEFAULT_DOUBAO_BASE_URL);
  const [geminiBaseUrl, setGeminiBaseUrl] = useState(DEFAULT_GEMINI_BASE_URL);
  const [grokBaseUrl, setGrokBaseUrl] = useState(DEFAULT_GROK_BASE_URL);
  const [customBaseUrl, setCustomBaseUrl] = useState(DEFAULT_CUSTOM_BASE_URL);
  const [customModel, setCustomModel] = useState("llama3.2");
  const [model, setModel] = useState<string>(MODEL_OPTIONS[0].value);
  const [language, setLanguage] = useState<Language>("zh-CN");
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [preferredProjectOpener, setPreferredProjectOpener] =
    useState<ProjectOpenerId>("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedWithRestart, setSavedWithRestart] = useState(false);
  const [appearanceSaveStatus, setAppearanceSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [appearanceSaveError, setAppearanceSaveError] = useState<string>();
  const [error, setError] = useState<string>();
  const [testingProvider, setTestingProvider] = useState(false);
  const [providerDiagnostic, setProviderDiagnostic] =
    useState<ProviderDiagnostic>();
  const settingsRef = useRef<SettingsSnapshot | undefined>(undefined);
  const persistedSettingsRef = useRef<SettingsSnapshot | undefined>(undefined);
  const appearanceSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const appearanceRevisionRef = useRef(0);
  const appearancePendingRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void adapter
      .load()
      .then((snapshot) => {
        if (!active) return;
        settingsRef.current = snapshot;
        persistedSettingsRef.current = snapshot;
        setSettings(snapshot);
        onSettingsChange?.(snapshot);
        setLanguage(snapshot.language);
        onLanguageChange?.(snapshot.language);
        setTheme(snapshot.theme);
        onThemeChange?.(snapshot.theme);
        setPreferredProjectOpener(snapshot.preferredProjectOpener);
        onPreferredProjectOpenerChange?.(snapshot.preferredProjectOpener);
        setProvider(snapshot.provider);
        setSearchProvider(snapshot.searchProvider);
        setQwenBaseUrl(snapshot.qwenBaseUrl);
        setKimiBaseUrl(snapshot.kimiBaseUrl);
        setDoubaoBaseUrl(snapshot.doubaoBaseUrl);
        setGeminiBaseUrl(snapshot.geminiBaseUrl);
        setGrokBaseUrl(snapshot.grokBaseUrl);
        setCustomBaseUrl(snapshot.customBaseUrl);
        setCustomModel(snapshot.customModel);
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
  const searchKey = searchKeys[searchProvider];
  const dirty = settings
    ? Object.values(providerKeys).some(
        (draft) => draft.value.trim().length > 0 || draft.cleared,
      ) ||
      Object.values(searchKeys).some(
        (draft) => draft.value.trim().length > 0 || draft.cleared,
      ) ||
      searchProvider !== settings.searchProvider ||
      provider !== settings.provider ||
      qwenBaseUrl.trim() !== settings.qwenBaseUrl ||
      kimiBaseUrl.trim() !== settings.kimiBaseUrl ||
      doubaoBaseUrl.trim() !== settings.doubaoBaseUrl ||
      geminiBaseUrl.trim() !== settings.geminiBaseUrl ||
      grokBaseUrl.trim() !== settings.grokBaseUrl ||
      customBaseUrl.trim() !== settings.customBaseUrl ||
      customModel.trim() !== settings.customModel ||
      model !== settings.model ||
      preferredProjectOpener !== settings.preferredProjectOpener
    : false;
  const runtimeDirty = settings
    ? Object.values(providerKeys).some(
        (draft) => draft.value.trim().length > 0 || draft.cleared,
      ) ||
      Object.values(searchKeys).some(
        (draft) => draft.value.trim().length > 0 || draft.cleared,
      ) ||
      searchProvider !== settings.searchProvider ||
      provider !== settings.provider ||
      qwenBaseUrl.trim() !== settings.qwenBaseUrl ||
      kimiBaseUrl.trim() !== settings.kimiBaseUrl ||
      doubaoBaseUrl.trim() !== settings.doubaoBaseUrl ||
      geminiBaseUrl.trim() !== settings.geminiBaseUrl ||
      grokBaseUrl.trim() !== settings.grokBaseUrl ||
      customBaseUrl.trim() !== settings.customBaseUrl ||
      customModel.trim() !== settings.customModel ||
      model !== settings.model
    : false;

  function markEdited() {
    setSaved(false);
    setSavedWithRestart(false);
    setError(undefined);
    setProviderDiagnostic(undefined);
  }

  function editProviderSecret(targetProvider: ModelProviderId, value: string) {
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

  function editSearchSecret(targetProvider: SearchProviderId, value: string) {
    setSearchKeys((drafts) => ({
      ...drafts,
      [targetProvider]: { value, cleared: false },
    }));
    markEdited();
  }

  function clearSearchSecret(targetProvider: SearchProviderId) {
    setSearchKeys((drafts) => ({
      ...drafts,
      [targetProvider]: { value: "", cleared: true },
    }));
    markEdited();
  }

  function saveAppearance(
    update: Partial<Pick<SettingsSnapshot, "language" | "theme">>,
  ) {
    const current = settingsRef.current;
    if (!current) return;

    const next = { ...current, ...update };
    const revision = ++appearanceRevisionRef.current;
    settingsRef.current = next;
    setSettings(next);
    setAppearanceSaveStatus("saving");
    setAppearanceSaveError(undefined);
    appearancePendingRef.current += 1;

    appearanceSaveQueueRef.current = appearanceSaveQueueRef.current.then(
      async () => {
        try {
          const snapshot = await adapter.save(
            createAppearanceSettingsUpdate(next),
          );
          persistedSettingsRef.current = snapshot;
          if (
            !mountedRef.current ||
            revision !== appearanceRevisionRef.current
          ) {
            return;
          }
          settingsRef.current = snapshot;
          setSettings(snapshot);
          setLanguage(snapshot.language);
          setTheme(snapshot.theme);
          onLanguageChange?.(snapshot.language);
          onThemeChange?.(snapshot.theme);
          onSettingsChange?.(snapshot);
          setAppearanceSaveStatus("saved");
        } catch (reason) {
          if (
            !mountedRef.current ||
            revision !== appearanceRevisionRef.current
          ) {
            return;
          }
          const persisted = persistedSettingsRef.current;
          if (persisted) {
            settingsRef.current = persisted;
            setSettings(persisted);
            setLanguage(persisted.language);
            setTheme(persisted.theme);
            onLanguageChange?.(persisted.language);
            onThemeChange?.(persisted.theme);
          }
          setAppearanceSaveError(errorMessage(reason));
          setAppearanceSaveStatus("error");
        } finally {
          appearancePendingRef.current -= 1;
        }
      },
    );
  }

  async function save() {
    if (!settings || !dirty || saving || appearancePendingRef.current > 0) {
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(undefined);

    try {
      const shouldRestart = runtimeDirty;
      const snapshot = await adapter.save(
        createSettingsUpdate(
          providerKeys,
          searchKeys,
          searchProvider,
          provider,
          qwenBaseUrl,
          kimiBaseUrl,
          doubaoBaseUrl,
          geminiBaseUrl,
          grokBaseUrl,
          customBaseUrl,
          customModel,
          model,
          language,
          theme,
          preferredProjectOpener,
        ),
      );
      settingsRef.current = snapshot;
      persistedSettingsRef.current = snapshot;
      setSettings(snapshot);
      onSettingsChange?.(snapshot);
      setProviderKeys(EMPTY_PROVIDER_SECRETS);
      setSearchKeys(EMPTY_SEARCH_SECRETS);
      setSearchProvider(snapshot.searchProvider);
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

  async function testConnection() {
    if (!adapter.testProvider || testingProvider || !settings) return;
    setTestingProvider(true);
    setProviderDiagnostic(undefined);
    setError(undefined);
    const draft = providerKeys[provider];
    try {
      setProviderDiagnostic(
        await adapter.testProvider({
          provider,
          model: model.trim(),
          ...(["qwen", "kimi", "doubao", "gemini", "grok", "custom"].includes(
            provider,
          )
            ? {
                baseUrl: providerBaseUrl(
                  provider,
                  qwenBaseUrl,
                  kimiBaseUrl,
                  doubaoBaseUrl,
                  geminiBaseUrl,
                  grokBaseUrl,
                  customBaseUrl,
                ),
              }
            : {}),
          ...(draft.cleared
            ? { apiKey: null }
            : draft.value.trim()
              ? { apiKey: draft.value.trim() }
              : {}),
        }),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setTestingProvider(false);
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
            <p>
              {t(
                secretStorageBoundary === "host-file"
                  ? "secretsNoticeHost"
                  : "secretsNoticeSystem",
              )}
            </p>
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
                  <div className="settings-section-heading-copy">
                    <h3 id="language-title">{t("interface")}</h3>
                    <p>{t("interfaceDescription")}</p>
                  </div>
                  {appearanceSaveStatus !== "idle" && (
                    <span
                      className={`settings-appearance-status ${appearanceSaveStatus}`}
                      role="status"
                    >
                      {appearanceSaveStatus === "saving" ? (
                        <LoaderCircle className="spin" size={13} />
                      ) : appearanceSaveStatus === "saved" ? (
                        <Check size={13} />
                      ) : (
                        <CircleAlert size={13} />
                      )}
                      {appearanceSaveStatus === "saving"
                        ? t("saving")
                        : appearanceSaveStatus === "saved"
                          ? t("saved")
                          : `${t("appearanceSaveFailed")}${appearanceSaveError ? ` · ${appearanceSaveError}` : ""}`}
                    </span>
                  )}
                </div>
                <div className="settings-fields">
                  <ThemePicker
                    value={theme}
                    onChange={(nextTheme) => {
                      setTheme(nextTheme);
                      onThemeChange?.(nextTheme);
                      saveAppearance({ theme: nextTheme });
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
                      saveAppearance({ language: nextLanguage });
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
                      setModel(
                        nextProvider === "custom"
                          ? customModel
                          : providerDetails(nextProvider).defaultModel,
                      );
                      markEdited();
                    }}
                    options={PROVIDER_OPTIONS.map((option) => ({
                      value: option.value,
                      label: providerLabel(option.value, t),
                    }))}
                  />
                  {provider === "custom" ? (
                    <TextField
                      id="custom-model"
                      label={t("customModel")}
                      description={t("customModelDescription")}
                      value={model}
                      placeholder="llama3.2"
                      inputType="text"
                      icon="model"
                      onChange={(value) => {
                        setModel(value);
                        setCustomModel(value);
                        markEdited();
                      }}
                    />
                  ) : (
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
                          ? [
                              {
                                value: model,
                                label: `${model} (${t("currentConfiguration")})`,
                              },
                            ]
                          : []),
                        ...providerOption.models.map((option) => ({
                          value: option.value,
                          label: `${option.label} — ${modelQualifier(option.value, t)}`,
                        })),
                      ]}
                    />
                  )}
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
                    label={providerKeyLabel(provider, t)}
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
                      placeholder={DEFAULT_QWEN_BASE_URL}
                      onChange={(value) => {
                        setQwenBaseUrl(value);
                        markEdited();
                      }}
                    />
                  )}
                  {provider === "kimi" && (
                    <TextField
                      id="kimi-base-url"
                      label="Base URL"
                      description={t("kimiBaseUrlDescription")}
                      value={kimiBaseUrl}
                      placeholder={DEFAULT_KIMI_BASE_URL}
                      onChange={(value) => {
                        setKimiBaseUrl(value);
                        markEdited();
                      }}
                    />
                  )}
                  {provider === "doubao" && (
                    <TextField
                      id="doubao-base-url"
                      label="Base URL"
                      description={t("doubaoBaseUrlDescription")}
                      value={doubaoBaseUrl}
                      placeholder={DEFAULT_DOUBAO_BASE_URL}
                      onChange={(value) => {
                        setDoubaoBaseUrl(value);
                        markEdited();
                      }}
                    />
                  )}
                  {provider === "gemini" && (
                    <TextField
                      id="gemini-base-url"
                      label="Base URL"
                      description={t("geminiBaseUrlDescription")}
                      value={geminiBaseUrl}
                      placeholder={DEFAULT_GEMINI_BASE_URL}
                      onChange={(value) => {
                        setGeminiBaseUrl(value);
                        markEdited();
                      }}
                    />
                  )}
                  {provider === "grok" && (
                    <TextField
                      id="grok-base-url"
                      label="Base URL"
                      description={t("grokBaseUrlDescription")}
                      value={grokBaseUrl}
                      placeholder={DEFAULT_GROK_BASE_URL}
                      onChange={(value) => {
                        setGrokBaseUrl(value);
                        markEdited();
                      }}
                    />
                  )}
                  {provider === "custom" && (
                    <TextField
                      id="custom-base-url"
                      label="Base URL"
                      description={t("customBaseUrlDescription")}
                      value={customBaseUrl}
                      placeholder={DEFAULT_CUSTOM_BASE_URL}
                      onChange={(value) => {
                        setCustomBaseUrl(value);
                        markEdited();
                      }}
                    />
                  )}
                  <SettingsSelectField
                    id="search-provider-select"
                    label={t("searchProvider")}
                    description={t(
                      searchProvider === "linkup"
                        ? "linkupSearchDescription"
                        : "braveSearchDescription",
                    )}
                    value={searchProvider}
                    onChange={(value) => {
                      setSearchProvider(value as SearchProviderId);
                      markEdited();
                    }}
                    options={[
                      { value: "linkup", label: "Linkup" },
                      { value: "brave", label: "Brave Search" },
                    ]}
                  />
                  <SecretField
                    key={searchProvider}
                    id={`${searchProvider}-search-api-key`}
                    label={
                      searchProvider === "linkup"
                        ? t("linkupApiKey")
                        : t("braveSearchApiKey")
                    }
                    description={t(
                      searchProvider === "linkup"
                        ? "linkupApiKeyDescription"
                        : "braveSearchApiKeyDescription",
                    )}
                    configured={
                      searchProvider === "linkup"
                        ? (settings?.linkupApiKeyConfigured ?? false)
                        : (settings?.searchApiKeyConfigured ?? false)
                    }
                    draft={searchKey}
                    icon="search"
                    onChange={(value) =>
                      editSearchSecret(searchProvider, value)
                    }
                    onClear={() => clearSearchSecret(searchProvider)}
                  />
                </div>
                {adapter.testProvider && (
                  <div className="provider-test">
                    <div className="provider-test-heading">
                      <div>
                        <strong>{t("providerConnectionTest")}</strong>
                        <p>{t("providerConnectionTestDescription")}</p>
                      </div>
                      <button
                        type="button"
                        className="provider-test-button pressable"
                        disabled={testingProvider || !model.trim()}
                        onClick={() => void testConnection()}
                      >
                        {testingProvider ? (
                          <LoaderCircle className="spin" size={14} />
                        ) : (
                          <Link2 size={14} />
                        )}
                        {testingProvider
                          ? t("testingConnection")
                          : t("testConnection")}
                      </button>
                    </div>
                    {providerDiagnostic && (
                      <div
                        className={`provider-test-result ${providerDiagnostic.status}`}
                        role="status"
                      >
                        <span className="provider-test-result-icon">
                          {providerDiagnostic.status === "success" ? (
                            <CircleCheck size={16} />
                          ) : (
                            <CircleAlert size={16} />
                          )}
                        </span>
                        <div>
                          <strong>
                            {providerDiagnosticMessage(
                              providerDiagnostic.code,
                              t,
                            )}
                          </strong>
                          <p>
                            {providerDiagnostic.endpoint} ·{" "}
                            {providerDiagnostic.latencyMs} ms
                            {providerDiagnostic.httpStatus
                              ? ` · HTTP ${providerDiagnostic.httpStatus}`
                              : ""}
                          </p>
                          {providerDiagnostic.detail && (
                            <small>{providerDiagnostic.detail}</small>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
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
              disabled={
                !dirty ||
                saving ||
                appearanceSaveStatus === "saving" ||
                !settings
              }
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

export { SettingsSelectField, ThemePicker } from "./settings-fields.js";
import {
  SecretField,
  SettingsSelectField,
  TextField,
  ThemePicker,
} from "./settings-fields.js";

export function createSettingsUpdate(
  providerKeys: ProviderSecretDrafts,
  searchKeys: SearchSecretDrafts,
  searchProvider: SearchProviderId,
  provider: ModelProviderId,
  qwenBaseUrl: string,
  kimiBaseUrl: string,
  doubaoBaseUrl: string,
  geminiBaseUrl: string,
  grokBaseUrl: string,
  customBaseUrl: string,
  customModel: string,
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
    searchProvider,
    qwenBaseUrl: qwenBaseUrl.trim(),
    kimiBaseUrl: kimiBaseUrl.trim(),
    doubaoBaseUrl: doubaoBaseUrl.trim(),
    geminiBaseUrl: geminiBaseUrl.trim(),
    grokBaseUrl: grokBaseUrl.trim(),
    customBaseUrl: customBaseUrl.trim(),
    customModel: customModel.trim(),
    model,
    ...secretUpdate("openAIApiKey", providerKeys.openai),
    ...secretUpdate("deepSeekApiKey", providerKeys.deepseek),
    ...secretUpdate("qwenApiKey", providerKeys.qwen),
    ...secretUpdate("kimiApiKey", providerKeys.kimi),
    ...secretUpdate("doubaoApiKey", providerKeys.doubao),
    ...secretUpdate("geminiApiKey", providerKeys.gemini),
    ...secretUpdate("grokApiKey", providerKeys.grok),
    ...secretUpdate("customApiKey", providerKeys.custom),
    ...secretUpdate("searchApiKey", searchKeys.brave),
    ...secretUpdate("linkupApiKey", searchKeys.linkup),
  };
}

export function createAppearanceSettingsUpdate(
  settings: SettingsSnapshot,
): SettingsUpdate {
  return createSettingsUpdate(
    EMPTY_PROVIDER_SECRETS,
    EMPTY_SEARCH_SECRETS,
    settings.searchProvider,
    settings.provider,
    settings.qwenBaseUrl,
    settings.kimiBaseUrl,
    settings.doubaoBaseUrl,
    settings.geminiBaseUrl,
    settings.grokBaseUrl,
    settings.customBaseUrl,
    settings.customModel,
    settings.model,
    settings.language,
    settings.theme,
    settings.preferredProjectOpener,
  );
}

function providerKeyConfigured(
  settings: SettingsSnapshot | undefined,
  provider: ModelProviderId,
): boolean {
  if (!settings) return false;
  if (provider === "deepseek") return settings.deepSeekApiKeyConfigured;
  if (provider === "qwen") return settings.qwenApiKeyConfigured;
  if (provider === "kimi") return settings.kimiApiKeyConfigured;
  if (provider === "doubao") return settings.doubaoApiKeyConfigured;
  if (provider === "gemini") return settings.geminiApiKeyConfigured;
  if (provider === "grok") return settings.grokApiKeyConfigured;
  if (provider === "custom") return settings.customApiKeyConfigured;
  return settings.openAIApiKeyConfigured;
}

function providerBaseUrl(
  provider: ModelProviderId,
  qwenBaseUrl: string,
  kimiBaseUrl: string,
  doubaoBaseUrl: string,
  geminiBaseUrl: string,
  grokBaseUrl: string,
  customBaseUrl: string,
): string {
  if (provider === "qwen") return qwenBaseUrl.trim();
  if (provider === "kimi") return kimiBaseUrl.trim();
  if (provider === "doubao") return doubaoBaseUrl.trim();
  if (provider === "gemini") return geminiBaseUrl.trim();
  if (provider === "grok") return grokBaseUrl.trim();
  if (provider === "custom") return customBaseUrl.trim();
  return "";
}

function providerDiagnosticMessage(
  code: ProviderDiagnosticCode,
  t: Translate,
): string {
  switch (code) {
    case "ok":
      return t("providerDiagnosticOk");
    case "missing_key":
      return t("providerDiagnosticMissingKey");
    case "invalid_url":
      return t("providerDiagnosticInvalidUrl");
    case "unauthorized":
      return t("providerDiagnosticUnauthorized");
    case "endpoint_not_found":
      return t("providerDiagnosticEndpointNotFound");
    case "model_not_found":
      return t("providerDiagnosticModelNotFound");
    case "rate_limited":
      return t("providerDiagnosticRateLimited");
    case "timeout":
      return t("providerDiagnosticTimeout");
    case "network":
      return t("providerDiagnosticNetwork");
    case "provider_error":
      return t("providerDiagnosticError");
  }
}

function secretUpdate<
  K extends keyof Pick<
    SettingsUpdate,
    | "openAIApiKey"
    | "deepSeekApiKey"
    | "qwenApiKey"
    | "kimiApiKey"
    | "doubaoApiKey"
    | "geminiApiKey"
    | "grokApiKey"
    | "customApiKey"
    | "searchApiKey"
    | "linkupApiKey"
  >,
>(key: K, draft: SecretDraft): Pick<SettingsUpdate, K> | Record<string, never> {
  const value = draft.value.trim();
  if (value) return { [key]: value } as Pick<SettingsUpdate, K>;
  if (draft.cleared) return { [key]: null } as Pick<SettingsUpdate, K>;
  return {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
