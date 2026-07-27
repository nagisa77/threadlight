import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  LoaderCircle,
  Search,
  Sparkles,
} from "lucide-react";

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
  provider: ModelProviderId;
  openAIApiKeyConfigured: boolean;
  deepSeekApiKeyConfigured: boolean;
  qwenApiKeyConfigured: boolean;
  searchApiKeyConfigured: boolean;
  qwenBaseUrl: string;
  model: string;
}

export interface SettingsUpdate {
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
}: {
  adapter: SettingsAdapter;
  onRuntimeRestart(): Promise<void>;
}) {
  const [settings, setSettings] = useState<SettingsSnapshot>();
  const [providerKeys, setProviderKeys] = useState<ProviderSecretDrafts>(
    EMPTY_PROVIDER_SECRETS,
  );
  const [searchKey, setSearchKey] = useState<SecretDraft>(EMPTY_SECRET);
  const [provider, setProvider] = useState<ModelProviderId>("openai");
  const [qwenBaseUrl, setQwenBaseUrl] = useState(DEFAULT_QWEN_BASE_URL);
  const [model, setModel] = useState<string>(MODEL_OPTIONS[0].value);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void adapter
      .load()
      .then((snapshot) => {
        if (!active) return;
        setSettings(snapshot);
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
      model !== settings.model
    : false;

  function markEdited() {
    setSaved(false);
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
      const snapshot = await adapter.save(
        createSettingsUpdate(
          providerKeys,
          searchKey,
          provider,
          qwenBaseUrl,
          model,
        ),
      );
      setSettings(snapshot);
      setProviderKeys(EMPTY_PROVIDER_SECRETS);
      setSearchKey(EMPTY_SECRET);
      setSaved(true);
      await onRuntimeRestart();
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
          <h1>设置</h1>
          <p>模型服务与搜索</p>
        </div>
      </header>

      <section className="settings-scroll">
        <div className="settings-page">
          <div className="settings-intro">
            <h2>偏好设置</h2>
            <p>密钥会使用系统安全存储加密，并且不会写入项目文件或日志。</p>
          </div>

          {!settings && !error ? (
            <div className="settings-loading">
              <LoaderCircle className="spin" size={16} /> 正在读取设置…
            </div>
          ) : (
            <>
              <section
                className="settings-section"
                aria-labelledby="model-title"
              >
                <div className="settings-section-heading">
                  <span className="settings-section-icon">
                    <Sparkles size={16} />
                  </span>
                  <div>
                    <h3 id="model-title">模型服务</h3>
                    <p>选择服务厂商；可用模型和连接配置会随厂商切换。</p>
                  </div>
                </div>

                <div className="settings-fields">
                  <SelectField
                    id="provider-select"
                    label="服务厂商"
                    description={providerOption.description}
                    value={provider}
                    onChange={(value) => {
                      const nextProvider = value as ModelProviderId;
                      setProvider(nextProvider);
                      setModel(providerDetails(nextProvider).defaultModel);
                      markEdited();
                    }}
                    options={PROVIDER_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                  />
                  <SelectField
                    id="model-select"
                    label="默认模型"
                    description={modelDescription(provider, model)}
                    value={model}
                    onChange={(value) => {
                      setModel(value);
                      markEdited();
                    }}
                    options={[
                      ...(!isKnownModel(provider, model)
                        ? [{ value: model, label: `${model}（当前配置）` }]
                        : []),
                      ...providerOption.models.map((option) => ({
                        value: option.value,
                        label: `${option.label} — ${option.qualifier}`,
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
                    <h3 id="api-title">连接与 API 密钥</h3>
                    <p>配置模型、语音输入和联网搜索所需的凭据。</p>
                  </div>
                </div>

                <div className="settings-fields">
                  <SecretField
                    key={provider}
                    id={`${provider}-api-key`}
                    label={providerOption.keyLabel}
                    description={providerOption.keyDescription}
                    configured={providerKeyConfigured(settings, provider)}
                    draft={providerKey}
                    onChange={(value) => editProviderSecret(provider, value)}
                    onClear={() => clearProviderSecret(provider)}
                  />
                  {provider !== "openai" && (
                    <SecretField
                      id="voice-openai-api-key"
                      label="OpenAI API Key（语音输入）"
                      description={`仅用于把录音转成文字；当前对话仍使用 ${providerOption.label}。`}
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
                      description="默认连接北京地域；其他地域或业务空间请填写对应兼容接口地址。"
                      value={qwenBaseUrl}
                      onChange={(value) => {
                        setQwenBaseUrl(value);
                        markEdited();
                      }}
                    />
                  )}
                  <SecretField
                    id="search-api-key"
                    label="搜索 API Key"
                    description="用于 Brave Search 联网搜索。"
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
                  <Check size={13} /> 已保存并重新连接
                </span>
              ) : (
                <span>保存后会重启当前项目运行时，并恢复当前任务。</span>
              )}
            </div>
            <button
              type="button"
              className="settings-save-button pressable"
              disabled={!dirty || saving || !settings}
              onClick={() => void save()}
            >
              {saving && <LoaderCircle className="spin" size={14} />}
              {saving ? "正在保存…" : "保存更改"}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function SelectField({
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
  options: readonly { value: string; label: string }[];
  onChange(value: string): void;
}) {
  return (
    <div className="settings-field model-field">
      <div className="settings-field-label">
        <div>
          <label htmlFor={id}>{label}</label>
          <p>{description}</p>
        </div>
      </div>
      <div className="model-select-wrap">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </div>
    </div>
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
          <span className="key-status pending">待移除</span>
        ) : active ? (
          <span className="key-status">已配置</span>
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
          placeholder={active ? "输入新密钥以替换" : "粘贴 API Key"}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="secret-action pressable"
          aria-label={visible ? `隐藏 ${label}` : `显示 ${label}`}
          title={visible ? "隐藏" : "显示"}
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
            清除
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
): SettingsUpdate {
  return {
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

function modelDescription(provider: ModelProviderId, model: string): string {
  return (
    providerDetails(provider).models.find((option) => option.value === model)
      ?.description ?? "当前模型由外部配置提供；选择其他模型后将覆盖它。"
  );
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
