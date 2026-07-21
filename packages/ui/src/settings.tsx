import { useEffect, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

export interface SettingsSnapshot {
  openAIApiKeyConfigured: boolean;
  searchApiKeyConfigured: boolean;
  autoApproveAll: boolean;
}

export interface SettingsUpdate {
  openAIApiKey?: string | null;
  searchApiKey?: string | null;
  autoApproveAll: boolean;
}

export interface SettingsAdapter {
  load(): Promise<SettingsSnapshot>;
  save(update: SettingsUpdate): Promise<SettingsSnapshot>;
}

export interface SecretDraft {
  value: string;
  cleared: boolean;
}

const EMPTY_SECRET: SecretDraft = { value: "", cleared: false };

export function SettingsPage({
  adapter,
  onRuntimeRestart,
}: {
  adapter: SettingsAdapter;
  onRuntimeRestart(): Promise<void>;
}) {
  const [settings, setSettings] = useState<SettingsSnapshot>();
  const [openAIKey, setOpenAIKey] = useState<SecretDraft>(EMPTY_SECRET);
  const [searchKey, setSearchKey] = useState<SecretDraft>(EMPTY_SECRET);
  const [autoApproveAll, setAutoApproveAll] = useState(false);
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
        setAutoApproveAll(snapshot.autoApproveAll);
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [adapter]);

  const dirty = settings
    ? openAIKey.value.trim().length > 0 ||
      openAIKey.cleared ||
      searchKey.value.trim().length > 0 ||
      searchKey.cleared ||
      autoApproveAll !== settings.autoApproveAll
    : false;

  function editSecret(
    setter: (draft: SecretDraft) => void,
    value: string,
  ) {
    setter({ value, cleared: false });
    setSaved(false);
    setError(undefined);
  }

  async function save() {
    if (!settings || !dirty || saving) return;
    setSaving(true);
    setSaved(false);
    setError(undefined);

    try {
      const snapshot = await adapter.save(
        createSettingsUpdate(openAIKey, searchKey, autoApproveAll),
      );
      setSettings(snapshot);
      setOpenAIKey(EMPTY_SECRET);
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
          <p>模型、搜索与工具权限</p>
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
              <section className="settings-section" aria-labelledby="api-title">
                <div className="settings-section-heading">
                  <span className="settings-section-icon">
                    <KeyRound size={16} />
                  </span>
                  <div>
                    <h3 id="api-title">API 密钥</h3>
                    <p>配置模型和联网搜索所需的凭据。</p>
                  </div>
                </div>

                <div className="settings-fields">
                  <SecretField
                    id="openai-api-key"
                    label="OpenAI API Key"
                    description="用于模型请求。通常以 sk- 开头。"
                    configured={settings?.openAIApiKeyConfigured ?? false}
                    draft={openAIKey}
                    onChange={(value) => editSecret(setOpenAIKey, value)}
                    onClear={() => {
                      setOpenAIKey({ value: "", cleared: true });
                      setSaved(false);
                    }}
                  />
                  <SecretField
                    id="search-api-key"
                    label="搜索 API Key"
                    description="用于 Brave Search 联网搜索。"
                    configured={settings?.searchApiKeyConfigured ?? false}
                    draft={searchKey}
                    icon="search"
                    onChange={(value) => editSecret(setSearchKey, value)}
                    onClear={() => {
                      setSearchKey({ value: "", cleared: true });
                      setSaved(false);
                    }}
                  />
                </div>
              </section>

              <section
                className="settings-section"
                aria-labelledby="permissions-title"
              >
                <div className="settings-section-heading">
                  <span className="settings-section-icon">
                    <ShieldCheck size={16} />
                  </span>
                  <div>
                    <h3 id="permissions-title">工具权限</h3>
                    <p>决定工具执行前是否需要逐次确认。</p>
                  </div>
                </div>

                <div className="settings-toggle-row">
                  <div>
                    <strong>自动同意所有询问</strong>
                    <p>跳过工具调用的确认步骤，让任务连续运行。</p>
                  </div>
                  <button
                    type="button"
                    className={`settings-switch ${autoApproveAll ? "on" : ""}`}
                    role="switch"
                    aria-checked={autoApproveAll}
                    aria-label="自动同意所有询问"
                    onClick={() => {
                      setAutoApproveAll((value) => !value);
                      setSaved(false);
                      setError(undefined);
                    }}
                  >
                    <span />
                  </button>
                </div>

                {autoApproveAll && (
                  <div className="settings-warning" role="status">
                    <TriangleAlert size={15} />
                    <p>
                      开启后，本地命令等受保护工具也会直接执行。仅在你信任任务内容和当前工作区时使用。
                    </p>
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

export function createSettingsUpdate(
  openAIKey: SecretDraft,
  searchKey: SecretDraft,
  autoApproveAll: boolean,
): SettingsUpdate {
  return {
    autoApproveAll,
    ...secretUpdate("openAIApiKey", openAIKey),
    ...secretUpdate("searchApiKey", searchKey),
  };
}

function secretUpdate(
  key: "openAIApiKey" | "searchApiKey",
  draft: SecretDraft,
): Pick<SettingsUpdate, typeof key> | Record<string, never> {
  const value = draft.value.trim();
  if (value) return { [key]: value };
  if (draft.cleared) return { [key]: null };
  return {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
