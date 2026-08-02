import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { Eye, EyeOff, LogOut, Radio, ShieldCheck } from "lucide-react";
import { ThreadlightApp } from "@threadlight/ui";
import {
  createRemoteWebSession,
  type RemoteWebSession,
} from "@threadlight/web-runtime";
import "@threadlight/ui/styles.css";

import "./web.css";

const ENDPOINT_STORAGE_KEY = "threadlight:web:host-endpoint";
const TOKEN_STORAGE_KEY = "threadlight:web:host-token";

document.documentElement.dataset.platform = "web";

function WebApp() {
  const [session, setSession] = useState<RemoteWebSession>();
  const [credentials, setCredentials] = useState(savedCredentials);
  const activeSession = useRef<RemoteWebSession | undefined>(undefined);

  useEffect(
    () => () => {
      activeSession.current?.dispose();
    },
    [],
  );

  async function connect(endpoint: string, token: string) {
    const next = await createRemoteWebSession({ endpoint, token });
    activeSession.current?.dispose();
    activeSession.current = next;
    setCredentials({ endpoint: endpoint.trim(), token });
    try {
      window.localStorage.setItem(ENDPOINT_STORAGE_KEY, endpoint.trim());
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
      // Storage can be unavailable in private or locked-down browsing modes.
    }
    setSession(next);
  }

  function disconnect() {
    activeSession.current?.dispose();
    activeSession.current = undefined;
    setCredentials((current) => ({ ...current, token: "" }));
    try {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // The in-memory session is still disconnected.
    }
    setSession(undefined);
  }

  if (!session) {
    return (
      <RemoteConnectionPage
        initialEndpoint={credentials.endpoint}
        initialToken={credentials.token}
        autoConnect={Boolean(
          credentials.endpoint && credentials.token,
        )}
        onConnect={connect}
      />
    );
  }

  return (
    <>
      <ThreadlightApp
        client={session.client}
        clipboard={session.clipboard}
        connectorAuthorization={session.connectorAuthorization}
        settings={session.settings}
        diagnostics={session.diagnostics}
        automations={session.automations}
        search={session.search}
        projects={session.projects}
        attachmentStage={session.attachmentStage}
        attachmentPreview={session.attachmentPreview}
        voiceInput={session.voiceInput}
        memory={session.memory}
        terminal={session.terminal}
        workspace={session.workspace}
        executionPolicy={session.executionPolicy}
      />
      <div className="web-session-indicator">
        <span className="web-session-dot" aria-hidden="true" />
        <span className="web-session-name" title={session.health.name}>
          {session.health.name}
        </span>
        <button
          type="button"
          className="web-session-disconnect pressable"
          aria-label="断开远端 Host"
          title="断开远端 Host"
          onClick={disconnect}
        >
          <LogOut size={13} />
        </button>
      </div>
    </>
  );
}

function RemoteConnectionPage({
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
  const [endpoint, setEndpoint] = useState(initialEndpoint);
  const [token, setToken] = useState(initialToken);
  const [showToken, setShowToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();
  const attemptedAutoConnect = useRef(false);

  useEffect(() => {
    if (!autoConnect || attemptedAutoConnect.current) return;
    attemptedAutoConnect.current = true;
    void submitCredentials();
  }, [autoConnect]);

  async function submitCredentials() {
    if (connecting) return;
    setConnecting(true);
    setError(undefined);
    try {
      await onConnect(endpoint.trim(), token);
    } catch (reason) {
      setError(connectionError(reason));
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
      <section className="web-connect-card" aria-labelledby="connect-title">
        <div className="web-connect-brand">
          <span className="web-connect-mark" aria-hidden="true">
            <Radio size={18} />
          </span>
          <span>Threadlight</span>
        </div>

        <div className="web-connect-copy">
          <p className="web-connect-eyebrow">WEB CLIENT</p>
          <h1 id="connect-title">连接远端 Host</h1>
          <p>
            Web 端只连接已经运行的 Threadlight Host，不会在浏览器或部署服务器上启动本地 Host。
          </p>
        </div>

        <form className="web-connect-form" onSubmit={submit}>
          <label>
            <span>Host 地址</span>
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
            <span>访问 Token</span>
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
                aria-label={showToken ? "隐藏 Token" : "显示 Token"}
                title={showToken ? "隐藏 Token" : "显示 Token"}
                onClick={() => setShowToken((visible) => !visible)}
              >
                {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </label>

          {error && (
            <div className="web-connect-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="web-connect-submit pressable"
            disabled={connecting || !endpoint.trim() || !token}
          >
            {connecting ? "正在连接…" : "连接 Host"}
          </button>
        </form>

        <div className="web-connect-security">
          <ShieldCheck size={14} />
          <span>Token 仅保存在当前浏览器标签会话中。</span>
        </div>
      </section>
    </main>
  );
}

function savedCredentials(): { endpoint: string; token: string } {
  const configuredEndpoint =
    import.meta.env.VITE_THREADLIGHT_HOST_URL?.trim() ?? "";
  try {
    return {
      endpoint:
        configuredEndpoint ||
        window.localStorage.getItem(ENDPOINT_STORAGE_KEY) ||
        "",
      token: window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || "",
    };
  } catch {
    return { endpoint: configuredEndpoint, token: "" };
  }
}

function connectionError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (window.location.protocol === "https:" && /^http:\/\//i.test(message)) {
    return "HTTPS 页面不能连接 HTTP Host，请为 Host 配置 TLS。";
  }
  if (message === "Failed to fetch" || /network/i.test(message)) {
    return "无法连接 Host。请检查地址、TLS、Token，以及 Host 的 --origin 配置。";
  }
  return message;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(<WebApp />);
