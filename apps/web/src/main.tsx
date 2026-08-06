import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { LoaderCircle, LogOut } from "lucide-react";
import {
  createRemoteWebSession,
  type RemoteWebSession,
} from "@threadlight/web-runtime";
import "@threadlight/ui/styles.css";

import "./web.css";
import {
  taskPath,
  threadIdFromTaskPath,
} from "./task-route.js";
import { installMobileViewportHeight } from "./mobile-viewport.js";
import { RemoteConnectionPage } from "./connection-page.js";
import {
  loadSavedHosts,
  persistSavedHosts,
  upsertSavedHost,
  type SavedHost,
} from "./saved-hosts.js";

const loadThreadlightApp = () => import("@threadlight/ui/app");
const LazyThreadlightApp = lazy(() =>
  loadThreadlightApp().then(({ ThreadlightApp }) => ({
    default: ThreadlightApp,
  })),
);

document.documentElement.dataset.platform = "web";
const disposeMobileViewportHeight = installMobileViewportHeight();
if (import.meta.hot) {
  import.meta.hot.dispose(disposeMobileViewportHeight);
}

function WebApp() {
  const [session, setSession] = useState<RemoteWebSession>();
  const [credentials, setCredentials] = useState(savedCredentials);
  const [savedHosts, setSavedHosts] = useState<SavedHost[]>(() => {
    try {
      return loadSavedHosts(window.localStorage);
    } catch {
      return [];
    }
  });
  const activeSession = useRef<RemoteWebSession | undefined>(undefined);
  const hasConnected = useRef(false);
  const initialThreadId = useRef(
    threadIdFromTaskPath(
      window.location.pathname,
      import.meta.env.BASE_URL,
    ),
  ).current;

  useEffect(
    () => () => {
      activeSession.current?.dispose();
    },
    [],
  );

  async function connect(endpoint: string, token: string) {
    const trimmedEndpoint = endpoint.trim();
    const [next] = await Promise.all([
      createRemoteWebSession({ endpoint: trimmedEndpoint, token }),
      loadThreadlightApp(),
    ]);
    activeSession.current?.dispose();
    activeSession.current = next;
    setCredentials({ endpoint: trimmedEndpoint, token });
    setSavedHosts((hosts) => {
      const nextHosts = upsertSavedHost(hosts, {
        endpoint: trimmedEndpoint,
        token,
      });
      persistSavedHosts(window.localStorage, nextHosts);
      return nextHosts;
    });
    hasConnected.current = true;
    setSession(next);
  }

  /**
   * Logout only disposes the session and returns to the connection page.
   * The endpoint and token are kept in memory (and in the saved Host list) so
   * reconnecting is a single click; there is no auto-reconnect after logout.
   */
  function disconnect() {
    activeSession.current?.dispose();
    activeSession.current = undefined;
    setSession(undefined);
  }

  function updateSavedHosts(hosts: SavedHost[]) {
    setSavedHosts(hosts);
    persistSavedHosts(window.localStorage, hosts);
  }

  if (!session) {
    return (
      <RemoteConnectionPage
        initialEndpoint={credentials.endpoint}
        initialToken={credentials.token}
        autoConnect={Boolean(
          credentials.endpoint && credentials.token && !hasConnected.current,
        )}
        initialHosts={savedHosts}
        onHostsChange={updateSavedHosts}
        onConnect={connect}
      />
    );
  }

  return (
    <>
      <Suspense
        fallback={
          <main className="web-app-loading" role="status">
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
            <span>Loading Threadlight…</span>
          </main>
        }
      >
        <LazyThreadlightApp
          client={session.client}
          initialThreadId={initialThreadId}
          onThreadChange={replaceWebTaskPath}
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
      </Suspense>
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

function replaceWebTaskPath(threadId?: string): void {
  const url = new URL(window.location.href);
  url.pathname = taskPath(threadId, import.meta.env.BASE_URL);
  window.history.replaceState(null, "", url);
}

/**
 * Prefills the connection page from the configured build-time Host URL or,
 * failing that, from the most recently connected saved Host. Tokens survive
 * logout and page reloads because they live in the saved Host records.
 */
function savedCredentials(): { endpoint: string; token: string } {
  const configuredEndpoint =
    import.meta.env.VITE_THREADLIGHT_HOST_URL?.trim() ?? "";
  try {
    const hosts = loadSavedHosts(window.localStorage);
    if (configuredEndpoint) {
      const host = hosts.find((entry) => entry.endpoint === configuredEndpoint);
      return { endpoint: configuredEndpoint, token: host?.token ?? "" };
    }
    const recent = hosts[0];
    return { endpoint: recent?.endpoint ?? "", token: recent?.token ?? "" };
  } catch {
    return { endpoint: configuredEndpoint, token: "" };
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(<WebApp />);
