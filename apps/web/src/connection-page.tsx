import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Languages,
  LoaderCircle,
  MonitorCog,
  Radio,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  defineMessageCatalog,
  I18nProvider,
  isLanguage,
  LANGUAGE_OPTIONS,
  messagesFor,
  type Language,
} from "@threadlight/ui/i18n";
import { isThemePreference, ThemeProvider } from "@threadlight/ui/theme";
import {
  hostNameForEndpoint,
  normalizeEndpoint,
  type HostRecord,
  type HostRecordInput,
} from "./host-store.js";

type ThemePreference = "system" | "light" | "dark";

interface ConnectionCopy {
  preferences: string;
  language: string;
  theme: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;
  title: string;
  description: string;
  eyebrow: string;
  savedHosts: string;
  hostName: string;
  hostNamePlaceholder: string;
  newHost: string;
  editHost: string;
  newHostLink: string;
  endpoint: string;
  token: string;
  showToken: string;
  hideToken: string;
  connecting: string;
  connect: string;
  reconnect: string;
  saveChanges: string;
  saved: string;
  edit: string;
  delete: string;
  deleteConfirm: string;
  tokenNotice: string;
  httpsError: string;
  networkError: string;
  endpointSchemeError: string;
  endpointFormatError: string;
}

const CONNECTION_COPY = defineMessageCatalog<ConnectionCopy>({
  en: {
    preferences: "Connection page preferences",
    language: "Language",
    theme: "Theme",
    themeSystem: "System",
    themeLight: "Light",
    themeDark: "Dark",
    title: "Connect to a remote Host",
    description:
      "The web client connects to an already-running Threadlight Host. It does not start a local Host in your browser or on the deployment server.",
    eyebrow: "WEB CLIENT",
    savedHosts: "Saved hosts",
    hostName: "Name (optional)",
    hostNamePlaceholder: "Production",
    newHost: "Connect a new Host",
    editHost: "Edit saved Host",
    newHostLink: "New Host",
    endpoint: "Host address",
    token: "Access token",
    showToken: "Show token",
    hideToken: "Hide token",
    connecting: "Connecting…",
    connect: "Connect to Host",
    reconnect: "Reconnect",
    saveChanges: "Save changes",
    saved: "Saved",
    edit: "Edit",
    delete: "Delete",
    deleteConfirm: "Delete?",
    tokenNotice:
      "Hosts and tokens are saved in this browser so you can reconnect quickly. Avoid saving sensitive hosts on shared devices.",
    httpsError:
      "An HTTPS page cannot connect to an HTTP Host. Configure TLS for the Host.",
    networkError:
      "Unable to connect to the Host. Check the address, TLS, token, and the Host's --origin configuration.",
    endpointSchemeError:
      "Enter a full address with http:// or https://, for example https://host.example.com.",
    endpointFormatError: "That address is not valid. Check the host and port.",
  },
  "zh-CN": {
    preferences: "连接页面偏好设置",
    language: "语言",
    theme: "主题",
    themeSystem: "系统",
    themeLight: "浅色",
    themeDark: "深色",
    title: "连接远端 Host",
    description:
      "Web 端只连接已经运行的 Threadlight Host，不会在浏览器或部署服务器上启动本地 Host。",
    eyebrow: "WEB 客户端",
    savedHosts: "已保存的主机",
    hostName: "名称（可选）",
    hostNamePlaceholder: "生产环境",
    newHost: "连接新的 Host",
    editHost: "编辑已保存的主机",
    newHostLink: "连接新主机",
    endpoint: "Host 地址",
    token: "访问 Token",
    showToken: "显示 Token",
    hideToken: "隐藏 Token",
    connecting: "正在连接…",
    connect: "连接 Host",
    reconnect: "重新连接",
    saveChanges: "保存更改",
    saved: "已保存",
    edit: "编辑",
    delete: "删除",
    deleteConfirm: "确认删除？",
    tokenNotice:
      "主机与 Token 会保存在浏览器中，以便快速重连；请勿在共享设备上保存敏感主机。",
    httpsError: "HTTPS 页面不能连接 HTTP Host，请为 Host 配置 TLS。",
    networkError:
      "无法连接 Host。请检查地址、TLS、Token，以及 Host 的 --origin 配置。",
    endpointSchemeError:
      "请输入带协议（http:// 或 https://）的完整地址，例如 https://host.example.com。",
    endpointFormatError: "地址格式不正确，请检查主机与端口。",
  },
  "zh-TW": {
    preferences: "連線頁面偏好設定",
    language: "語言",
    theme: "主題",
    themeSystem: "系統",
    themeLight: "淺色",
    themeDark: "深色",
    title: "連線遠端 Host",
    description:
      "Web 端只會連線至已在執行的 Threadlight Host，不會在瀏覽器或部署伺服器上啟動本機 Host。",
    eyebrow: "WEB 用戶端",
    savedHosts: "已儲存的主機",
    hostName: "名稱（選填）",
    hostNamePlaceholder: "正式環境",
    newHost: "連線新的 Host",
    editHost: "編輯已儲存的主機",
    newHostLink: "連線新主機",
    endpoint: "Host 位址",
    token: "存取 Token",
    showToken: "顯示 Token",
    hideToken: "隱藏 Token",
    connecting: "連線中…",
    connect: "連線 Host",
    reconnect: "重新連線",
    saveChanges: "儲存變更",
    saved: "已儲存",
    edit: "編輯",
    delete: "刪除",
    deleteConfirm: "確認刪除？",
    tokenNotice:
      "主機與 Token 會儲存在瀏覽器中，以便快速重連；請勿在共用裝置上儲存敏感主機。",
    httpsError: "HTTPS 頁面無法連線 HTTP Host，請為 Host 設定 TLS。",
    networkError:
      "無法連線 Host。請檢查位址、TLS、Token，以及 Host 的 --origin 設定。",
    endpointSchemeError:
      "請輸入帶協定（http:// 或 https://）的完整位址，例如 https://host.example.com。",
    endpointFormatError: "位址格式不正確，請檢查主機與連接埠。",
  },
  ja: {
    preferences: "接続ページの表示設定",
    language: "言語",
    theme: "テーマ",
    themeSystem: "システム",
    themeLight: "ライト",
    themeDark: "ダーク",
    title: "リモート Host に接続",
    description:
      "Web クライアントは、すでに実行中の Threadlight Host に接続します。ブラウザーやデプロイ先のサーバーでローカル Host を起動することはありません。",
    eyebrow: "WEB クライアント",
    savedHosts: "保存済みホスト",
    hostName: "名前（任意）",
    hostNamePlaceholder: "本番環境",
    newHost: "新しい Host に接続",
    editHost: "保存済みホストを編集",
    newHostLink: "新しいホスト",
    endpoint: "Host アドレス",
    token: "アクセストークン",
    showToken: "トークンを表示",
    hideToken: "トークンを隠す",
    connecting: "接続中…",
    connect: "Host に接続",
    reconnect: "再接続",
    saveChanges: "変更を保存",
    saved: "保存しました",
    edit: "編集",
    delete: "削除",
    deleteConfirm: "削除しますか？",
    tokenNotice:
      "ホストとトークンはブラウザーに保存され、素早く再接続できます。共有デバイスで機密ホストを保存しないでください。",
    httpsError:
      "HTTPS ページから HTTP Host には接続できません。Host に TLS を設定してください。",
    networkError:
      "Host に接続できません。アドレス、TLS、トークン、Host の --origin 設定を確認してください。",
    endpointSchemeError:
      "http:// または https:// を含む完全なアドレスを入力してください（例: https://host.example.com）。",
    endpointFormatError:
      "アドレスの形式が正しくありません。ホストとポートを確認してください。",
  },
  ko: {
    preferences: "연결 페이지 환경설정",
    language: "언어",
    theme: "테마",
    themeSystem: "시스템",
    themeLight: "라이트",
    themeDark: "다크",
    title: "원격 Host에 연결",
    description:
      "웹 클라이언트는 이미 실행 중인 Threadlight Host에 연결합니다. 브라우저나 배포 서버에서 로컬 Host를 시작하지 않습니다.",
    eyebrow: "WEB 클라이언트",
    savedHosts: "저장된 호스트",
    hostName: "이름(선택)",
    hostNamePlaceholder: "프로덕션",
    newHost: "새 Host에 연결",
    editHost: "저장된 Host 편집",
    newHostLink: "새 호스트",
    endpoint: "Host 주소",
    token: "액세스 토큰",
    showToken: "토큰 표시",
    hideToken: "토큰 숨기기",
    connecting: "연결 중…",
    connect: "Host에 연결",
    reconnect: "다시 연결",
    saveChanges: "변경 사항 저장",
    saved: "저장됨",
    edit: "편집",
    delete: "삭제",
    deleteConfirm: "삭제할까요?",
    tokenNotice:
      "호스트와 토큰이 브라우저에 저장되어 빠르게 다시 연결할 수 있습니다. 공유 기기에서는 민감한 호스트를 저장하지 마세요.",
    httpsError:
      "HTTPS 페이지에서는 HTTP Host에 연결할 수 없습니다. Host에 TLS를 설정하세요.",
    networkError:
      "Host에 연결할 수 없습니다. 주소, TLS, 토큰, Host의 --origin 설정을 확인하세요.",
    endpointSchemeError:
      "http:// 또는 https:// 를 포함한 전체 주소를 입력하세요. 예: https://host.example.com",
    endpointFormatError:
      "주소 형식이 올바르지 않습니다. 호스트와 포트를 확인하세요.",
  },
});

const PREF_STORAGE_KEY = "threadlight:web:connect-prefs";

interface ConnectPrefs {
  language: Language;
  theme: ThemePreference;
}

interface BrowserLanguageSource {
  readonly languages?: readonly string[];
  readonly language?: string;
}

export function browserLanguage(source?: BrowserLanguageSource): Language {
  const candidates = [...(source?.languages ?? [])];
  if (source?.language && !candidates.includes(source.language)) {
    candidates.push(source.language);
  }

  for (const candidate of candidates) {
    const parts = candidate
      .trim()
      .replaceAll("_", "-")
      .toLowerCase()
      .split("-")
      .filter(Boolean);
    const base = parts[0];
    if (base === "zh") {
      return parts.some((part) => ["hant", "tw", "hk", "mo"].includes(part))
        ? "zh-TW"
        : "zh-CN";
    }
    if (base === "en" || base === "ja" || base === "ko") return base;
  }

  return "en";
}

export function initialConnectionLanguage(
  storedLanguage: unknown,
  source?: BrowserLanguageSource,
): Language {
  return isLanguage(storedLanguage) ? storedLanguage : browserLanguage(source);
}

export function loadConnectPrefs(): ConnectPrefs {
  const source = typeof navigator === "undefined" ? undefined : navigator;
  const fallback: ConnectPrefs = {
    language: initialConnectionLanguage(undefined, source),
    theme: "system",
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREF_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const entry = parsed as Record<string, unknown>;
    return {
      language: initialConnectionLanguage(entry.language, source),
      theme: isThemePreference(entry.theme) ? entry.theme : fallback.theme,
    };
  } catch {
    return fallback;
  }
}

function persistConnectPrefs(prefs: ConnectPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be unavailable in private or locked-down browsing modes.
  }
}

export function RemoteConnectionPage({
  initialEndpoint,
  initialToken,
  autoConnect,
  savedHosts = [],
  onConnect,
  onUpsertHost,
  onDeleteHost,
  onLanguageChange,
  initialErrorReason,
}: {
  initialEndpoint: string;
  initialToken: string;
  autoConnect: boolean;
  savedHosts?: HostRecord[];
  onConnect(endpoint: string, token: string, name?: string): Promise<void>;
  onUpsertHost?(host: HostRecordInput): void;
  onDeleteHost?(id: string): void;
  onLanguageChange?(language: Language): void;
  initialErrorReason?: unknown;
}) {
  const [initialPrefs] = useState<ConnectPrefs>(loadConnectPrefs);
  const [language, setLanguage] = useState<Language>(initialPrefs.language);
  const [theme, setTheme] = useState<ThemePreference>(initialPrefs.theme);

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    onLanguageChange?.(nextLanguage);
  }

  useEffect(() => {
    document.documentElement.lang = language;
    persistConnectPrefs({ language, theme });
  }, [language, theme]);

  return (
    <ThemeProvider preference={theme}>
      <I18nProvider language={language}>
        <RemoteConnectionContent
          initialEndpoint={initialEndpoint}
          initialToken={initialToken}
          autoConnect={autoConnect}
          savedHosts={savedHosts}
          onConnect={onConnect}
          onUpsertHost={onUpsertHost}
          onDeleteHost={onDeleteHost}
          initialErrorReason={initialErrorReason}
          language={language}
          theme={theme}
          onLanguageChange={changeLanguage}
          onThemeChange={setTheme}
        />
      </I18nProvider>
    </ThemeProvider>
  );
}

function RemoteConnectionContent({
  initialEndpoint,
  initialToken,
  autoConnect,
  savedHosts,
  onConnect,
  onUpsertHost,
  onDeleteHost,
  initialErrorReason,
  language,
  theme,
  onLanguageChange,
  onThemeChange,
}: {
  initialEndpoint: string;
  initialToken: string;
  autoConnect: boolean;
  savedHosts: HostRecord[];
  onConnect(endpoint: string, token: string, name?: string): Promise<void>;
  onUpsertHost?(host: HostRecordInput): void;
  onDeleteHost?(id: string): void;
  initialErrorReason?: unknown;
  language: Language;
  theme: ThemePreference;
  onLanguageChange(language: Language): void;
  onThemeChange(theme: ThemePreference): void;
}) {
  const [preselected] = useState(() =>
    initialSelectedHost(savedHosts, initialEndpoint),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    () => preselected?.id ?? null,
  );
  const [hostName, setHostName] = useState(() => preselected?.name ?? "");
  const [endpoint, setEndpoint] = useState(
    initialEndpoint || preselected?.endpoint || "",
  );
  const [token, setToken] = useState(initialToken || preselected?.token || "");
  const [showToken, setShowToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [errorReason, setErrorReason] = useState<unknown>(initialErrorReason);
  const [endpointError, setEndpointError] = useState<string>();
  const [savedFlash, setSavedFlash] = useState(false);
  const [armedId, setArmedId] = useState<string | null>(null);
  const attemptedAutoConnect = useRef(false);
  const armedTimer = useRef<number | undefined>(undefined);
  const savedTimer = useRef<number | undefined>(undefined);
  const endpointInputRef = useRef<HTMLInputElement>(null);
  const copy = messagesFor(CONNECTION_COPY, language);

  const selectedHost = savedHosts.find((host) => host.id === selectedId);
  const editingSaved = selectedHost !== undefined;

  useEffect(() => {
    if (!autoConnect || attemptedAutoConnect.current) return;
    attemptedAutoConnect.current = true;
    void submitCredentials();
  }, [autoConnect]);

  useEffect(
    () => () => {
      window.clearTimeout(armedTimer.current);
      window.clearTimeout(savedTimer.current);
    },
    [],
  );

  function endpointValidationError(raw: string): string | undefined {
    const trimmed = raw.trim();
    if (!trimmed) return undefined; // The submit button is disabled for empty input.
    if (!/^https?:\/\//i.test(trimmed)) return copy.endpointSchemeError;
    try {
      new URL(trimmed);
    } catch {
      return copy.endpointFormatError;
    }
    return undefined;
  }

  function selectHost(host: HostRecord) {
    setSelectedId(host.id);
    setHostName(host.name);
    setEndpoint(host.endpoint);
    setToken(host.token);
    setErrorReason(undefined);
    setEndpointError(undefined);
  }

  function resetToNewHost() {
    setSelectedId(null);
    setHostName("");
    setEndpoint("");
    setToken("");
    setErrorReason(undefined);
    setEndpointError(undefined);
    setArmedId(null);
    endpointInputRef.current?.focus();
  }

  function armDelete(id: string) {
    setArmedId(id);
    window.clearTimeout(armedTimer.current);
    armedTimer.current = window.setTimeout(() => setArmedId(null), 2400);
  }

  function handleDelete(id: string) {
    if (armedId !== id) {
      armDelete(id);
      return;
    }
    window.clearTimeout(armedTimer.current);
    setArmedId(null);
    onDeleteHost?.(id);
    if (selectedId === id) resetToNewHost();
  }

  async function submitCredentials(nameOverride?: string) {
    if (connecting) return;
    const validationError = endpointValidationError(endpoint);
    if (validationError) {
      setEndpointError(validationError);
      return;
    }
    setConnecting(true);
    setErrorReason(undefined);
    setEndpointError(undefined);
    const normalized = normalizeEndpoint(endpoint);
    try {
      await onConnect(
        normalized,
        token,
        nameOverride?.trim() || hostName.trim() || undefined,
      );
      // Only persist the record (and its "last connected" ordering) after the
      // connection actually succeeds, so failed attempts do not rewrite history.
      if (selectedHost) {
        onUpsertHost?.({
          id: selectedHost.id,
          name: hostName,
          endpoint: normalized,
          token,
        });
      }
    } catch (reason) {
      setErrorReason(() => reason);
    } finally {
      setConnecting(false);
    }
  }

  function saveChanges() {
    if (!selectedHost || savedFlash) return;
    const validationError = endpointValidationError(endpoint);
    if (validationError) {
      setEndpointError(validationError);
      return;
    }
    onUpsertHost?.({
      id: selectedHost.id,
      name: hostName,
      endpoint: normalizeEndpoint(endpoint),
      token,
    });
    setSavedFlash(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSavedFlash(false), 1200);
  }

  async function quickConnect(host: HostRecord) {
    if (connecting) return;
    selectHost(host);
    setConnecting(true);
    setErrorReason(undefined);
    try {
      await onConnect(host.endpoint, host.token, host.name);
    } catch (reason) {
      setErrorReason(() => reason);
    } finally {
      setConnecting(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitCredentials();
  }

  return (
    <main className="web-connect-shell">
      <div className="web-connect-preferences" aria-label={copy.preferences}>
        <label className="web-connect-preference">
          <Languages size={15} aria-hidden="true" />
          <span className="web-visually-hidden">{copy.language}</span>
          <select
            aria-label={copy.language}
            title={copy.language}
            value={language}
            onChange={(event) => {
              if (isLanguage(event.target.value)) {
                onLanguageChange(event.target.value);
              }
            }}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>

        <label className="web-connect-preference">
          <MonitorCog size={15} aria-hidden="true" />
          <span className="web-visually-hidden">{copy.theme}</span>
          <select
            aria-label={copy.theme}
            title={copy.theme}
            value={theme}
            onChange={(event) => {
              if (isThemePreference(event.target.value)) {
                onThemeChange(event.target.value);
              }
            }}
          >
            <option value="system">{copy.themeSystem}</option>
            <option value="light">{copy.themeLight}</option>
            <option value="dark">{copy.themeDark}</option>
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
      </div>

      <section className="web-connect-card" aria-labelledby="connect-title">
        <aside className="web-connect-intro">
          <div className="web-connect-brand">
            <span className="web-connect-mark" aria-hidden="true">
              <Radio size={18} />
            </span>
            <span>Threadlight</span>
          </div>

          <div className="web-connect-copy">
            <p className="web-connect-eyebrow">{copy.eyebrow}</p>
            <h1 id="connect-title">{copy.title}</h1>
            <p>{copy.description}</p>
          </div>

          <div className="web-connect-security">
            <ShieldCheck size={14} aria-hidden="true" />
            <span>{copy.tokenNotice}</span>
          </div>
        </aside>

        <div className="web-connect-content">
          {savedHosts.length > 0 && (
            <div className="web-connect-hosts">
              <h2 className="web-connect-section-title">{copy.savedHosts}</h2>
              <ul className="web-host-list">
                {savedHosts.map((host) => {
                  const isSelected = host.id === selectedId;
                  return (
                    <li
                      key={host.id}
                      className={`web-host-row${isSelected ? " selected" : ""}`}
                    >
                      <button
                        type="button"
                        className="web-host-select pressable"
                        onClick={() => selectHost(host)}
                      >
                        <span className="web-host-name">
                          {host.name || hostNameForEndpoint(host.endpoint)}
                        </span>
                        <span className="web-host-endpoint">
                          {host.endpoint}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="web-host-connect pressable"
                        disabled={connecting}
                        onClick={() => void quickConnect(host)}
                      >
                        <Radio size={12} aria-hidden="true" />
                        <span>{copy.reconnect}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="web-connect-form-section">
            <div className="web-connect-form-heading">
              <h2>{editingSaved ? copy.editHost : copy.newHost}</h2>
              {editingSaved && (
                <button
                  type="button"
                  className="web-connect-new-link pressable"
                  onClick={resetToNewHost}
                >
                  {copy.newHostLink}
                </button>
              )}
            </div>

            <form
              className="web-connect-form"
              onSubmit={submit}
              aria-busy={connecting}
            >
              <div className="web-connect-fields">
                <label>
                  <span>{copy.hostName}</span>
                  <input
                    type="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={copy.hostNamePlaceholder}
                    value={hostName}
                    onChange={(event) => setHostName(event.target.value)}
                    disabled={connecting}
                  />
                </label>

                <label>
                  <span>{copy.endpoint}</span>
                  <input
                    ref={endpointInputRef}
                    type="text"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="https://host.example.com"
                    value={endpoint}
                    onChange={(event) => {
                      setEndpoint(event.target.value);
                      setEndpointError(undefined);
                    }}
                    disabled={connecting}
                    aria-invalid={endpointError ? true : undefined}
                    autoFocus={!endpoint}
                  />
                  {endpointError && (
                    <span className="web-connect-field-error" role="alert">
                      {endpointError}
                    </span>
                  )}
                </label>

                <label className="web-connect-token-label">
                  <span>{copy.token}</span>
                  <span className="web-token-field">
                    <input
                      type={showToken ? "text" : "password"}
                      autoComplete="off"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      disabled={connecting}
                      autoFocus={Boolean(endpoint && !token)}
                    />
                    <button
                      type="button"
                      className="web-token-toggle pressable"
                      aria-label={showToken ? copy.hideToken : copy.showToken}
                      title={showToken ? copy.hideToken : copy.showToken}
                      onClick={() => setShowToken((visible) => !visible)}
                    >
                      {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </span>
                </label>
              </div>

              {errorReason !== undefined && (
                <div className="web-connect-error" role="alert">
                  {connectionError(errorReason, copy)}
                </div>
              )}

              <div className="web-connect-actions">
                {editingSaved && (
                  <>
                    <button
                      type="button"
                      className={`web-connect-delete pressable${
                        armedId === selectedHost.id ? " armed" : ""
                      }`}
                      aria-label={
                        armedId === selectedHost.id
                          ? copy.deleteConfirm
                          : copy.delete
                      }
                      title={
                        armedId === selectedHost.id
                          ? copy.deleteConfirm
                          : copy.delete
                      }
                      onClick={() => handleDelete(selectedHost.id)}
                    >
                      <span
                        className="web-connect-delete-fill"
                        aria-hidden="true"
                      />
                      {armedId === selectedHost.id ? (
                        <span className="web-connect-delete-label">
                          {copy.deleteConfirm}
                        </span>
                      ) : (
                        <Trash2 size={15} aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="web-connect-secondary pressable"
                      data-saved={savedFlash || undefined}
                      onClick={saveChanges}
                      disabled={!endpoint.trim() || !token}
                    >
                      {savedFlash ? (
                        <>
                          <Check size={15} aria-hidden="true" />
                          {copy.saved}
                        </>
                      ) : (
                        copy.saveChanges
                      )}
                    </button>
                  </>
                )}
                <button
                  type="submit"
                  className="web-connect-submit pressable"
                  disabled={connecting || !endpoint.trim() || !token}
                >
                  {connecting && (
                    <LoaderCircle
                      className="spin"
                      size={15}
                      aria-hidden="true"
                    />
                  )}
                  {connecting ? copy.connecting : copy.connect}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}

function initialSelectedHost(
  savedHosts: HostRecord[],
  initialEndpoint: string,
): HostRecord | undefined {
  const normalized = normalizeEndpoint(initialEndpoint).toLowerCase();
  if (normalized) {
    return savedHosts.find(
      (host) => normalizeEndpoint(host.endpoint).toLowerCase() === normalized,
    );
  }
  return savedHosts[0];
}

export function connectionPageCopy(language: Language): ConnectionCopy {
  return messagesFor(CONNECTION_COPY, language);
}

export function connectionError(
  reason: unknown,
  copy: ConnectionCopy = CONNECTION_COPY.en,
): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    /^http:\/\//i.test(message)
  ) {
    return copy.httpsError;
  }
  if (message === "Failed to fetch" || /network/i.test(message)) {
    return copy.networkError;
  }
  return message;
}
