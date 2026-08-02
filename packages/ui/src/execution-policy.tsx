import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Check,
  ExternalLink,
  Eye,
  LoaderCircle,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { ConversationAccessMode } from "@threadlight/protocol";

import { useI18n, type Language } from "./i18n.js";
import {
  ActionPopover,
  anchoredPopoverPosition,
  type PopoverPosition,
} from "./popover.js";

export interface ExecutionApprovalRequest {
  requestId: string;
  projectId: string;
  projectName: string;
  threadId: string;
  runId: string;
  toolName: string;
  permissionKey: string;
  risk: "write";
  summary: string;
  detail?: string;
  external: boolean;
  /** Standalone tasks have no durable project boundary for permanent grants. */
  projectScopeAvailable?: boolean;
}

export type ExecutionApprovalScope = "once" | "task" | "project";

export interface ExecutionPolicySnapshot {
  projectId: string;
  rules: {
    read: "allow";
    write: "ask";
    destructive: "deny";
  };
  permanentGrants: readonly {
    permissionKey: string;
    label: string;
    external: boolean;
    grantedAt: string;
  }[];
}

export interface ExecutionPolicyAdapter {
  subscribe(
    listener: (request: ExecutionApprovalRequest) => void,
  ): () => void;
  subscribeResolved(listener: (requestId: string) => void): () => void;
  respond(
    requestId: string,
    decision: "allow" | "deny",
    scope: ExecutionApprovalScope,
  ): Promise<void>;
  load(projectId: string): Promise<ExecutionPolicySnapshot>;
  revoke(
    projectId: string,
    permissionKey: string,
  ): Promise<ExecutionPolicySnapshot>;
}

const copy = {
  "zh-CN": {
    title: "需要写入权限",
    external: "会访问外部服务",
    project: "项目",
    tool: "工具",
    deny: "拒绝",
    allow: "允许",
    scope: "授权范围",
    once: "允许本次",
    onceBody: "仅执行当前操作",
    task: "此任务内允许",
    taskBody: "本任务后续的同类操作",
    forever: "此项目永久允许",
    foreverBody: "此项目后续的同类操作",
    hint: "只会授权同类操作；破坏性操作始终禁止。",
    standaloneHint: "不在项目中的任务不提供跨任务永久授权。",
    safety: "安全执行",
    subtitle: "控制 Agent 在这个项目中可以执行的操作。",
    readTitle: "只读操作",
    readBody: "自动允许读取文件、查看 Diff 和查询状态。",
    writeTitle: "写入操作",
    writeBody: "执行前询问，可授权本次、此任务或此项目。",
    destructiveTitle: "破坏性操作",
    destructiveBody: "始终禁止删除、强制重置和清理仓库等操作。",
    grants: "项目永久授权",
    noGrants: "还没有永久授权。需要写入时，Threadlight 会先询问。",
    revoke: "撤销授权",
    loadError: "无法读取安全策略",
    access: "访问权限",
    requestApproval: "请求审批",
    requestApprovalBody: "写入和外部访问前询问；破坏性操作会被阻止。",
    fullAccess: "完全访问",
    fullAccessBody: "当前对话绕过安全执行，可不受限制地使用工具。",
    accessUpdateError: "无法更新当前对话的访问权限",
    respondError: "无法提交审批，请检查 Host 连接后重试。",
  },
  "zh-TW": {
    title: "需要寫入權限",
    external: "會存取外部服務",
    project: "專案",
    tool: "工具",
    deny: "拒絕",
    allow: "允許",
    scope: "授權範圍",
    once: "允許本次",
    onceBody: "只執行目前操作",
    task: "此任務內允許",
    taskBody: "此任務後續的同類操作",
    forever: "此專案永久允許",
    foreverBody: "此專案後續的同類操作",
    hint: "只會授權同類操作；破壞性操作始終禁止。",
    standaloneHint: "不在專案中的工作不提供跨工作永久授權。",
    safety: "安全執行",
    subtitle: "控制 Agent 在這個專案中可以執行的操作。",
    readTitle: "唯讀操作",
    readBody: "自動允許讀取檔案、檢視 Diff 和查詢狀態。",
    writeTitle: "寫入操作",
    writeBody: "執行前詢問，可授權本次、此任務或此專案。",
    destructiveTitle: "破壞性操作",
    destructiveBody: "始終禁止刪除、強制重設和清理倉庫等操作。",
    grants: "專案永久授權",
    noGrants: "還沒有永久授權。需要寫入時，Threadlight 會先詢問。",
    revoke: "撤銷授權",
    loadError: "無法讀取安全策略",
    access: "存取權限",
    requestApproval: "請求核准",
    requestApprovalBody: "寫入和外部存取前詢問；破壞性操作會被阻止。",
    fullAccess: "完整存取",
    fullAccessBody: "目前對話略過安全執行，可不受限制地使用工具。",
    accessUpdateError: "無法更新目前對話的存取權限",
    respondError: "無法提交核准，請檢查 Host 連線後再試。",
  },
  en: {
    title: "Write access required",
    external: "Accesses an external service",
    project: "Project",
    tool: "Tool",
    deny: "Deny",
    allow: "Allow",
    scope: "Permission scope",
    once: "Allow once",
    onceBody: "Run only this operation",
    task: "Allow for task",
    taskBody: "Similar operations in this task",
    forever: "Always allow in project",
    foreverBody: "Similar operations in this project",
    hint: "Only similar operations are granted. Destructive actions stay blocked.",
    standaloneHint: "Tasks outside a project do not offer permanent cross-task grants.",
    safety: "Safe execution",
    subtitle: "Control what the agent may do in this project.",
    readTitle: "Read-only actions",
    readBody: "Automatically allow file reads, diffs, and status checks.",
    writeTitle: "Write actions",
    writeBody: "Ask first, with once, task, and project scopes.",
    destructiveTitle: "Destructive actions",
    destructiveBody: "Always block deletion, forced resets, and repository cleanup.",
    grants: "Permanent project grants",
    noGrants: "No permanent grants yet. Threadlight asks before writing.",
    revoke: "Revoke grant",
    loadError: "Could not load the safety policy",
    access: "Access permissions",
    requestApproval: "Request approval",
    requestApprovalBody: "Ask before writes and external access; block destructive actions.",
    fullAccess: "Full access",
    fullAccessBody: "Bypass safe execution for this conversation and use tools without restrictions.",
    accessUpdateError: "Could not update this conversation's access",
    respondError: "Could not submit approval. Check the Host connection and retry.",
  },
  ja: {
    title: "書き込み権限が必要です",
    external: "外部サービスにアクセスします",
    project: "プロジェクト",
    tool: "ツール",
    deny: "拒否",
    allow: "許可",
    scope: "許可する範囲",
    once: "今回のみ許可",
    onceBody: "現在の操作のみ実行",
    task: "このタスクで許可",
    taskBody: "このタスク内の同種の操作",
    forever: "このプロジェクトで常に許可",
    foreverBody: "このプロジェクト内の同種の操作",
    hint: "同種の操作だけを許可します。破壊的操作は常に禁止されます。",
    standaloneHint: "プロジェクト外のタスクでは、タスクをまたぐ恒久的な許可は利用できません。",
    safety: "安全な実行",
    subtitle: "このプロジェクトで Agent が実行できる操作を管理します。",
    readTitle: "読み取り専用",
    readBody: "ファイルの読み取り、Diff、状態確認を自動的に許可します。",
    writeTitle: "書き込み",
    writeBody: "実行前に確認し、今回・タスク・プロジェクト単位で許可できます。",
    destructiveTitle: "破壊的操作",
    destructiveBody: "削除、強制リセット、リポジトリのクリーンを常に禁止します。",
    grants: "プロジェクトの恒久的な許可",
    noGrants: "恒久的な許可はありません。書き込み前に確認します。",
    revoke: "許可を取り消す",
    loadError: "安全ポリシーを読み込めませんでした",
    access: "アクセス権限",
    requestApproval: "承認をリクエスト",
    requestApprovalBody: "書き込みや外部アクセスの前に確認し、破壊的操作を禁止します。",
    fullAccess: "フルアクセス",
    fullAccessBody: "この会話では安全な実行を迂回し、制限なくツールを使用します。",
    accessUpdateError: "この会話のアクセス権限を更新できませんでした",
    respondError: "承認を送信できません。Host 接続を確認して再試行してください。",
  },
  ko: {
    title: "쓰기 권한 필요",
    external: "외부 서비스에 접근합니다",
    project: "프로젝트",
    tool: "도구",
    deny: "거부",
    allow: "허용",
    scope: "허용 범위",
    once: "이번만 허용",
    onceBody: "현재 작업만 실행",
    task: "이 작업에서 허용",
    taskBody: "이 작업의 유사한 작업",
    forever: "이 프로젝트에서 항상 허용",
    foreverBody: "이 프로젝트의 유사한 작업",
    hint: "같은 종류의 작업만 허용하며 파괴적 작업은 계속 차단됩니다.",
    standaloneHint: "프로젝트 외부 작업에서는 작업 간 영구 권한을 제공하지 않습니다.",
    safety: "안전한 실행",
    subtitle: "이 프로젝트에서 Agent가 수행할 수 있는 작업을 관리합니다.",
    readTitle: "읽기 전용 작업",
    readBody: "파일 읽기, Diff 및 상태 확인을 자동으로 허용합니다.",
    writeTitle: "쓰기 작업",
    writeBody: "실행 전에 묻고 이번, 작업, 프로젝트 범위로 허용합니다.",
    destructiveTitle: "파괴적 작업",
    destructiveBody: "삭제, 강제 재설정 및 저장소 정리를 항상 차단합니다.",
    grants: "프로젝트 영구 권한",
    noGrants: "영구 권한이 없습니다. 쓰기 전에 Threadlight가 묻습니다.",
    revoke: "권한 취소",
    loadError: "안전 정책을 불러올 수 없습니다",
    access: "접근 권한",
    requestApproval: "승인 요청",
    requestApprovalBody: "쓰기와 외부 접근 전에 묻고 파괴적 작업은 차단합니다.",
    fullAccess: "전체 접근",
    fullAccessBody: "이 대화에서는 안전 실행을 우회하고 제한 없이 도구를 사용합니다.",
    accessUpdateError: "이 대화의 접근 권한을 업데이트할 수 없습니다",
    respondError: "승인을 제출할 수 없습니다. Host 연결을 확인한 후 다시 시도하세요.",
  },
} satisfies Record<Language, Record<string, string>>;

export function ConversationAccessControl({
  mode,
  disabled,
  onOpen,
  onChange,
}: {
  mode: ConversationAccessMode;
  disabled?: boolean;
  onOpen?(): void;
  onChange(mode: ConversationAccessMode): void | Promise<void>;
}) {
  const { language } = useI18n();
  const labels = copy[language];
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<PopoverPosition>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function open() {
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds) return;
    onOpen?.();
    setError(undefined);
    setPosition(
      anchoredPopoverPosition(bounds, {
        width: 336,
        height: 151,
        align: "start",
      }),
    );
  }

  function close() {
    if (!busy) setPosition(undefined);
  }

  async function select(nextMode: ConversationAccessMode) {
    if (busy) return;
    if (nextMode === mode) {
      setPosition(undefined);
      trigger.current?.focus();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onChange(nextMode);
      setPosition(undefined);
      trigger.current?.focus();
    } catch {
      setError(labels.accessUpdateError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`conversation-access-trigger pressable ${mode}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
        disabled={disabled || busy}
        title={labels.access}
        onClick={() => (position ? close() : open())}
      >
        {busy ? (
          <LoaderCircle className="spin" size={15} />
        ) : mode === "full" ? (
          <ShieldAlert size={15} />
        ) : (
          <LockKeyhole size={15} />
        )}
        <span>
          {mode === "full" ? labels.fullAccess : labels.requestApproval}
        </span>
      </button>
      {position && (
        <ConversationAccessPopover
          mode={mode}
          busy={busy}
          error={error}
          position={position}
          returnFocusRef={trigger}
          onClose={close}
          onSelect={(nextMode) => void select(nextMode)}
        />
      )}
    </>
  );
}

export function ConversationAccessPopover({
  mode,
  busy = false,
  error,
  position,
  returnFocusRef,
  onClose,
  onSelect,
}: {
  mode: ConversationAccessMode;
  busy?: boolean;
  error?: string;
  position: PopoverPosition;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onSelect(mode: ConversationAccessMode): void;
}) {
  const { language } = useI18n();
  const labels = copy[language];
  const options: readonly {
    mode: ConversationAccessMode;
    icon: ReactNode;
    title: string;
    body: string;
  }[] = [
    {
      mode: "approval",
      icon: <LockKeyhole size={17} />,
      title: labels.requestApproval,
      body: labels.requestApprovalBody,
    },
    {
      mode: "full",
      icon: <ShieldAlert size={17} />,
      title: labels.fullAccess,
      body: labels.fullAccessBody,
    },
  ];

  return (
    <ActionPopover
      label={labels.access}
      className="conversation-access-popover"
      position={position}
      returnFocusRef={returnFocusRef}
      onClose={onClose}
    >
      {options.map((option) => (
        <button
          key={option.mode}
          type="button"
          className={`conversation-access-option ${option.mode}`}
          role="menuitemradio"
          aria-checked={option.mode === mode}
          data-popover-item
          disabled={busy}
          onClick={() => onSelect(option.mode)}
        >
          <span className="conversation-access-option-icon" aria-hidden="true">
            {option.icon}
          </span>
          <span className="conversation-access-option-copy">
            <strong>{option.title}</strong>
            <small>{option.body}</small>
          </span>
          {option.mode === mode ? (
            <Check
              className="conversation-access-check"
              size={16}
              aria-hidden="true"
            />
          ) : null}
        </button>
      ))}
      {error ? (
        <p className="conversation-access-error" role="alert">
          {error}
        </p>
      ) : null}
    </ActionPopover>
  );
}

export function ExecutionApprovalGate({
  adapter,
  initialRequests = [],
}: {
  adapter: ExecutionPolicyAdapter;
  initialRequests?: readonly ExecutionApprovalRequest[];
}) {
  const { language } = useI18n();
  const labels = copy[language];
  const [queue, setQueue] =
    useState<readonly ExecutionApprovalRequest[]>(initialRequests);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<ExecutionApprovalScope>("once");
  const [error, setError] = useState<string>();
  const allowButton = useRef<HTMLButtonElement>(null);
  const request = queue[0];

  useEffect(
    () =>
      adapter.subscribe((incoming) => {
        setQueue((current) =>
          current.some((item) => item.requestId === incoming.requestId)
            ? current
            : [...current, incoming],
        );
      }),
    [adapter],
  );
  useEffect(
    () =>
      adapter.subscribeResolved((requestId) => {
        setQueue((current) =>
          current.filter((item) => item.requestId !== requestId),
        );
      }),
    [adapter],
  );

  useEffect(() => {
    if (request) {
      setScope("once");
      setError(undefined);
      allowButton.current?.focus();
    }
  }, [request?.requestId]);

  if (!request) return null;
  const availableScopes: readonly ExecutionApprovalScope[] =
    request.projectScopeAvailable === false
      ? ["once", "task"]
      : ["once", "task", "project"];
  const scopeOptions = [
    ["once", labels.once, labels.onceBody],
    ["task", labels.task, labels.taskBody],
    ...(request.projectScopeAvailable === false
      ? []
      : [["project", labels.forever, labels.foreverBody] as const]),
  ] as const;

  const respond = async (
    decision: "allow" | "deny",
    scope: ExecutionApprovalScope,
  ) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await adapter.respond(request.requestId, decision, scope);
      setQueue((current) =>
        current.filter((item) => item.requestId !== request.requestId),
      );
    } catch {
      setError(labels.respondError);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void respond("deny", "once");
    }
  };

  const selectScopeWithKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: ExecutionApprovalScope,
  ) => {
    const direction =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const index = availableScopes.indexOf(current);
    const next =
      availableScopes[
        (index + direction + availableScopes.length) %
          availableScopes.length
      ]!;
    setScope(next);
    const option = event.currentTarget.parentElement?.querySelector(
      `[data-scope="${next}"]`,
    );
    if (option instanceof HTMLButtonElement) option.focus();
  };

  return (
    <div
      className="execution-approval-backdrop"
      role="presentation"
      onKeyDown={onKeyDown}
    >
      <section
        className="execution-approval-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="execution-approval-title"
        aria-describedby="execution-approval-summary"
      >
        <div className="execution-approval-heading">
          <span className="execution-approval-icon">
            <LockKeyhole size={18} />
          </span>
          <div>
            <h2 id="execution-approval-title">{labels.title}</h2>
            <p id="execution-approval-summary">{request.summary}</p>
          </div>
          {queue.length > 1 ? (
            <span className="execution-approval-count">+{queue.length - 1}</span>
          ) : null}
        </div>

        <dl className="execution-approval-meta">
          <div>
            <dt>{labels.project}</dt>
            <dd>{request.projectName}</dd>
          </div>
          <div>
            <dt>{labels.tool}</dt>
            <dd>{request.toolName}</dd>
          </div>
        </dl>
        {request.detail ? (
          <pre className="execution-approval-detail">{request.detail}</pre>
        ) : null}
        {request.external ? (
          <p className="execution-approval-external">
            <ExternalLink size={13} />
            {labels.external}
          </p>
        ) : null}
        <div className="execution-approval-scope-picker">
          <div className="execution-approval-scope-heading">
            <span>{labels.scope}</span>
            <p className="execution-approval-hint">
              {request.projectScopeAvailable === false
                ? labels.standaloneHint
                : labels.hint}
            </p>
          </div>
          <div
            className={`execution-approval-scope-options ${
              scopeOptions.length === 2 ? "two" : ""
            }`}
            role="radiogroup"
            aria-label={labels.scope}
          >
            {scopeOptions.map(([value, title, body]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={scope === value}
                data-scope={value}
                tabIndex={scope === value ? 0 : -1}
                className={`execution-approval-scope-option pressable ${
                  scope === value ? "selected" : ""
                }`}
                disabled={busy}
                onClick={() => setScope(value)}
                onKeyDown={(event) =>
                  selectScopeWithKeyboard(event, value)
                }
              >
                <span
                  className="execution-approval-radio"
                  aria-hidden="true"
                >
                  {scope === value ? <Check size={11} /> : null}
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{body}</small>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="execution-approval-actions">
          {error ? (
            <p className="execution-approval-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="dialog-button secondary pressable"
            disabled={busy}
            onClick={() => void respond("deny", "once")}
          >
            {labels.deny}
          </button>
          <button
            ref={allowButton}
            type="button"
            className="dialog-button primary execution-approval-primary pressable"
            disabled={busy}
            onClick={() => void respond("allow", scope)}
          >
            {busy ? <LoaderCircle className="spin" size={13} /> : null}
            {labels.allow}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ExecutionPolicyPage({
  adapter,
  projectId,
  projectName,
}: {
  adapter: ExecutionPolicyAdapter;
  projectId: string;
  projectName: string;
}) {
  const { language } = useI18n();
  const labels = copy[language];
  const [snapshot, setSnapshot] = useState<ExecutionPolicySnapshot>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    setSnapshot(undefined);
    setError(undefined);
    void adapter
      .load(projectId)
      .then((value) => active && setSnapshot(value))
      .catch(() => active && setError(labels.loadError));
    return () => {
      active = false;
    };
  }, [adapter, labels.loadError, projectId]);

  return (
    <div className="execution-policy-page">
      <header className="execution-policy-header">
        <span className="execution-policy-header-icon">
          <ShieldCheck size={20} />
        </span>
        <div>
          <h1>{labels.safety}</h1>
          <p>
            {projectName} · {labels.subtitle}
          </p>
        </div>
      </header>

      <div className="execution-policy-rules">
        <PolicyRule
          icon={<Eye size={16} />}
          tone="safe"
          title={labels.readTitle}
          body={labels.readBody}
        />
        <PolicyRule
          icon={<LockKeyhole size={16} />}
          tone="ask"
          title={labels.writeTitle}
          body={labels.writeBody}
        />
        <PolicyRule
          icon={<ShieldCheck size={16} />}
          tone="blocked"
          title={labels.destructiveTitle}
          body={labels.destructiveBody}
        />
      </div>

      <section className="execution-policy-grants">
        <h2>{labels.grants}</h2>
        {error ? <p className="settings-error">{error}</p> : null}
        {snapshot && snapshot.permanentGrants.length === 0 ? (
          <p className="execution-policy-empty">{labels.noGrants}</p>
        ) : null}
        {snapshot?.permanentGrants.map((grant) => (
          <div className="execution-policy-grant" key={grant.permissionKey}>
            <span className="execution-policy-grant-check">
              <Check size={14} />
            </span>
            <div>
              <strong>{grant.label}</strong>
              <code>{grant.permissionKey}</code>
            </div>
            <button
              type="button"
              className="icon-button pressable"
              aria-label={`${labels.revoke}: ${grant.label}`}
              title={labels.revoke}
              onClick={() =>
                void adapter
                  .revoke(projectId, grant.permissionKey)
                  .then(setSnapshot)
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

function PolicyRule({
  icon,
  tone,
  title,
  body,
}: {
  icon: ReactNode;
  tone: "safe" | "ask" | "blocked";
  title: string;
  body: string;
}) {
  return (
    <article className={`execution-policy-rule ${tone}`}>
      <span>{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </article>
  );
}
