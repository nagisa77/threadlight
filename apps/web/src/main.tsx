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
  hostNameForEndpoint,
  loadHostRecords,
  migrateLegacyHostRecord,
  mostRecentHost,
  removeHostRecord,
  saveHostRecords,
  upsertHostRecord,
  type HostRecord,
  type HostRecordInput,
} from "./host-store.js";

const SESSION_ACTIVE_KEY = "threadlight:web:session-active";
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
  const [hostRecords, setHostRecords] = useState<HostRecord[]>(() =>
    initialHostRecords(),
  );
  const [credentials, setCredentials] = useState(() =>
    initialCredentials(hostRecords),
  );
  const activeSession = useRef<RemoteWebSession | undefined>(undefined);
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

  async function connect(endpoint: string, token: string, name?: string) {
    const [next] = await Promise.all([
      createRemoteWebSession({ endpoint, token }),
      loadThreadlightApp(),
    ]);
    activeSession.current?.dispose();
    activeSession.current = next;
    const trimmed = endpoint.trim();
    setCredentials({ endpoint: trimmed, token });
    const nextRecords = upsertHostRecord(hostRecords, {
      name: name?.trim() || hostNameForEndpoint(trimmed),
      endpoint: trimmed,
      token,
    });
    setHostRecords(nextRecords);
    saveHostRecords(nextRecords, window.localStorage);
    try {
      window.sessionStorage.setItem(SESSION_ACTIVE_KEY, "1");
    } catch {
      // Storage can be unavailable in private or locked-down browsing modes.
    }
    setSession(next);
  }

  function upsertHost(host: HostRecordInput) {
    const nextRecords = upsertHostRecord(hostRecords, host);
    setHostRecords(nextRecords);
    saveHostRecords(nextRecords, window.localStorage);
  }

  function deleteHost(id: string) {
    const nextRecords = removeHostRecord(hostRecords, id);
    setHostRecords(nextRecords);
    saveHostRecords(nextRecords, window.localStorage);
  }

  function disconnect() {
    activeSession.current?.dispose();
    activeSession.current = undefined;
    setCredentials((current) => ({ ...current, token: "" }));
    try {
      window.sessionStorage.removeItem(SESSION_ACTIVE_KEY);
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
          credentials.endpoint &&
            credentials.token &&
            isSessionActive(),
        )}
        savedHosts={hostRecords}
        onConnect={connect}
        onUpsertHost={upsertHost}
        onDeleteHost={deleteHost}
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

function initialHostRecords(): HostRecord[] {
  const storage = window.localStorage;
  const records = loadHostRecords(storage);
  if (records.length > 0) return records;
  const migrated = migrateLegacyHostRecord(storage, window.sessionStorage);
  return migrated ? [migrated] : [];
}

function initialCredentials(records: HostRecord[]): {
  endpoint: string;
  token: string;
} {
  const recent = mostRecentHost(records);
  const configuredEndpoint =
    import.meta.env.VITE_THREADLIGHT_HOST_URL?.trim() ?? "";
  return {
    // The configured env address is only a fallback when nothing is saved.
    endpoint: recent?.endpoint || configuredEndpoint || "",
    token: recent?.token || "",
  };
}

function isSessionActive(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_ACTIVE_KEY) === "1";
  } catch {
    return false;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(<WebApp />);
