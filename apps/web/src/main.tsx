import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { LogOut } from "lucide-react";
import { ThreadlightApp } from "@threadlight/ui";
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

const ENDPOINT_STORAGE_KEY = "threadlight:web:host-endpoint";
const TOKEN_STORAGE_KEY = "threadlight:web:host-token";

document.documentElement.dataset.platform = "web";
const disposeMobileViewportHeight = installMobileViewportHeight();
if (import.meta.hot) {
  import.meta.hot.dispose(disposeMobileViewportHeight);
}

function WebApp() {
  const [session, setSession] = useState<RemoteWebSession>();
  const [credentials, setCredentials] = useState(savedCredentials);
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

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(<WebApp />);
