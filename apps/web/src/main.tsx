import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { LoaderCircle } from "lucide-react";
import {
  createRemoteWebSession,
  type RemoteWebSession,
} from "@threadlight/web-runtime";
import { I18nProvider, isLanguage, type Language } from "@threadlight/ui/i18n";
import { ThemeProvider } from "@threadlight/ui/theme";
import "@threadlight/ui/styles.css";

import "./web.css";
import { taskPath, threadIdFromTaskPath } from "./task-route.js";
import { installMobileViewportHeight } from "./mobile-viewport.js";
import {
  connectionPageCopy,
  loadConnectPrefs,
  RemoteConnectionPage,
} from "./connection-page.js";
import { WebSessionIndicator } from "./session-indicator.js";
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
import {
  configuredHostEndpoint,
  initialWebStartupPhase,
  type WebStartupPhase,
} from "./startup.js";

const SESSION_ACTIVE_KEY = "threadlight:web:session-active";
const loadThreadlightApp = () => import("@threadlight/ui/app");
type ThreadlightAppModule = Awaited<ReturnType<typeof loadThreadlightApp>>;
type ActiveWebRuntime = {
  session: RemoteWebSession;
  App: ThreadlightAppModule["ThreadlightApp"];
};

document.documentElement.dataset.platform = "web";
const disposeMobileViewportHeight = installMobileViewportHeight();
if (import.meta.hot) {
  import.meta.hot.dispose(disposeMobileViewportHeight);
}

function WebApp() {
  const [language, setLanguage] = useState<Language>(
    () => loadConnectPrefs().language,
  );
  const [hostRecords, setHostRecords] = useState<HostRecord[]>(() =>
    initialHostRecords(),
  );
  const [credentials, setCredentials] = useState(() =>
    initialCredentials(hostRecords),
  );
  const [startupPhase, setStartupPhase] = useState<WebStartupPhase>(() =>
    initialWebStartupPhase(credentials, isSessionActive()),
  );
  const [restoreError, setRestoreError] = useState<unknown>();
  const [runtime, setRuntime] = useState<ActiveWebRuntime>();
  const [appReady, setAppReady] = useState(false);
  const activeSession = useRef<RemoteWebSession | undefined>(undefined);
  const automaticRestoreAttempted = useRef(false);
  const initialThreadId = useRef(
    threadIdFromTaskPath(window.location.pathname, import.meta.env.BASE_URL),
  ).current;

  useEffect(
    () => () => {
      activeSession.current?.dispose();
    },
    [],
  );

  useEffect(() => {
    if (startupPhase !== "restoring" || automaticRestoreAttempted.current) {
      return;
    }
    automaticRestoreAttempted.current = true;
    const savedHost = mostRecentHost(hostRecords);
    void connect(
      credentials.endpoint,
      credentials.token,
      savedHost?.name,
    ).catch((error: unknown) => {
      setRestoreError(error);
      setStartupPhase("connection");
    });
  }, []);

  async function connect(endpoint: string, token: string, name?: string) {
    const [next, appModule] = await Promise.all([
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
    if (isLanguage(next.bootstrap.settings.language)) {
      setLanguage(next.bootstrap.settings.language);
    }
    setRestoreError(undefined);
    setAppReady(false);
    setRuntime({ session: next, App: appModule.ThreadlightApp });
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
    setRuntime(undefined);
    setAppReady(false);
    setStartupPhase("connection");
  }

  if (!runtime && startupPhase === "restoring") {
    return (
      <ThemeProvider preference={loadConnectPrefs().theme}>
        <WebBootstrapScreen language={language} />
      </ThemeProvider>
    );
  }

  if (!runtime) {
    return (
      <RemoteConnectionPage
        initialEndpoint={credentials.endpoint}
        initialToken={credentials.token}
        autoConnect={false}
        savedHosts={hostRecords}
        onConnect={connect}
        onUpsertHost={upsertHost}
        onDeleteHost={deleteHost}
        onLanguageChange={setLanguage}
        initialErrorReason={restoreError}
      />
    );
  }

  const { session, App } = runtime;

  return (
    <>
      <div
        className={`web-runtime${appReady ? " is-ready" : " is-restoring"}`}
        aria-hidden={appReady ? undefined : true}
      >
        <App
          client={session.client}
          taskLinksEnabled
          initialThreadId={initialThreadId}
          initialLanguage={language}
          initialSettings={session.bootstrap.settings}
          initialProjects={session.bootstrap.projects}
          onInitialViewReady={() => setAppReady(true)}
          onThreadChange={replaceWebTaskPath}
          onLanguageChange={setLanguage}
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
          browser={session.browser}
          workspace={session.workspace}
          executionPolicy={session.executionPolicy}
        />
        <I18nProvider language={language}>
          <WebSessionIndicator
            hostName={session.health.name}
            onDisconnect={disconnect}
          />
        </I18nProvider>
      </div>
      {!appReady && (
        <ThemeProvider preference={session.bootstrap.settings.theme}>
          <WebBootstrapScreen language={language} />
        </ThemeProvider>
      )}
    </>
  );
}

function WebBootstrapScreen({ language }: { language: Language }) {
  return (
    <main
      className="web-bootstrap"
      role="status"
      aria-label={connectionPageCopy(language).connecting}
    >
      <span className="web-bootstrap-mark" aria-hidden="true">
        <LoaderCircle className="spin" size={17} />
      </span>
      <span className="web-bootstrap-wordmark">Threadlight</span>
    </main>
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
  const configuredEndpoint = configuredHostEndpoint(
    import.meta.env.VITE_THREADLIGHT_HOST_URL,
    window.location.origin,
  );
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
