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

export type ModelProviderId =
  | "openai"
  | "deepseek"
  | "qwen"
  | "kimi"
  | "doubao"
  | "gemini"
  | "grok"
  | "custom";

export interface ModelOption {
  value: string;
  label: string;
  qualifier: string;
  description: string;
}

export interface ProviderOption {
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
    value: "kimi",
    label: "Kimi",
    description: "直连 Moonshot AI 开放平台，支持 Kimi K3 与 K2 系列。",
    keyLabel: "Moonshot API Key",
    keyDescription: "用于 Kimi 模型请求。",
    defaultModel: "kimi-k3",
    models: [
      {
        value: "kimi-k3",
        label: "Kimi K3",
        qualifier: "性能优先",
        description: "旗舰模型，适合长程编程、知识工作和深度推理。",
      },
      {
        value: "kimi-k2.6",
        label: "Kimi K2.6",
        qualifier: "均衡",
        description: "成熟的 256K 上下文 Agent 模型，支持编程、推理与工具调用。",
      },
      {
        value: "kimi-k2.5",
        label: "Kimi K2.5",
        qualifier: "上一代",
        description: "上一代模型，适合需要兼容既有工作流的任务。",
      },
    ],
  },
  {
    value: "doubao",
    label: "豆包",
    description: "通过火山方舟 OpenAI 兼容接口使用豆包 Seed 系列。",
    keyLabel: "Ark API Key",
    keyDescription: "用于火山方舟在线推理请求。",
    defaultModel: "doubao-seed-2-0-pro-260215",
    models: [
      {
        value: "doubao-seed-2-0-pro-260215",
        label: "Doubao Seed 2.0 Pro",
        qualifier: "性能优先",
        description: "旗舰 Agent 模型，适合复杂推理和长链路任务。",
      },
      {
        value: "doubao-seed-2-0-code-preview-260215",
        label: "Doubao Seed 2.0 Code",
        qualifier: "编程优化",
        description: "面向代码生成、调试和仓库级开发任务。",
      },
      {
        value: "doubao-seed-2-0-lite-260215",
        label: "Doubao Seed 2.0 Lite",
        qualifier: "均衡",
        description: "兼顾能力、速度和 Token 消耗，适合多数 Agent 任务。",
      },
    ],
  },
  {
    value: "gemini",
    label: "Gemini",
    description: "通过 Google Gemini API 的 OpenAI 兼容接口调用 Gemini。",
    keyLabel: "Gemini API Key",
    keyDescription: "用于 Google AI Studio / Gemini API 模型请求。",
    defaultModel: "gemini-3.6-flash",
    models: [
      {
        value: "gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro Preview",
        qualifier: "性能优先",
        description: "适合高难度推理、编程和复杂 Agent 任务。",
      },
      {
        value: "gemini-3.6-flash",
        label: "Gemini 3.6 Flash",
        qualifier: "均衡",
        description: "最新稳定 Flash 模型，兼顾智能、速度和成本。",
      },
      {
        value: "gemini-3.5-flash-lite",
        label: "Gemini 3.5 Flash-Lite",
        qualifier: "成本优先",
        description: "面向低成本、高吞吐和轻量任务。",
      },
    ],
  },
  {
    value: "grok",
    label: "Grok",
    description: "直连 xAI API，支持 Grok 推理、编程与工具调用。",
    keyLabel: "xAI API Key",
    keyDescription: "用于 xAI Grok 模型请求。",
    defaultModel: "grok-4.5",
    models: [
      {
        value: "grok-4.5",
        label: "Grok 4.5",
        qualifier: "性能优先",
        description: "面向编程、Agent 和知识工作的旗舰模型。",
      },
      {
        value: "grok-build-0.1",
        label: "Grok Build 0.1",
        qualifier: "编程优化",
        description: "针对 Agent 编程与 Web 开发优化。",
      },
      {
        value: "grok-4.3",
        label: "Grok 4.3",
        qualifier: "均衡",
        description: "长上下文通用模型，兼顾能力与成本。",
      },
    ],
  },
  {
    value: "custom",
    label: "自定义",
    description: "连接任意 OpenAI 兼容的本地、自建或代理服务。",
    keyLabel: "API Key（可选）",
    keyDescription: "本地服务通常无需密钥；远程服务可按需填写。",
    defaultModel: "llama3.2",
    models: [
      {
        value: "llama3.2",
        label: "自定义模型",
        qualifier: "手动配置",
        description: "输入服务实际提供的模型 ID。",
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
  searchApiKeyConfigured: boolean;
  qwenBaseUrl: string;
  kimiBaseUrl: string;
  doubaoBaseUrl: string;
  geminiBaseUrl: string;
  grokBaseUrl: string;
  customBaseUrl: string;
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
  searchApiKey?: string | null;
  qwenBaseUrl: string;
  kimiBaseUrl: string;
  doubaoBaseUrl: string;
  geminiBaseUrl: string;
  grokBaseUrl: string;
  customBaseUrl: string;
  model: string;
}

export interface SettingsAdapter {
  load(): Promise<SettingsSnapshot>;
  save(update: SettingsUpdate): Promise<SettingsSnapshot>;
  testProvider?(
    request: ProviderTestRequest,
  ): Promise<ProviderDiagnostic>;
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
  const [searchKey, setSearchKey] = useState<SecretDraft>(EMPTY_SECRET);
  const [provider, setProvider] = useState<ModelProviderId>("openai");
  const [qwenBaseUrl, setQwenBaseUrl] = useState(DEFAULT_QWEN_BASE_URL);
  const [kimiBaseUrl, setKimiBaseUrl] = useState(DEFAULT_KIMI_BASE_URL);
  const [doubaoBaseUrl, setDoubaoBaseUrl] = useState(DEFAULT_DOUBAO_BASE_URL);
  const [geminiBaseUrl, setGeminiBaseUrl] = useState(DEFAULT_GEMINI_BASE_URL);
  const [grokBaseUrl, setGrokBaseUrl] = useState(DEFAULT_GROK_BASE_URL);
  const [customBaseUrl, setCustomBaseUrl] = useState(DEFAULT_CUSTOM_BASE_URL);
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
        setQwenBaseUrl(snapshot.qwenBaseUrl);
        setKimiBaseUrl(snapshot.kimiBaseUrl);
        setDoubaoBaseUrl(snapshot.doubaoBaseUrl);
        setGeminiBaseUrl(snapshot.geminiBaseUrl);
        setGrokBaseUrl(snapshot.grokBaseUrl);
        setCustomBaseUrl(snapshot.customBaseUrl);
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
      kimiBaseUrl.trim() !== settings.kimiBaseUrl ||
      doubaoBaseUrl.trim() !== settings.doubaoBaseUrl ||
      geminiBaseUrl.trim() !== settings.geminiBaseUrl ||
      grokBaseUrl.trim() !== settings.grokBaseUrl ||
      customBaseUrl.trim() !== settings.customBaseUrl ||
      model !== settings.model ||
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
      kimiBaseUrl.trim() !== settings.kimiBaseUrl ||
      doubaoBaseUrl.trim() !== settings.doubaoBaseUrl ||
      geminiBaseUrl.trim() !== settings.geminiBaseUrl ||
      grokBaseUrl.trim() !== settings.grokBaseUrl ||
      customBaseUrl.trim() !== settings.customBaseUrl ||
      model !== settings.model
    : false;

  function markEdited() {
    setSaved(false);
    setSavedWithRestart(false);
    setError(undefined);
    setProviderDiagnostic(undefined);
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
          if (!mountedRef.current || revision !== appearanceRevisionRef.current) {
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
          if (!mountedRef.current || revision !== appearanceRevisionRef.current) {
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
    if (
      !settings ||
      !dirty ||
      saving ||
      appearancePendingRef.current > 0
    ) {
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
          searchKey,
          provider,
          qwenBaseUrl,
          kimiBaseUrl,
          doubaoBaseUrl,
          geminiBaseUrl,
          grokBaseUrl,
          customBaseUrl,
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
                      setModel(providerDetails(nextProvider).defaultModel);
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
                          ? [{ value: model, label: `${model} (${t("currentConfiguration")})` }]
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
                    label={
                      provider === "qwen"
                        ? t("qwenApiKey")
                        : provider === "custom"
                          ? t("customApiKey")
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

export function createSettingsUpdate(
  providerKeys: ProviderSecretDrafts,
  searchKey: SecretDraft,
  provider: ModelProviderId,
  qwenBaseUrl: string,
  kimiBaseUrl: string,
  doubaoBaseUrl: string,
  geminiBaseUrl: string,
  grokBaseUrl: string,
  customBaseUrl: string,
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
    kimiBaseUrl: kimiBaseUrl.trim(),
    doubaoBaseUrl: doubaoBaseUrl.trim(),
    geminiBaseUrl: geminiBaseUrl.trim(),
    grokBaseUrl: grokBaseUrl.trim(),
    customBaseUrl: customBaseUrl.trim(),
    model,
    ...secretUpdate("openAIApiKey", providerKeys.openai),
    ...secretUpdate("deepSeekApiKey", providerKeys.deepseek),
    ...secretUpdate("qwenApiKey", providerKeys.qwen),
    ...secretUpdate("kimiApiKey", providerKeys.kimi),
    ...secretUpdate("doubaoApiKey", providerKeys.doubao),
    ...secretUpdate("geminiApiKey", providerKeys.gemini),
    ...secretUpdate("grokApiKey", providerKeys.grok),
    ...secretUpdate("customApiKey", providerKeys.custom),
    ...secretUpdate("searchApiKey", searchKey),
  };
}

export function createAppearanceSettingsUpdate(
  settings: SettingsSnapshot,
): SettingsUpdate {
  return createSettingsUpdate(
    EMPTY_PROVIDER_SECRETS,
    EMPTY_SECRET,
    settings.provider,
    settings.qwenBaseUrl,
    settings.kimiBaseUrl,
    settings.doubaoBaseUrl,
    settings.geminiBaseUrl,
    settings.grokBaseUrl,
    settings.customBaseUrl,
    settings.model,
    settings.language,
    settings.theme,
    settings.preferredProjectOpener,
  );
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
  if (provider === "kimi") return settings.kimiApiKeyConfigured;
  if (provider === "doubao") return settings.doubaoApiKeyConfigured;
  if (provider === "gemini") return settings.geminiApiKeyConfigured;
  if (provider === "grok") return settings.grokApiKeyConfigured;
  if (provider === "custom") return settings.customApiKeyConfigured;
  return settings.openAIApiKeyConfigured;
}

function isKnownModel(provider: ModelProviderId, model: string): boolean {
  return providerDetails(provider).models.some((option) => option.value === model);
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

function providerDescription(
  provider: ModelProviderId,
  t: Translate,
): string {
  if (provider === "deepseek") return t("providerDeepSeekDescription");
  if (provider === "qwen") return t("providerQwenDescription");
  if (provider === "kimi") return t("providerKimiDescription");
  if (provider === "doubao") return t("providerDoubaoDescription");
  if (provider === "gemini") return t("providerGeminiDescription");
  if (provider === "grok") return t("providerGrokDescription");
  if (provider === "custom") return t("providerCustomDescription");
  return t("providerOpenAIDescription");
}

function providerLabel(provider: ModelProviderId, t: Translate): string {
  if (provider === "qwen") return t("providerQwenLabel");
  if (provider === "custom") return t("providerCustomLabel");
  return providerDetails(provider).label;
}

function providerKeyDescription(
  provider: ModelProviderId,
  t: Translate,
): string {
  if (provider === "deepseek") return t("providerDeepSeekKeyDescription");
  if (provider === "qwen") return t("providerQwenKeyDescription");
  if (provider === "kimi") return t("providerKimiKeyDescription");
  if (provider === "doubao") return t("providerDoubaoKeyDescription");
  if (provider === "gemini") return t("providerGeminiKeyDescription");
  if (provider === "grok") return t("providerGrokKeyDescription");
  if (provider === "custom") return t("providerCustomKeyDescription");
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
    "kimi-k3": "modelKimiK3",
    "kimi-k2.6": "modelKimiK26",
    "kimi-k2.5": "modelKimiK25",
    "doubao-seed-2-0-pro-260215": "modelDoubaoPro",
    "doubao-seed-2-0-code-preview-260215": "modelDoubaoCode",
    "doubao-seed-2-0-lite-260215": "modelDoubaoLite",
    "gemini-3.1-pro-preview": "modelGeminiPro",
    "gemini-3.6-flash": "modelGeminiFlash",
    "gemini-3.5-flash-lite": "modelGeminiLite",
    "grok-4.5": "modelGrok45",
    "grok-build-0.1": "modelGrokBuild",
    "grok-4.3": "modelGrok43",
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
  if (
    model === "gpt-5.6-sol" ||
    model === "deepseek-v4-pro" ||
    model === "qwen3.7-max" ||
    model === "kimi-k3" ||
    model === "doubao-seed-2-0-pro-260215" ||
    model === "gemini-3.1-pro-preview" ||
    model === "grok-4.5"
  ) {
    return t("performanceFirst");
  }
  if (
    model === "gpt-5.6-terra" ||
    model === "qwen3.7-plus" ||
    model === "kimi-k2.6" ||
    model === "doubao-seed-2-0-lite-260215" ||
    model === "gemini-3.6-flash" ||
    model === "grok-4.3"
  ) {
    return t("balanced");
  }
  if (model === "kimi-k2.5") return t("previousGeneration");
  if (
    model === "doubao-seed-2-0-code-preview-260215" ||
    model === "grok-build-0.1"
  ) {
    return t("codingOptimized");
  }
  if (model === "gemini-3.5-flash-lite") return t("costFirst");
  if (model === "gpt-5.6-luna") return t("costFirst");
  if (model === "gpt-5.4-mini") return t("powerfulMini");
  if (model === "gpt-5-mini") return t("economicalMini");
  if (model === "gpt-4.1-mini") return t("lowLatencyMini");
  if (model === "deepseek-v4-flash") return t("speedFirst");
  return t("lowLatency");
}

function secretUpdate<K extends keyof Pick<
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
