import type {
  CapabilityDescriptor,
  ConnectorStatusData,
  ContextCompactionData,
  ContextCompactionProgressData,
  MessageCapabilityData,
} from "@threadlight/protocol";
import {
  Check,
  FileText,
  FileType2,
  Eye,
  ListTodo,
  LoaderCircle,
  Mail,
  Minimize2,
  Monitor,
  Paperclip,
  Plug,
  Presentation,
  Settings2,
  Sparkles,
  Table2,
  Wrench,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { useI18n } from "./i18n.js";
import { Dialog } from "./dialog.js";

export interface CapabilityQuery {
  start: number;
  end: number;
  query: string;
}

export interface ComposerAddAction {
  id: "attachment";
  name: string;
  description: string;
  icon: "attachment";
}

export function capabilityQueryAt(
  value: string,
  cursor: number | null,
): CapabilityQuery | undefined {
  if (cursor === null || cursor < 0 || cursor > value.length) return;
  const beforeCursor = value.slice(0, cursor);
  const start = beforeCursor.lastIndexOf("@");
  if (start < 0) return;
  const previous = value[start - 1];
  if (previous && /[a-z0-9._%+-]/iu.test(previous)) return;
  const query = beforeCursor.slice(start + 1);
  if (/[\s@]/u.test(query)) return;
  return {
    start,
    end: cursor,
    query,
  };
}

export function filterCapabilities(
  capabilities: readonly CapabilityDescriptor[],
  query: string,
  selectedIds: ReadonlySet<string>,
): CapabilityDescriptor[] {
  const normalized = query.trim().toLocaleLowerCase();
  return capabilities
    .filter((capability) => {
      if (
        selectedIds.has(capability.id) ||
        (capability.connectorRef !== undefined &&
          selectedIds.has(capability.connectorRef)) ||
        capability.visibility === "hidden"
      ) {
        return false;
      }
      if (!normalized) {
        return capability.visibility === "featured";
      }
      return [
        capability.name,
        capability.description,
        capability.source,
        capability.localPath,
        ...(capability.keywords ?? []),
      ]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalized));
    })
    .sort((left, right) => {
      if (left.kind === right.kind) return 0;
      return left.kind === "tool" ? -1 : 1;
    });
}

export function skillLocalDirectory(localPath: string): string {
  return localPath.replace(/[\\/]SKILL\.md$/iu, "");
}

export function filterComposerAddActions(
  actions: readonly ComposerAddAction[],
  query: string,
): ComposerAddAction[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...actions];
  return actions.filter((action) =>
    [
      action.name,
      action.description,
      action.id,
      ...(action.id === "attachment"
        ? [
            "file",
            "image",
            "document",
            "upload",
            "文件",
            "图片",
            "文档",
            "附件",
          ]
        : []),
    ].some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}

export function connectorCapabilityForSelection(
  capability: CapabilityDescriptor,
  catalog: readonly CapabilityDescriptor[],
): CapabilityDescriptor | undefined {
  const connectorRef = capability.id.startsWith("mcp:")
    ? capability.id
    : capability.connectorRef;
  if (!connectorRef) return;
  return catalog.find(({ id }) => id === connectorRef);
}

export function nextCapabilityIndex(
  current: number,
  total: number,
  delta: -1 | 1,
): number {
  if (total <= 0) return 0;
  return (current + delta + total) % total;
}

export function removeCapabilityQuery(
  value: string,
  query: CapabilityQuery,
): { value: string; cursor: number } {
  const before = value.slice(0, query.start);
  let after = value.slice(query.end);
  if (/\s$/u.test(before) && /^\s/u.test(after)) {
    after = after.slice(1);
  }
  return {
    value: before + after,
    cursor: before.length,
  };
}

export function CapabilityChips({
  capabilities,
  disabled,
  onManage,
  onPreview,
  onRemove,
}: {
  capabilities: readonly CapabilityDescriptor[];
  disabled: boolean;
  onManage?(capability: CapabilityDescriptor): void;
  onPreview?(capability: CapabilityDescriptor): void;
  onRemove(capability: CapabilityDescriptor): void;
}) {
  const { t } = useI18n();
  if (capabilities.length === 0) return null;
  return (
    <div className="capability-chips" aria-label={t("selectedCapabilities")}>
      {capabilities.map((capability) => (
        <span className="capability-chip" key={capability.id}>
          <CapabilityIcon icon={capability.icon} kind={capability.kind} />
          <span>{capability.name}</span>
          {onPreview && capability.kind === "skill" && capability.localPath && (
            <button
              type="button"
              className="capability-chip-preview pressable"
              disabled={disabled}
              aria-label={`${t("preview")} ${capability.name}`}
              title={t("preview")}
              onClick={() => onPreview(capability)}
            >
              <Eye size={12} />
            </button>
          )}
          {onManage &&
            (capability.id.startsWith("mcp:") ||
              capability.connectorRef !== undefined) && (
              <button
                type="button"
                className="capability-chip-manage pressable"
                disabled={disabled}
                aria-label={t("manageConnector", {
                  name: capability.name,
                })}
                onClick={() => onManage(capability)}
              >
                <Settings2 size={12} />
              </button>
            )}
          <button
            type="button"
            className="capability-chip-remove pressable"
            disabled={disabled}
            aria-label={t("removeCapability", {
              name: capability.name,
            })}
            onClick={() => onRemove(capability)}
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

export function MessageCapabilityReceipts({
  role,
  capabilities,
  capabilityRefs,
  catalog,
}: {
  role: "user" | "assistant";
  capabilities?: readonly MessageCapabilityData[];
  capabilityRefs?: readonly string[];
  catalog: readonly CapabilityDescriptor[];
}) {
  const { t } = useI18n();
  const resolved =
    capabilities && capabilities.length > 0
      ? capabilities
      : (capabilityRefs ?? [])
          .map((ref) => catalog.find(({ id }) => id === ref))
          .filter(
            (capability): capability is CapabilityDescriptor =>
              capability !== undefined,
          );
  if (resolved.length === 0) return null;

  return (
    <div
      className={`message-capability-receipts ${role}`}
      aria-label={
        role === "user"
          ? t("capabilitiesSelectedForTurn")
          : t("capabilitiesApplied")
      }
    >
      {resolved.map((capability) => (
        <span className="message-capability-receipt" key={capability.id}>
          <span className="message-capability-icon" aria-hidden="true">
            <CapabilityIcon icon={capability.icon} kind={capability.kind} />
          </span>
          <span className="message-capability-name">{capability.name}</span>
          <span className="message-capability-status">
            {role === "user"
              ? t("selectedForTurn")
              : capability.kind === "skill"
                ? t("skillLoaded")
                : t("toolEnabled")}
          </span>
          {role === "assistant" && (
            <Check
              className="message-capability-check"
              size={12}
              aria-hidden="true"
            />
          )}
        </span>
      ))}
    </div>
  );
}

export function ContextCompactionReceipt({
  compaction,
}: {
  compaction: ContextCompactionData | ContextCompactionProgressData;
}) {
  const { language, t } = useI18n();
  const tokenCount = (value: number) =>
    new Intl.NumberFormat(language, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  const details =
    compaction.status === "compacted"
      ? t("contextCompactionTokenRange", {
          before: tokenCount(compaction.tokensBefore),
          after: tokenCount(compaction.tokensAfter),
        })
      : t("contextCompactionCurrentTokens", {
          tokens: tokenCount(compaction.tokensAfter),
        });
  const source =
    compaction.source === "automatic"
      ? `${t("contextCompactionAutomatic")} · `
      : "";
  return (
    <div
      className="message-capability-receipts assistant"
      aria-label={
        compaction.status === "compacted"
          ? t("contextCompacted")
          : t("contextAlreadyCompact")
      }
    >
      <span className="message-capability-receipt">
        <span className="message-capability-icon" aria-hidden="true">
          <Minimize2 size={14} />
        </span>
        <span className="message-capability-name">
          {compaction.status === "compacted"
            ? t("contextCompacted")
            : t("contextAlreadyCompact")}
        </span>
        <span className="message-capability-status">
          {source}
          {details}
        </span>
        <Check
          className="message-capability-check"
          size={12}
          aria-hidden="true"
        />
      </span>
    </div>
  );
}

export function CapabilityMenu({
  actions,
  capabilities,
  activeIndex,
  loading,
  onSelectAction,
  onSelect,
}: {
  actions: readonly ComposerAddAction[];
  capabilities: readonly CapabilityDescriptor[];
  activeIndex: number;
  loading: boolean;
  onSelectAction(action: ComposerAddAction): void;
  onSelect(capability: CapabilityDescriptor): void;
}) {
  const { t } = useI18n();
  const empty = actions.length === 0 && capabilities.length === 0;
  return (
    <MenuFrame
      id="composer-capability-menu"
      icon={<Plug size={14} />}
      title={t("capabilities")}
    >
      {actions.length > 0 && (
        <div className="capability-group">
          <p className="capability-group-label">{t("add")}</p>
          {actions.map((action, index) => (
            <button
              type="button"
              id={`composer-capability-${index}`}
              className="capability-option"
              role="option"
              aria-selected={index === activeIndex}
              key={action.id}
              onPointerDown={(event) => {
                event.preventDefault();
                onSelectAction(action);
              }}
            >
              <span
                className={`capability-option-icon icon-${action.icon}`}
                aria-hidden="true"
              >
                <CapabilityIcon icon={action.icon} kind="tool" />
              </span>
              <span className="capability-option-copy">
                <strong>{action.name}</strong>
                <small>{action.description}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {loading && capabilities.length === 0 ? (
        <p className="capability-menu-empty">{t("loadingCapabilities")}</p>
      ) : empty ? (
        <p className="capability-menu-empty">{t("noMatchingCapabilities")}</p>
      ) : (
        (["tool", "skill"] as const).map((kind) => {
          const grouped = capabilities
            .map((capability, index) => ({ capability, index }))
            .filter(({ capability }) => capability.kind === kind);
          if (grouped.length === 0) return null;
          return (
            <div className="capability-group" key={kind}>
              <p className="capability-group-label">
                {kind === "tool"
                  ? t("capabilityGroupTools")
                  : t("capabilityGroupSkills")}
              </p>
              {grouped.map(({ capability, index }) => (
                <button
                  type="button"
                  id={`composer-capability-${actions.length + index}`}
                  className="capability-option"
                  role="option"
                  aria-selected={actions.length + index === activeIndex}
                  key={capability.id}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    onSelect(capability);
                  }}
                >
                  <span
                    className={`capability-option-icon icon-${capability.icon ?? capability.kind}`}
                    aria-hidden="true"
                  >
                    <CapabilityIcon
                      icon={capability.icon}
                      kind={capability.kind}
                    />
                  </span>
                  <span className="capability-option-copy">
                    <span className="capability-option-title">
                      <strong>{capability.name}</strong>
                      {capability.kind === "skill" && capability.localPath && (
                        <span
                          className="capability-option-location"
                          title={skillLocalDirectory(capability.localPath)}
                        >
                          {skillLocalDirectory(capability.localPath)}
                        </span>
                      )}
                    </span>
                    <small>{capability.description}</small>
                  </span>
                  <span className="capability-option-kind">
                    {capability.status === "needs_configuration"
                      ? t("capabilityNeedsConfiguration")
                      : capability.status === "needs_authorization"
                        ? t("capabilityNeedsAuthorization")
                        : kind === "skill"
                          ? t("capabilityKindSkill")
                          : t("capabilityKindTool")}
                  </span>
                </button>
              ))}
            </div>
          );
        })
      )}
    </MenuFrame>
  );
}

export function ConnectorSetupDialog({
  capability,
  status,
  busy,
  error,
  onCancel,
  onConnect,
  onDisconnect,
}: {
  capability: CapabilityDescriptor;
  status: ConnectorStatusData;
  busy: boolean;
  error?: string;
  onCancel(): void;
  onConnect(clientId: string, clientSecret: string): void;
  onDisconnect(): void;
}) {
  const { t } = useI18n();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const firstField = useRef<HTMLInputElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    onConnect(clientId.trim(), clientSecret);
  }

  return (
    <Dialog
      className="connector-dialog"
      aria-labelledby="connector-dialog-title"
      aria-describedby="connector-dialog-description"
      initialFocusRef={status.configured ? continueButton : firstField}
      dismissDisabled={busy}
      onClose={onCancel}
    >
      <div className="connector-dialog-heading">
        <span className="connector-dialog-icon" aria-hidden="true">
          <CapabilityIcon icon={capability.icon} kind="tool" />
        </span>
        <div>
          <h2 id="connector-dialog-title">
            {status.authorized
              ? t("manageCapabilityConnection", {
                  name: capability.name,
                })
              : t("connectCapability", { name: capability.name })}
          </h2>
          <p id="connector-dialog-description">
            {status.authorized
              ? t("connectorConnectedDescription")
              : status.configured
                ? t("connectorAuthorizationDescription")
                : t("connectorConfigurationDescription")}
          </p>
        </div>
      </div>
      <form onSubmit={submit}>
        {!status.configured && (
          <div className="connector-fields">
            <label>
              <span>{t("oauthClientId")}</span>
              <input
                ref={firstField}
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
                disabled={busy}
              />
            </label>
            <label>
              <span>{t("oauthClientSecret")}</span>
              <input
                type="password"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
                disabled={busy}
              />
            </label>
            <label>
              <span>{t("oauthRedirectUri")}</span>
              <input
                className="connector-redirect"
                value={status.redirectUrl}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <p className="connector-help">{t("connectorConfigurationHelp")}</p>
          </div>
        )}
        {status.configured && (
          <div className="connector-authorize-note">
            <p>
              {status.authorized
                ? t("connectorConnectedNotice")
                : t("connectorBrowserNotice")}
            </p>
          </div>
        )}
        {error && (
          <p className="connector-dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="connector-dialog-actions">
          {status.configured && (
            <button
              type="button"
              className="dialog-button quiet-danger pressable"
              disabled={busy}
              onClick={onDisconnect}
            >
              {t("disconnect")}
            </button>
          )}
          <button
            type="button"
            className="dialog-button secondary pressable"
            disabled={busy}
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
          {status.authorized ? (
            <button
              ref={continueButton}
              type="button"
              className="dialog-button primary pressable"
              disabled={busy}
              onClick={onCancel}
            >
              {t("done")}
            </button>
          ) : (
            <button
              ref={continueButton}
              type="submit"
              className="dialog-button primary pressable"
              disabled={
                busy ||
                (!status.configured && (!clientId.trim() || !clientSecret))
              }
            >
              {busy && <LoaderCircle className="spin" size={14} />}
              {busy
                ? t("waitingForAuthorization")
                : status.configured
                  ? t("continueToAuthorization")
                  : t("configureAndConnect")}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

function MenuFrame({
  id,
  icon,
  title,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className="capability-menu" role="listbox" aria-label={title}>
      <div className="capability-menu-heading">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

function CapabilityIcon({
  icon,
  kind,
}: {
  icon?: string;
  kind: CapabilityDescriptor["kind"];
}) {
  if (icon === "gmail") return <Mail size={14} />;
  if (icon === "documents") return <FileText size={14} />;
  if (icon === "pdf") return <FileType2 size={14} />;
  if (icon === "excel") return <Table2 size={14} />;
  if (icon === "powerpoint") return <Presentation size={14} />;
  if (icon === "computer") return <Monitor size={14} />;
  if (icon === "plan") return <ListTodo size={14} />;
  if (icon === "compact") return <Minimize2 size={14} />;
  if (icon === "attachment") return <Paperclip size={14} />;
  if (icon === "skill-creator") return <Sparkles size={14} />;
  if (icon === "plugin") return <Plug size={14} />;
  if (kind === "skill") return <Sparkles size={14} />;
  return <Wrench size={14} />;
}
