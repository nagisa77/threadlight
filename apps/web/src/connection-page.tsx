import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ChevronDown,
  Eye,
  EyeOff,
  Languages,
  MonitorCog,
  Pencil,
  Radio,
  Server,
  ServerCog,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  I18nProvider,
  isLanguage,
  LANGUAGE_OPTIONS,
  type Language,
} from "@threadlight/ui/i18n";
import {
  isThemePreference,
  ThemeProvider,
} from "@threadlight/ui/theme";
import {
  ActionPopover,
  anchoredPopoverPosition,
  type PopoverPosition,
} from "@threadlight/ui/popover";
import {
  deleteSavedHost,
  updateSavedHost,
  type SavedHost,
} from "./saved-hosts.js";

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
  savedHosts: string;
  savedHostsPlaceholder: string;
  manageHosts: string;
  hostName: string;
  saveHost: string;
  cancel: string;
  deleteHost: string;
  deleteHostConfirm: string;
  editHost: string;
  emptyHosts: string;
  endpoint: string;
  token: string;
  showToken: string;
  hideToken: string;
  connecting: string;
  connect: string;
  tokenNotice: string;
  httpsError: string;
  networkError: string;
}

const CONNECTION_COPY: Record<Language, ConnectionCopy> = {
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
    savedHosts: "Saved hosts",
    savedHostsPlaceholder: "Add a new host…",
    manageHosts: "Manage saved hosts",
    hostName: "Name (optional)",
    saveHost: "Save",
    cancel: "Cancel",
    deleteHost: "Delete",
    deleteHostConfirm: "Delete host?",
    editHost: "Edit",
    emptyHosts: "No saved hosts yet.",
    endpoint: "Host address",
    token: "Access token",
    showToken: "Show token",
    hideToken: "Hide token",
    connecting: "Connecting…",
    connect: "Connect to Host",
    tokenNotice:
      "Hosts and tokens are remembered in this browser to prefill your next connection. Only use Threadlight on devices you trust.",
    httpsError: "An HTTPS page cannot connect to an HTTP Host. Configure TLS for the Host.",
    networkError:
      "Unable to connect to the Host. Check the address, TLS, token, and the Host's --origin configuration.",
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
    savedHosts: "已连接的主机",
    savedHostsPlaceholder: "添加新 Host…",
    manageHosts: "管理已连接的主机",
    hostName: "名称（可选）",
    saveHost: "保存",
    cancel: "取消",
    deleteHost: "删除",
    deleteHostConfirm: "确认删除？",
    editHost: "编辑",
    emptyHosts: "还没有保存的 Host。",
    endpoint: "Host 地址",
    token: "访问 Token",
    showToken: "显示 Token",
    hideToken: "隐藏 Token",
    connecting: "正在连接…",
    connect: "连接 Host",
    tokenNotice:
      "Host 与 Token 会保存在浏览器本地记录中，用于下次连接自动填入。请只在可信设备上使用。",
    httpsError: "HTTPS 页面不能连接 HTTP Host，请为 Host 配置 TLS。",
    networkError:
      "无法连接 Host。请检查地址、TLS、Token，以及 Host 的 --origin 配置。",
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
    savedHosts: "已連線的主機",
    savedHostsPlaceholder: "新增 Host…",
    manageHosts: "管理已連線的主機",
    hostName: "名稱（選填）",
    saveHost: "儲存",
    cancel: "取消",
    deleteHost: "刪除",
    deleteHostConfirm: "確認刪除？",
    editHost: "編輯",
    emptyHosts: "尚未儲存任何 Host。",
    endpoint: "Host 位址",
    token: "存取 Token",
    showToken: "顯示 Token",
    hideToken: "隱藏 Token",
    connecting: "連線中…",
    connect: "連線 Host",
    tokenNotice:
      "Host 與 Token 會儲存在瀏覽器本機記錄中，用於下次連線自動填入。請只在可信賴的裝置上使用。",
    httpsError: "HTTPS 頁面無法連線 HTTP Host，請為 Host 設定 TLS。",
    networkError:
      "無法連線 Host。請檢查位址、TLS、Token，以及 Host 的 --origin 設定。",
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
    savedHosts: "接続済みの Host",
    savedHostsPlaceholder: "新しい Host を追加…",
    manageHosts: "接続済みの Host を管理",
    hostName: "名前（任意）",
    saveHost: "保存",
    cancel: "キャンセル",
    deleteHost: "削除",
    deleteHostConfirm: "削除しますか？",
    editHost: "編集",
    emptyHosts: "保存された Host はありません。",
    endpoint: "Host アドレス",
    token: "アクセストークン",
    showToken: "トークンを表示",
    hideToken: "トークンを隠す",
    connecting: "接続中…",
    connect: "Host に接続",
    tokenNotice:
      "次回接続時の自動入力のため、Host とトークンはこのブラウザーに保存されます。信頼できる端末でのみ使用してください。",
    httpsError: "HTTPS ページから HTTP Host には接続できません。Host に TLS を設定してください。",
    networkError:
      "Host に接続できません。アドレス、TLS、トークン、Host の --origin 設定を確認してください。",
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
    savedHosts: "연결된 Host",
    savedHostsPlaceholder: "새 Host 추가…",
    manageHosts: "저장된 Host 관리",
    hostName: "이름 (선택)",
    saveHost: "저장",
    cancel: "취소",
    deleteHost: "삭제",
    deleteHostConfirm: "삭제할까요?",
    editHost: "편집",
    emptyHosts: "저장된 Host가 없습니다.",
    endpoint: "Host 주소",
    token: "액세스 토큰",
    showToken: "토큰 표시",
    hideToken: "토큰 숨기기",
    connecting: "연결 중…",
    connect: "Host에 연결",
    tokenNotice:
      "다음 연결 시 자동으로 입력되도록 Host와 토큰이 브라우저에 저장됩니다. 신뢰할 수 있는 기기에서만 사용하세요.",
    httpsError: "HTTPS 페이지에서는 HTTP Host에 연결할 수 없습니다. Host에 TLS를 설정하세요.",
    networkError:
      "Host에 연결할 수 없습니다. 주소, TLS, 토큰, Host의 --origin 설정을 확인하세요.",
  },
};

export function RemoteConnectionPage({
  initialEndpoint,
  initialToken,
  autoConnect,
  onConnect,
  initialHosts = [],
  onHostsChange,
}: {
  initialEndpoint: string;
  initialToken: string;
  autoConnect: boolean;
  onConnect(endpoint: string, token: string): Promise<void>;
  initialHosts?: SavedHost[];
  onHostsChange?(hosts: SavedHost[]): void;
}) {
  const [language, setLanguage] = useState<Language>("en");
  const [theme, setTheme] = useState<ThemePreference>("system");

  return (
    <ThemeProvider preference={theme}>
      <I18nProvider language={language}>
        <RemoteConnectionContent
          initialEndpoint={initialEndpoint}
          initialToken={initialToken}
          autoConnect={autoConnect}
          onConnect={onConnect}
          initialHosts={initialHosts}
          onHostsChange={onHostsChange}
          language={language}
          theme={theme}
          onLanguageChange={setLanguage}
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
  onConnect,
  initialHosts,
  onHostsChange,
  language,
  theme,
  onLanguageChange,
  onThemeChange,
}: {
  initialEndpoint: string;
  initialToken: string;
  autoConnect: boolean;
  onConnect(endpoint: string, token: string): Promise<void>;
  initialHosts: SavedHost[];
  onHostsChange?(hosts: SavedHost[]): void;
  language: Language;
  theme: ThemePreference;
  onLanguageChange(language: Language): void;
  onThemeChange(theme: ThemePreference): void;
}) {
  const [endpoint, setEndpoint] = useState(initialEndpoint);
  const [token, setToken] = useState(initialToken);
  const [showToken, setShowToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [errorReason, setErrorReason] = useState<unknown>();
  const attemptedAutoConnect = useRef(false);
  const copy = CONNECTION_COPY[language];

  const [hosts, setHosts] = useState(initialHosts);
  const [selectedHostId, setSelectedHostId] = useState(() =>
    initialHosts.find((host) => host.endpoint === initialEndpoint)?.id ?? "",
  );
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerPosition, setManagerPosition] =
    useState<PopoverPosition | undefined>(undefined);
  const [editDraft, setEditDraft] = useState<{
    id: string;
    name: string;
    endpoint: string;
    token: string;
  }>();
  const [showEditToken, setShowEditToken] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>();
  const [editDeleteConfirm, setEditDeleteConfirm] = useState(false);
  const manageButtonRef = useRef<HTMLButtonElement>(null);
  const editNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoConnect || attemptedAutoConnect.current) return;
    attemptedAutoConnect.current = true;
    void submitCredentials();
  }, [autoConnect]);

  async function submitCredentials() {
    if (connecting) return;
    setConnecting(true);
    setErrorReason(undefined);
    try {
      await onConnect(endpoint.trim(), token);
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

  function commitHosts(next: SavedHost[]) {
    setHosts(next);
    onHostsChange?.(next);
  }

  function pickHost(hostId: string) {
    setSelectedHostId(hostId);
    const host = hosts.find((entry) => entry.id === hostId);
    if (host) {
      setEndpoint(host.endpoint);
      setToken(host.token);
    }
  }

  function openManager() {
    if (!manageButtonRef.current) return;
    setManagerPosition(
      anchoredPopoverPosition(
        manageButtonRef.current.getBoundingClientRect(),
        { width: 340, height: 360 },
      ),
    );
    setManagerOpen(true);
  }

  function closeManager() {
    setManagerOpen(false);
    setEditDraft(undefined);
    setConfirmDeleteId(undefined);
    setEditDeleteConfirm(false);
  }

  function startEdit(host: SavedHost) {
    setEditDraft({
      id: host.id,
      name: host.name,
      endpoint: host.endpoint,
      token: host.token,
    });
    setShowEditToken(false);
    setConfirmDeleteId(undefined);
    setEditDeleteConfirm(false);
  }

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editDraft) return;
    const next = updateSavedHost(hosts, editDraft.id, {
      name: editDraft.name,
      endpoint: editDraft.endpoint,
      token: editDraft.token,
    });
    commitHosts(next);
    const saved = next.find((host) => host.id === editDraft.id);
    if (saved) {
      setEndpoint(saved.endpoint);
      setToken(saved.token);
      setSelectedHostId(saved.id);
    }
    setEditDraft(undefined);
    setEditDeleteConfirm(false);
  }

  function removeHost(hostId: string) {
    commitHosts(deleteSavedHost(hosts, hostId));
    if (selectedHostId === hostId) {
      setSelectedHostId("");
      setConfirmDeleteId(undefined);
    }
    if (editDraft?.id === hostId) setEditDraft(undefined);
    setEditDeleteConfirm(false);
  }

  return (
    <main className="web-connect-shell">
      <div
        className="web-connect-preferences"
        aria-label={copy.preferences}
      >
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
        <div className="web-connect-brand">
          <span className="web-connect-mark" aria-hidden="true">
            <Radio size={18} />
          </span>
          <span>Threadlight</span>
        </div>

        <div className="web-connect-copy">
          <p className="web-connect-eyebrow">WEB CLIENT</p>
          <h1 id="connect-title">{copy.title}</h1>
          <p>{copy.description}</p>
        </div>

        <form className="web-connect-form" onSubmit={submit}>
          <div className="web-host-select-group">
            <label className="web-host-select-label">
              <span>{copy.savedHosts}</span>
              <select
                className="web-host-select"
                aria-label={copy.savedHosts}
                value={selectedHostId}
                onChange={(event) => pickHost(event.target.value)}
              >
                <option value="">{copy.savedHostsPlaceholder}</option>
                {hosts.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.name || host.endpoint}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              ref={manageButtonRef}
              className="web-host-manage pressable"
              aria-label={copy.manageHosts}
              aria-haspopup="dialog"
              aria-expanded={managerOpen}
              title={copy.manageHosts}
              onClick={openManager}
            >
              <ServerCog size={16} aria-hidden="true" />
            </button>
          </div>

          <label>
            <span>{copy.endpoint}</span>
            <input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://host.example.com"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              required
              autoFocus={!endpoint}
            />
          </label>

          <label>
            <span>{copy.token}</span>
            <span className="web-token-field">
              <input
                type={showToken ? "text" : "password"}
                autoComplete="current-password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                required
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

          {errorReason !== undefined && (
            <div className="web-connect-error" role="alert">
              {connectionError(errorReason, copy)}
            </div>
          )}

          <button
            type="submit"
            className="web-connect-submit pressable"
            disabled={connecting || !endpoint.trim() || !token}
          >
            {connecting ? copy.connecting : copy.connect}
          </button>
        </form>

        <div className="web-connect-security">
          <ShieldCheck size={14} />
          <span>{copy.tokenNotice}</span>
        </div>
      </section>

      {managerOpen && managerPosition && (
        <ActionPopover
          label={copy.manageHosts}
          position={managerPosition}
          className="web-host-manager"
          role="dialog"
          closeOnTab={!editDraft}
          initialFocusRef={editDraft ? editNameRef : undefined}
          returnFocusRef={manageButtonRef}
          onClose={closeManager}
        >
          <div className="web-host-manager-header">{copy.manageHosts}</div>
          {editDraft ? (
            <form className="web-host-edit" onSubmit={saveEdit}>
              <label>
                <span>{copy.hostName}</span>
                <input
                  ref={editNameRef}
                  value={editDraft.name}
                  onChange={(event) =>
                    setEditDraft({ ...editDraft, name: event.target.value })
                  }
                  placeholder={editDraft.endpoint}
                />
              </label>
              <label>
                <span>{copy.endpoint}</span>
                <input
                  type="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={editDraft.endpoint}
                  onChange={(event) =>
                    setEditDraft({ ...editDraft, endpoint: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                <span>{copy.token}</span>
                <span className="web-token-field web-host-edit-token">
                  <input
                    type={showEditToken ? "text" : "password"}
                    autoComplete="current-password"
                    value={editDraft.token}
                    onChange={(event) =>
                      setEditDraft({ ...editDraft, token: event.target.value })
                    }
                    required
                  />
                  <button
                    type="button"
                    className="web-token-toggle pressable"
                    aria-label={
                      showEditToken ? copy.hideToken : copy.showToken
                    }
                    title={showEditToken ? copy.hideToken : copy.showToken}
                    onClick={() => setShowEditToken((visible) => !visible)}
                  >
                    {showEditToken ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </span>
              </label>
              <div className="web-host-edit-actions">
                <button type="submit" className="primary pressable">
                  {copy.saveHost}
                </button>
                <button
                  type="button"
                  className="pressable"
                  onClick={() => {
                    setEditDraft(undefined);
                    setEditDeleteConfirm(false);
                  }}
                >
                  {copy.cancel}
                </button>
                {editDeleteConfirm ? (
                  <button
                    type="button"
                    className="danger pressable"
                    data-popover-item
                    onClick={() => removeHost(editDraft.id)}
                  >
                    {copy.deleteHostConfirm}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="danger pressable"
                    data-popover-item
                    onClick={() => setEditDeleteConfirm(true)}
                  >
                    {copy.deleteHost}
                  </button>
                )}
              </div>
            </form>
          ) : hosts.length === 0 ? (
            <p className="web-host-empty">{copy.emptyHosts}</p>
          ) : (
            <ul className="web-host-list">
              {hosts.map((host) => (
                <li key={host.id} className="web-host-row">
                  <span className="web-host-row-main">
                    <Server size={14} aria-hidden="true" />
                    <span className="web-host-row-text">
                      <strong>{host.name || host.endpoint}</strong>
                      {host.name ? <small>{host.endpoint}</small> : null}
                    </span>
                  </span>
                  <span className="web-host-row-actions">
                    {confirmDeleteId === host.id ? (
                      <>
                        <button
                          type="button"
                          data-popover-item
                          className="danger pressable"
                          onClick={() => removeHost(host.id)}
                        >
                          {copy.deleteHostConfirm}
                        </button>
                        <button
                          type="button"
                          data-popover-item
                          className="pressable"
                          onClick={() => setConfirmDeleteId(undefined)}
                        >
                          {copy.cancel}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          data-popover-item
                          className="pressable"
                          aria-label={copy.editHost}
                          title={copy.editHost}
                          onClick={() => startEdit(host)}
                        >
                          <Pencil size={13} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          data-popover-item
                          className="pressable"
                          aria-label={copy.deleteHost}
                          title={copy.deleteHost}
                          onClick={() => setConfirmDeleteId(host.id)}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ActionPopover>
      )}
    </main>
  );
}

export function connectionPageCopy(language: Language): ConnectionCopy {
  return CONNECTION_COPY[language];
}

export function connectionError(
  reason: unknown,
  copy: ConnectionCopy = CONNECTION_COPY.en,
): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (window.location.protocol === "https:" && /^http:\/\/\//i.test(message)) {
    return copy.httpsError;
  }
  if (message === "Failed to fetch" || /network/i.test(message)) {
    return copy.networkError;
  }
  return message;
}
