import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { ThreadlightClient } from "@threadlight/client";
import {
  CONNECTOR_AUTH_ERROR_CODES,
  type CapabilityDescriptor,
  type TurnMode,
} from "@threadlight/protocol";

import {
  capabilityQueryAt,
  connectorCapabilityForSelection,
  filterCapabilities,
  filterComposerAddActions,
  removeCapabilityQuery,
  type CapabilityQuery,
  type ComposerAddAction,
} from "../../capabilities.js";
import type { Translate } from "../../i18n.js";
import { errorMessage } from "../shared/format.js";
import type { ConnectorAuthorizationAdapter } from "./types.js";

interface CapabilityControllerOptions {
  client: ThreadlightClient;
  threadId?: string;
  connection: string;
  running: boolean;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  textarea: RefObject<HTMLTextAreaElement | null>;
  composerRoot: RefObject<HTMLDivElement | null>;
  setComposerMode: Dispatch<SetStateAction<TurnMode>>;
  attachmentAvailable: boolean;
  openAttachmentPicker(): void;
  connectorAuthorization?: ConnectorAuthorizationAdapter;
  t: Translate;
}

/** Owns capability discovery, filtering, selection, and connector setup. */
export function useCapabilityController({
  client,
  threadId,
  connection,
  running,
  input,
  setInput,
  textarea,
  composerRoot,
  setComposerMode,
  attachmentAvailable,
  openAttachmentPicker,
  connectorAuthorization,
  t,
}: CapabilityControllerOptions) {
  const [capabilities, setCapabilities] = useState<
    readonly CapabilityDescriptor[]
  >([]);
  const [selected, setSelected] = useState<readonly CapabilityDescriptor[]>([]);
  const [query, setQuery] = useState<CapabilityQuery>();
  const [activeIndex, setActiveIndex] = useState(0);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connectorSetup, setConnectorSetup] = useState<{
    capability: CapabilityDescriptor;
    selection: CapabilityDescriptor;
    status: Awaited<ReturnType<ThreadlightClient["connectorStatus"]>>;
  }>();
  const [connectorBusy, setConnectorBusy] = useState(false);
  const [connectorError, setConnectorError] = useState<string>();
  const capabilityRequest = useRef(0);
  const refreshedForOpenMenu = useRef(false);

  useEffect(() => {
    const request = ++capabilityRequest.current;
    refreshedForOpenMenu.current = false;
    setSelected([]);
    setQuery(undefined);
    setAddMenuOpen(false);
    setActiveIndex(0);
    setConnectorSetup(undefined);
    setConnectorBusy(false);
    setConnectorError(undefined);
    if (connection !== "ready") {
      setCapabilities([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void client
      .listCapabilities(threadId)
      .then(({ capabilities: next }) => {
        if (active && request === capabilityRequest.current) {
          setCapabilities(next);
        }
      })
      .catch(() => {
        if (active && request === capabilityRequest.current) {
          setCapabilities([]);
        }
      })
      .finally(() => {
        if (active && request === capabilityRequest.current) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [client, connection, threadId]);

  useEffect(() => {
    if (!query && !addMenuOpen) {
      refreshedForOpenMenu.current = false;
      return;
    }
    if (refreshedForOpenMenu.current || connection !== "ready" || running) {
      return;
    }
    refreshedForOpenMenu.current = true;
    const request = ++capabilityRequest.current;
    setLoading(true);
    void client
      .listCapabilities(threadId, true)
      .then(({ capabilities: next }) => {
        if (request === capabilityRequest.current) setCapabilities(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (request === capabilityRequest.current) setLoading(false);
      });
  }, [addMenuOpen, client, connection, query, running, threadId]);

  useEffect(() => {
    if (!query && !addMenuOpen) return;
    const closeFromOutside = (event: globalThis.PointerEvent) => {
      if (!composerRoot.current?.contains(event.target as Node)) closeMenus();
    };
    window.addEventListener("pointerdown", closeFromOutside);
    return () => window.removeEventListener("pointerdown", closeFromOutside);
  }, [addMenuOpen, composerRoot, query]);

  const selectedIds = new Set(
    selected.flatMap(({ id, connectorRef }) =>
      connectorRef ? [id, connectorRef] : [id],
    ),
  );
  const filtered = running
    ? []
    : filterCapabilities(capabilities, query?.query ?? "", selectedIds);
  const addActions = filterComposerAddActions(
    attachmentAvailable
      ? [
          {
            id: "attachment" as const,
            name: t("addAttachment"),
            description: t("addAttachmentDescription"),
            icon: "attachment" as const,
          },
        ]
      : [],
    query?.query ?? "",
  );
  const itemCount = addActions.length + filtered.length;

  useEffect(() => {
    if ((!query && !addMenuOpen) || itemCount === 0) return;
    document
      .getElementById(
        `composer-capability-${Math.min(activeIndex, itemCount - 1)}`,
      )
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, addMenuOpen, itemCount, query]);

  function closeMenus() {
    setQuery(undefined);
    setAddMenuOpen(false);
  }

  function toggleAddMenu() {
    setQuery(undefined);
    setAddMenuOpen((open) => !open);
    setActiveIndex(0);
    requestAnimationFrame(() => textarea.current?.focus());
  }

  function updateQuery(value: string, cursor: number | null) {
    const nextQuery = capabilityQueryAt(value, cursor);
    setQuery(nextQuery);
    if (nextQuery) setAddMenuOpen(false);
    setActiveIndex(0);
  }

  function selectAddAction(_action: ComposerAddAction) {
    setAddMenuOpen(false);
    setActiveIndex(0);
    if (query) {
      const next = removeCapabilityQuery(input, query);
      setInput(next.value);
      setQuery(undefined);
      requestAnimationFrame(() => {
        textarea.current?.setSelectionRange(next.cursor, next.cursor);
      });
    }
    openAttachmentPicker();
    requestAnimationFrame(() => textarea.current?.focus());
  }

  function selectCapability(capability: CapabilityDescriptor) {
    const next = query
      ? removeCapabilityQuery(input, query)
      : {
          value: input,
          cursor: textarea.current?.selectionStart ?? input.length,
        };
    if (query) setInput(next.value);
    closeMenus();
    setActiveIndex(0);
    const connector = connectorCapabilityForSelection(capability, capabilities);
    if (connector && connector.status !== "ready") {
      void prepareConnector(capability, connector, next.cursor);
      return;
    }
    commitSelection(capability, next.cursor);
  }

  function selectMenuItem(index: number) {
    const action = addActions[index];
    if (action) return selectAddAction(action);
    const capability = filtered[index - addActions.length];
    if (capability) selectCapability(capability);
  }

  function commitSelection(capability: CapabilityDescriptor, cursor?: number) {
    setSelected((current) => selectComposerCapability(current, capability));
    if (capability.id === "tool:plan") setComposerMode("plan");
    requestAnimationFrame(() => {
      textarea.current?.focus();
      if (cursor !== undefined)
        textarea.current?.setSelectionRange(cursor, cursor);
    });
  }

  async function prepareConnector(
    selection: CapabilityDescriptor,
    capability: CapabilityDescriptor,
    cursor: number,
    openWhenReady = false,
  ) {
    if (!threadId) return;
    setConnectorError(undefined);
    try {
      const status = await client.connectorStatus(threadId, capability.id);
      const updated = { ...capability, status: status.status };
      updateCapabilityStatus(capability.id, status.status);
      if (status.status === "ready" && !openWhenReady) {
        commitSelection({ ...selection, status: "ready" }, cursor);
        return;
      }
      setConnectorSetup({ capability: updated, selection, status });
    } catch (reason) {
      setConnectorSetup({
        capability,
        selection,
        status: {
          capabilityId: capability.id,
          connectorId: capability.id.replace(/^mcp:/, ""),
          name: capability.name,
          status:
            capability.status === "needs_authorization"
              ? "needs_authorization"
              : "needs_configuration",
          configured: capability.status === "needs_authorization",
          authorized: false,
          redirectUrl: "",
        },
      });
      setConnectorError(connectorErrorMessage(reason, t));
    }
  }

  function manageConnector(selection: CapabilityDescriptor) {
    const connector = connectorCapabilityForSelection(selection, capabilities);
    if (!connector) return;
    void prepareConnector(
      selection,
      connector,
      textarea.current?.selectionStart ?? input.length,
      true,
    );
  }

  function updateCapabilityStatus(
    capabilityId: string,
    status: CapabilityDescriptor["status"],
  ) {
    setCapabilities((current) =>
      current.map((capability) =>
        capability.id === capabilityId ? { ...capability, status } : capability,
      ),
    );
  }

  async function connectConnector(clientId: string, clientSecret: string) {
    if (!threadId || !connectorSetup) return;
    const { capability, selection } = connectorSetup;
    setConnectorBusy(true);
    setConnectorError(undefined);
    try {
      const authorize = async () => {
        let status = connectorSetup.status;
        if (!status.configured) {
          status = await client.configureConnector(
            threadId,
            capability.id,
            clientId,
            clientSecret,
          );
          setConnectorSetup({
            capability: { ...capability, status: status.status },
            selection,
            status,
          });
          updateCapabilityStatus(capability.id, status.status);
        }
        status = await client.authorizeConnector(threadId, capability.id);
        const connected = { ...capability, status: status.status };
        updateCapabilityStatus(capability.id, status.status);
        if (status.status !== "ready") {
          setConnectorSetup({ capability: connected, selection, status });
          throw new Error(t("capabilityNeedsAuthorization"));
        }
        setConnectorSetup(undefined);
        commitSelection({ ...selection, status: "ready" });
      };
      if (connectorAuthorization) {
        await connectorAuthorization.authorize(authorize);
      } else {
        await authorize();
      }
    } catch (reason) {
      setConnectorError(connectorErrorMessage(reason, t));
    } finally {
      setConnectorBusy(false);
    }
  }

  async function disconnectConnector() {
    if (!threadId || !connectorSetup) return;
    const { capability, selection } = connectorSetup;
    setConnectorBusy(true);
    setConnectorError(undefined);
    try {
      const status = await client.disconnectConnector(threadId, capability.id);
      updateCapabilityStatus(capability.id, status.status);
      setSelected((current) =>
        current.filter(({ id }) => id !== capability.id && id !== selection.id),
      );
      setConnectorSetup({
        capability: { ...capability, status: status.status },
        selection,
        status,
      });
    } catch (reason) {
      setConnectorError(connectorErrorMessage(reason, t));
    } finally {
      setConnectorBusy(false);
    }
  }

  function closeConnectorSetup() {
    if (connectorBusy) return;
    setConnectorSetup(undefined);
    setConnectorError(undefined);
    requestAnimationFrame(() => textarea.current?.focus());
  }

  return {
    capabilities,
    selected,
    setSelected,
    query,
    setQuery,
    activeIndex,
    setActiveIndex,
    addMenuOpen,
    setAddMenuOpen,
    loading,
    connectorSetup,
    connectorBusy,
    connectorError,
    filtered,
    addActions,
    itemCount,
    closeMenus,
    toggleAddMenu,
    updateQuery,
    selectAddAction,
    selectCapability,
    selectMenuItem,
    manageConnector,
    connectConnector,
    disconnectConnector,
    closeConnectorSetup,
  };
}

export function selectComposerCapability(
  current: readonly CapabilityDescriptor[],
  capability: CapabilityDescriptor,
): readonly CapabilityDescriptor[] {
  if (current.some(({ id }) => id === capability.id)) return current;
  if (capability.id === "tool:compact") return [capability];
  return [...current.filter(({ id }) => id !== "tool:compact"), capability];
}

export function connectorErrorMessage(reason: unknown, t: Translate): string {
  const code = errorMessage(reason);
  if (code === CONNECTOR_AUTH_ERROR_CODES.popupBlocked) {
    return t("connectorPopupBlocked");
  }
  if (code === CONNECTOR_AUTH_ERROR_CODES.popupClosed) {
    return t("connectorPopupClosed");
  }
  return code;
}
