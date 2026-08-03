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
  Radio,
  ShieldCheck,
} from "lucide-react";
import {
  I18nProvider,
  isLanguage,
  isThemePreference,
  LANGUAGE_OPTIONS,
  ThemeProvider,
  type Language,
} from "@threadlight/ui";

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
    endpoint: "Host address",
    token: "Access token",
    showToken: "Show token",
    hideToken: "Hide token",
    connecting: "Connecting…",
    connect: "Connect to Host",
    tokenNotice: "The token is stored only for this browser tab session.",
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
    endpoint: "Host 地址",
    token: "访问 Token",
    showToken: "显示 Token",
    hideToken: "隐藏 Token",
    connecting: "正在连接…",
    connect: "连接 Host",
    tokenNotice: "Token 仅保存在当前浏览器标签会话中。",
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
    endpoint: "Host 位址",
    token: "存取 Token",
    showToken: "顯示 Token",
    hideToken: "隱藏 Token",
    connecting: "連線中…",
    connect: "連線 Host",
    tokenNotice: "Token 只會保存在目前瀏覽器分頁的工作階段中。",
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
    endpoint: "Host アドレス",
    token: "アクセストークン",
    showToken: "トークンを表示",
    hideToken: "トークンを隠す",
    connecting: "接続中…",
    connect: "Host に接続",
    tokenNotice: "トークンは、このブラウザータブのセッションにのみ保存されます。",
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
    endpoint: "Host 주소",
    token: "액세스 토큰",
    showToken: "토큰 표시",
    hideToken: "토큰 숨기기",
    connecting: "연결 중…",
    connect: "Host에 연결",
    tokenNotice: "토큰은 현재 브라우저 탭 세션에만 저장됩니다.",
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
}: {
  initialEndpoint: string;
  initialToken: string;
  autoConnect: boolean;
  onConnect(endpoint: string, token: string): Promise<void>;
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
  language,
  theme,
  onLanguageChange,
  onThemeChange,
}: {
  initialEndpoint: string;
  initialToken: string;
  autoConnect: boolean;
  onConnect(endpoint: string, token: string): Promise<void>;
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
  if (window.location.protocol === "https:" && /^http:\/\//i.test(message)) {
    return copy.httpsError;
  }
  if (message === "Failed to fetch" || /network/i.test(message)) {
    return copy.networkError;
  }
  return message;
}
