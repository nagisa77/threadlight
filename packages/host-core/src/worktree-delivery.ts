import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { isBinaryFileContent } from "./file-preview.js";
import {
  type ConversationChangeTracker,
  type ConversationDeliveryFile,
} from "./conversation-changes.js";
import type { GitTaskWorkspace } from "./task-workspace.js";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const DELIVERY_JOURNAL_VERSION = 1;
const MAX_DELIVERY_JOURNAL_BYTES = 256 * 1024 * 1024;
const MAX_DELIVERY_HISTORY_ENTRIES = 100;

type GitRunner = (
  cwd: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;
type TextMerger = (
  target: Buffer,
  baseline: Buffer,
  task: Buffer,
) => Promise<{ content: Buffer; conflict: boolean }>;

export interface WorktreeDeliveryRequest {
  projectId: string;
  threadId: string;
  revision: string;
  projectPath: string;
  workspace: GitTaskWorkspace;
}

export type WorktreeDeliveryJournalTarget = Pick<
  WorktreeDeliveryRequest,
  "projectId" | "threadId" | "projectPath"
>;

export interface WorktreeDeliveryConflict {
  path: string;
  reason:
    | "both_added"
    | "target_deleted"
    | "target_modified"
    | "merge_conflict"
    | "unsafe_target";
}

export interface WorktreeDeliveryPreflight {
  taskBranch: string;
  targetBranch: string;
  sourceBranch?: string;
  branchChanged: boolean;
  files: number;
  pendingFiles: number;
  alreadyAppliedFiles: number;
  localOnlyFiles: number;
  conflicts: readonly WorktreeDeliveryConflict[];
}

export interface WorktreeDeliveryResult extends WorktreeDeliveryPreflight {
  appliedFiles: number;
  commit?: string;
  undoAvailable?: boolean;
}

export interface WorktreeDeliveryUndoResult {
  targetBranch: string;
  revertedFiles: number;
  revision: string;
}

export interface WorktreeDeliveryHistoryEntry {
  id: string;
  createdAt: string;
  revision: string;
  status: "synced" | "conflict" | "failed" | "undone";
  taskBranch?: string;
  targetBranch?: string;
  files?: number;
  appliedFiles?: number;
  revertedFiles?: number;
  commit?: string;
  undoAvailable?: boolean;
  conflicts?: readonly WorktreeDeliveryConflict[];
  error?: string;
}

export interface WorktreeDeliveryHistorySnapshot {
  projectId: string;
  threadId: string;
  targetBranch?: string;
  currentRevision?: string;
  synchronizedFiles: number;
  undoPoint?: {
    revision: string;
    previousRevision?: string;
    files: readonly string[];
    createdAt?: string;
  };
  entries: readonly WorktreeDeliveryHistoryEntry[];
}

export interface AutomaticWorktreeDeliveryState {
  revision: string;
  status: "syncing" | "synced" | "conflict" | "failed";
  result?: WorktreeDeliveryResult;
  preflight?: WorktreeDeliveryPreflight;
  error?: string;
}

interface DeliveryOperation {
  path: string;
  targetPath: string;
  expectedContent?: Buffer;
  content?: Buffer;
  mode?: number;
  alreadyApplied: boolean;
  localOnly: boolean;
  conflict?: WorktreeDeliveryConflict;
}

interface TargetBackup {
  path: string;
  content?: Buffer;
  mode?: number;
}

interface SynchronizedFile {
  path: string;
  binary: boolean;
  localOnly: boolean;
  initialContent?: Buffer;
  initialMode?: number;
  taskContent?: Buffer;
  taskMode?: number;
}

interface UndoOperation extends TargetBackup {
  appliedContent?: Buffer;
  appliedMode?: number;
}

interface SynchronizationState {
  revision: string;
  files: ReadonlyMap<string, SynchronizedFile>;
  undo?: {
    previousRevision?: string;
    previousFiles: ReadonlyMap<string, SynchronizedFile>;
    operations: readonly UndoOperation[];
  };
}

interface DeliveryTransitionOperation {
  path: string;
  beforeContent?: Buffer;
  beforeMode?: number;
  afterContent?: Buffer;
  afterMode?: number;
}

interface SerializedSynchronizedFile {
  path: string;
  binary: boolean;
  localOnly: boolean;
  initialContent?: string;
  initialMode?: number;
  taskContent?: string;
  taskMode?: number;
}

interface SerializedUndoOperation {
  path: string;
  content?: string;
  mode?: number;
  appliedContent?: string;
  appliedMode?: number;
}

interface SerializedSynchronizationState {
  revision: string;
  files: readonly SerializedSynchronizedFile[];
  undo?: {
    previousRevision?: string;
    previousFiles: readonly SerializedSynchronizedFile[];
    operations: readonly SerializedUndoOperation[];
  };
}

interface SerializedTransitionOperation {
  path: string;
  beforeContent?: string;
  beforeMode?: number;
  afterContent?: string;
  afterMode?: number;
}

interface DeliveryJournal {
  version: typeof DELIVERY_JOURNAL_VERSION;
  projectId: string;
  threadId: string;
  committed?: SerializedSynchronizationState;
  pending?: {
    next?: SerializedSynchronizationState;
    operations: readonly SerializedTransitionOperation[];
  };
  history?: readonly WorktreeDeliveryHistoryEntry[];
}

export interface WorktreeDeliveryManagerOptions {
  runGit?: GitRunner;
  mergeText?: TextMerger;
}

export class WorktreeDeliveryManager {
  private readonly runGit: GitRunner;
  private readonly mergeText: TextMerger;
  private readonly operationQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly changes: ConversationChangeTracker,
    options: WorktreeDeliveryManagerOptions = {},
  ) {
    this.runGit = options.runGit ?? runGit;
    this.mergeText = options.mergeText ?? mergeTextWithGit;
  }

  async preflight(
    request: WorktreeDeliveryRequest,
  ): Promise<WorktreeDeliveryPreflight> {
    return this.exclusive(
      request,
      async () => (await this.plan(request)).preflight,
    );
  }

  async apply(
    request: WorktreeDeliveryRequest,
  ): Promise<WorktreeDeliveryResult> {
    return this.exclusive(request, async () => {
      const result = await this.applyLocked(request);
      await appendHistory(request, historyFromResult(request.revision, result));
      return result;
    });
  }

  private async applyLocked(
    request: WorktreeDeliveryRequest,
  ): Promise<WorktreeDeliveryResult> {
    const plan = await this.plan(request);
    assertReady(plan.preflight);
    return this.applyPlan(request, plan);
  }

  private async applyPlan(
    request: WorktreeDeliveryRequest,
    plan: Awaited<ReturnType<WorktreeDeliveryManager["plan"]>>,
  ): Promise<WorktreeDeliveryResult> {
    const pending = plan.operations.filter(
      (operation) => !operation.alreadyApplied,
    );
    const backups = await operationBackups(request.projectPath, pending);
    const previous = plan.previousState;
    if (
      previous?.revision === request.revision &&
      pending.length === 0
    ) {
      return {
        ...plan.preflight,
        pendingFiles: 0,
        appliedFiles: previous.undo?.operations.length ?? 0,
        undoAvailable: !!previous.undo,
      };
    }
    const nextState: SynchronizationState = {
      revision: request.revision,
      files: plan.nextFiles,
      ...(pending.length > 0
        ? {
            undo: {
              previousRevision: previous?.revision,
              previousFiles: previous?.files ?? new Map(),
              operations: pending.map((operation, index) => ({
                ...backups[index]!,
                appliedContent: operation.content,
                appliedMode: operation.mode,
              })),
            },
          }
        : {}),
    };
    const transitions = pending.map((operation, index) => ({
      path: operation.path,
      beforeContent: backups[index]!.content,
      beforeMode: backups[index]!.mode,
      afterContent: operation.content,
      afterMode: operation.mode,
    } satisfies DeliveryTransitionOperation));
    await prepareJournal(request, previous, nextState, transitions);
    try {
      await applyOperations(request.projectPath, pending, backups);
    } catch (error) {
      await finalizeJournal(request, previous).catch(() => undefined);
      throw error;
    }
    await finalizeJournal(request, nextState);
    return {
      ...deliveredResult(plan.preflight, pending.length),
      undoAvailable: pending.length > 0,
    };
  }

  async undo(
    request: WorktreeDeliveryRequest,
  ): Promise<WorktreeDeliveryUndoResult> {
    return this.exclusive(request, () => this.undoLocked(request));
  }

  private async undoLocked(
    request: WorktreeDeliveryRequest,
  ): Promise<WorktreeDeliveryUndoResult> {
    assertWorktreeRequest(request);
    const state = await loadSynchronizationState(request);
    if (!state?.undo || state.revision !== request.revision) {
      throw new Error("There is no automatic application to undo");
    }
    const targetBranch = await currentBranch(
      request.workspace.repositoryRoot,
      this.runGit,
    );
    if (
      request.workspace.sourceBranch &&
      request.workspace.sourceBranch !== targetBranch
    ) {
      throw new Error(
        `The original worktree is now on ${targetBranch}, but this task started from ${request.workspace.sourceBranch}. Switch back before undoing.`,
      );
    }
    await assertUndoTargets(request.projectPath, state.undo.operations);
    const currentBackups = await Promise.all(
      state.undo.operations.map(async ({ path }) => {
        const current = await readTarget(request.projectPath, path);
        return { path, content: current.content, mode: current.mode };
      }),
    );
    const previousState = previousSynchronizationState(state);
    const transitions = state.undo.operations.map((operation) => ({
      path: journalRelativePath(request.projectPath, operation.path),
      beforeContent: operation.appliedContent,
      beforeMode: operation.appliedMode,
      afterContent: operation.content,
      afterMode: operation.mode,
    } satisfies DeliveryTransitionOperation));
    await prepareJournal(request, state, previousState, transitions);
    try {
      for (const operation of state.undo.operations) {
        await restoreBackup(operation);
      }
    } catch (error) {
      await Promise.all(currentBackups.map(restoreBackup));
      await finalizeJournal(request, state).catch(() => undefined);
      throw error;
    }
    await finalizeJournal(request, previousState);
    const result = {
      targetBranch,
      revertedFiles: state.undo.operations.length,
      revision: request.revision,
    };
    await appendHistory(request, {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      revision: request.revision,
      status: "undone",
      targetBranch,
      revertedFiles: result.revertedFiles,
    });
    return result;
  }

  async history(
    request: WorktreeDeliveryJournalTarget,
  ): Promise<WorktreeDeliveryHistorySnapshot> {
    return this.exclusive(request, async () => {
      await loadSynchronizationState(request);
      const journal = await readJournal(request);
      const state = journal?.committed
        ? deserializeSynchronizationState(request, journal.committed)
        : undefined;
      const entries = journal?.history ?? [];
      const latestWithTarget = [...entries]
        .reverse()
        .find((entry) => entry.targetBranch);
      const latestForRevision = state
        ? [...entries]
            .reverse()
            .find(
              (entry) =>
                entry.status === "synced" &&
                entry.revision === state.revision,
            )
        : undefined;
      return {
        projectId: request.projectId,
        threadId: request.threadId,
        ...(latestWithTarget?.targetBranch
          ? { targetBranch: latestWithTarget.targetBranch }
          : {}),
        ...(state ? { currentRevision: state.revision } : {}),
        synchronizedFiles: state?.files.size ?? 0,
        ...(state?.undo
          ? {
              undoPoint: {
                revision: state.revision,
                ...(state.undo.previousRevision
                  ? { previousRevision: state.undo.previousRevision }
                  : {}),
                files: state.undo.operations.map((operation) =>
                  journalRelativePath(request.projectPath, operation.path),
                ),
                ...(latestForRevision
                  ? { createdAt: latestForRevision.createdAt }
                  : {}),
              },
            }
          : {}),
        entries,
      };
    });
  }

  async hasLegacyNoChangesFailure(
    target: WorktreeDeliveryJournalTarget,
  ): Promise<boolean> {
    return this.exclusive(target, async () => {
      const journal = await readJournal(target);
      const latest = journal?.history?.at(-1);
      return (
        latest?.status === "failed" &&
        latest.error === "This task has no changes to deliver"
      );
    });
  }

  async recordFailure(
    request: WorktreeDeliveryRequest,
    error: string,
    preflight?: WorktreeDeliveryPreflight,
  ): Promise<void> {
    await this.exclusive(request, () =>
      appendHistory(request, {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        revision: request.revision,
        status: preflight?.conflicts.length ? "conflict" : "failed",
        ...(preflight?.taskBranch ? { taskBranch: preflight.taskBranch } : {}),
        ...(preflight?.targetBranch
          ? { targetBranch: preflight.targetBranch }
          : {}),
        ...(preflight ? { files: preflight.files } : {}),
        ...(preflight?.conflicts.length
          ? { conflicts: preflight.conflicts }
          : {}),
        error: error.slice(0, 32_768),
      }),
    );
  }

  async commit(
    request: WorktreeDeliveryRequest,
    message: string,
  ): Promise<WorktreeDeliveryResult> {
    return this.exclusive(request, () => this.commitLocked(request, message));
  }

  async deleteJournal(
    target: WorktreeDeliveryJournalTarget,
  ): Promise<void> {
    await this.exclusive(target, () => removeJournal(target));
  }

  private async commitLocked(
    request: WorktreeDeliveryRequest,
    message: string,
  ): Promise<WorktreeDeliveryResult> {
    const commitMessage = message.trim();
    if (!commitMessage) throw new Error("Commit message cannot be empty");

    const plan = await this.plan(request);
    assertReady(plan.preflight);
    const committable = plan.operations.filter(
      (operation) => !operation.localOnly,
    );
    if (committable.length === 0) {
      throw new Error(
        plan.preflight.files === 0
          ? "This task has no changes to commit."
          : "This task only changed local data ignored by Git. Apply it to the original workspace without creating a commit.",
      );
    }
    const newlyAppliedFiles = plan.operations.filter(
      (operation) => !operation.alreadyApplied,
    ).length;
    const applied = await this.applyPlan(request, plan);

    const paths = [
      ...new Set(
        committable.map(({ targetPath }) =>
          gitPath(request.workspace.repositoryRoot, targetPath),
        ),
      ),
    ];
    try {
      await this.runGit(request.workspace.repositoryRoot, [
        "add",
        "-A",
        "--",
        ...paths,
      ]);
      await this.runGit(request.workspace.repositoryRoot, [
        "commit",
        "--only",
        "-m",
        commitMessage,
        "--",
        ...paths,
      ]);
    } catch (error) {
      throw new Error(
        `Changes were applied to ${plan.preflight.targetBranch}, but Git could not create the commit: ${errorMessage(error)}`,
      );
    }
    const { stdout } = await this.runGit(request.workspace.repositoryRoot, [
      "rev-parse",
      "HEAD",
    ]);
    const result = {
      ...applied,
      appliedFiles: newlyAppliedFiles,
      commit: stdout.trim(),
    };
    await appendHistory(request, historyFromResult(request.revision, result));
    return result;
  }

  private async plan(request: WorktreeDeliveryRequest): Promise<{
    operations: readonly DeliveryOperation[];
    preflight: WorktreeDeliveryPreflight;
    nextFiles: ReadonlyMap<string, SynchronizedFile>;
    previousState?: SynchronizationState;
  }> {
    assertWorktreeRequest(request);
    const currentFiles = await this.changes.deliveryFiles(
      request.projectId,
      request.threadId,
      request.workspace.path,
      request.revision,
    );
    const previous = await loadSynchronizationState(request);
    const { files, nextFiles } = incrementalDeliveryFiles(
      currentFiles,
      previous?.files,
    );

    const targetBranch = await currentBranch(
      request.workspace.repositoryRoot,
      this.runGit,
    );
    const submodulePaths = await this.gitSubmodulePaths(
      request.projectPath,
      request.workspace.repositoryRoot,
    );
    const operations = await Promise.all(
      files.map((file) =>
        planFile(file, request.projectPath, this.mergeText, submodulePaths),
      ),
    );
    const conflicts = operations.flatMap(({ conflict }) =>
      conflict ? [conflict] : [],
    );
    const alreadyAppliedFiles = operations.filter(
      ({ alreadyApplied }) => alreadyApplied,
    ).length;
    const sourceBranch = request.workspace.sourceBranch;
    return {
      operations,
      nextFiles,
      ...(previous ? { previousState: previous } : {}),
      preflight: {
        taskBranch: request.workspace.branch,
        targetBranch,
        ...(sourceBranch ? { sourceBranch } : {}),
        branchChanged: Boolean(
          sourceBranch && sourceBranch !== targetBranch,
        ),
        files: operations.length,
        pendingFiles: operations.length - alreadyAppliedFiles,
        alreadyAppliedFiles,
        localOnlyFiles: operations.filter(({ localOnly }) => localOnly).length,
        conflicts,
      },
    };
  }

  private async gitSubmodulePaths(
    projectPath: string,
    repositoryRoot: string,
  ): Promise<ReadonlySet<string>> {
    try {
      const { stdout } = await this.runGit(repositoryRoot, [
        "ls-files",
        "-z",
        "--stage",
        "--full-name",
      ]);
      const prefix = relative(repositoryRoot, resolve(projectPath));
      const paths = new Set<string>();
      for (const record of stdout.split("\0").filter(Boolean)) {
        const tab = record.indexOf("\t");
        if (tab === -1) continue;
        if (record.slice(0, tab).split(" ")[0] !== "160000") continue;
        const path = record.slice(tab + 1);
        if (prefix === "") {
          paths.add(path);
        } else if (path.startsWith(`${prefix}/`)) {
          paths.add(path.slice(prefix.length + 1));
        }
      }
      return paths;
    } catch {
      return new Set();
    }
  }

  private async exclusive<Result>(
    request: WorktreeDeliveryJournalTarget,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const key = synchronizationKey(request);
    const previous = this.operationQueues.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const queued = previous.catch(() => undefined).then(() => gate);
    this.operationQueues.set(key, queued);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.operationQueues.get(key) === queued) {
        this.operationQueues.delete(key);
      }
    }
  }
}

export async function applyAutomaticWorktreeDelivery(
  manager: WorktreeDeliveryManager,
  request: WorktreeDeliveryRequest,
  onState: (state: AutomaticWorktreeDeliveryState) => void,
): Promise<WorktreeDeliveryResult> {
  reportAutomaticDeliveryState(onState, {
    revision: request.revision,
    status: "syncing",
  });
  try {
    const result = await manager.apply(request);
    reportAutomaticDeliveryState(onState, {
      revision: request.revision,
      status: "synced",
      result,
    });
    return result;
  } catch (error) {
    let preflight: WorktreeDeliveryPreflight | undefined;
    try {
      preflight = await manager.preflight(request);
    } catch {
      // Preserve the original delivery error when preflight cannot be refreshed.
    }
    const conflict = Boolean(preflight?.conflicts.length);
    const message = errorMessage(error);
    await manager.recordFailure(request, message, preflight).catch(() => {
      // Persisting diagnostics must not replace the original delivery error.
    });
    reportAutomaticDeliveryState(onState, {
      revision: request.revision,
      status: conflict ? "conflict" : "failed",
      ...(preflight ? { preflight } : {}),
      error: message,
    });
    throw error;
  }
}

function historyFromResult(
  revision: string,
  result: WorktreeDeliveryResult,
): WorktreeDeliveryHistoryEntry {
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    revision,
    status: "synced",
    taskBranch: result.taskBranch,
    targetBranch: result.targetBranch,
    files: result.files,
    appliedFiles: result.appliedFiles,
    ...(result.commit ? { commit: result.commit } : {}),
    ...(result.undoAvailable !== undefined
      ? { undoAvailable: result.undoAvailable }
      : {}),
  };
}

function reportAutomaticDeliveryState(
  onState: (state: AutomaticWorktreeDeliveryState) => void,
  state: AutomaticWorktreeDeliveryState,
): void {
  try {
    onState(state);
  } catch {
    // A disconnected observer must not change the delivery outcome.
  }
}

function previousSynchronizationState(
  state: SynchronizationState,
): SynchronizationState | undefined {
  if (!state.undo) return;
  if (!state.undo.previousRevision && state.undo.previousFiles.size === 0) {
    return;
  }
  return {
    revision: state.undo.previousRevision ?? "",
    files: state.undo.previousFiles,
  };
}

async function loadSynchronizationState(
  request: WorktreeDeliveryJournalTarget,
): Promise<SynchronizationState | undefined> {
  const journal = await readJournal(request);
  if (!journal) return;
  const committed = journal.committed
    ? deserializeSynchronizationState(request, journal.committed)
    : undefined;
  if (!journal.pending) return committed;

  const next = journal.pending.next
    ? deserializeSynchronizationState(request, journal.pending.next)
    : undefined;
  const operations = journal.pending.operations.map((operation) =>
    deserializeTransitionOperation(request, operation),
  );
  if (operations.length === 0) {
    await finalizeJournal(request, next);
    return next;
  }

  const positions = await Promise.all(
    operations.map(async (operation) => {
      const targetPath = safeTargetPath(request.projectPath, operation.path);
      const target = await readTarget(request.projectPath, targetPath);
      if (target.unsafe) return "changed" as const;
      const before = targetMatches(
        target,
        operation.beforeContent,
        operation.beforeMode,
      );
      const after = targetMatches(
        target,
        operation.afterContent,
        operation.afterMode,
      );
      if (after && !before) return "after" as const;
      if (before) return "before" as const;
      return "changed" as const;
    }),
  );
  if (positions.every((position) => position === "after")) {
    await finalizeJournal(request, next);
    return next;
  }
  if (positions.some((position) => position === "changed")) {
    throw new Error(
      "The automatic delivery journal could not be recovered because the original workspace changed during restart.",
    );
  }
  if (positions.some((position) => position === "after")) {
    for (const operation of operations) {
      await restoreBackup({
        path: safeTargetPath(request.projectPath, operation.path),
        content: operation.beforeContent,
        mode: operation.beforeMode,
      });
    }
  }
  await finalizeJournal(request, committed);
  return committed;
}

async function prepareJournal(
  request: WorktreeDeliveryRequest,
  committed: SynchronizationState | undefined,
  next: SynchronizationState | undefined,
  operations: readonly DeliveryTransitionOperation[],
): Promise<void> {
  const history = (await readJournal(request))?.history;
  await writeJournal(request, {
    version: DELIVERY_JOURNAL_VERSION,
    projectId: request.projectId,
    threadId: request.threadId,
    ...(committed
      ? { committed: serializeSynchronizationState(request, committed) }
      : {}),
    pending: {
      ...(next
        ? { next: serializeSynchronizationState(request, next) }
        : {}),
      operations: operations.map(serializeTransitionOperation),
    },
    ...(history?.length ? { history } : {}),
  });
}

async function finalizeJournal(
  request: WorktreeDeliveryJournalTarget,
  state: SynchronizationState | undefined,
): Promise<void> {
  const history = (await readJournal(request))?.history;
  if (!state) {
    if (history?.length) {
      await writeJournal(request, {
        version: DELIVERY_JOURNAL_VERSION,
        projectId: request.projectId,
        threadId: request.threadId,
        history,
      });
    } else {
      await removeJournal(request);
    }
    return;
  }
  await writeJournal(request, {
    version: DELIVERY_JOURNAL_VERSION,
    projectId: request.projectId,
    threadId: request.threadId,
    committed: serializeSynchronizationState(request, state),
    ...(history?.length ? { history } : {}),
  });
}

async function appendHistory(
  request: WorktreeDeliveryJournalTarget,
  entry: WorktreeDeliveryHistoryEntry,
): Promise<void> {
  const journal = await readJournal(request);
  const history = [...(journal?.history ?? []), entry].slice(
    -MAX_DELIVERY_HISTORY_ENTRIES,
  );
  await writeJournal(request, {
    version: DELIVERY_JOURNAL_VERSION,
    projectId: request.projectId,
    threadId: request.threadId,
    ...(journal?.committed ? { committed: journal.committed } : {}),
    ...(journal?.pending ? { pending: journal.pending } : {}),
    history,
  });
}

function serializeSynchronizationState(
  request: WorktreeDeliveryJournalTarget,
  state: SynchronizationState,
): SerializedSynchronizationState {
  return {
    revision: state.revision,
    files: [...state.files.values()].map(serializeSynchronizedFile),
    ...(state.undo
      ? {
          undo: {
            ...(state.undo.previousRevision
              ? { previousRevision: state.undo.previousRevision }
              : {}),
            previousFiles: [...state.undo.previousFiles.values()].map(
              serializeSynchronizedFile,
            ),
            operations: state.undo.operations.map((operation) => ({
              path: journalRelativePath(request.projectPath, operation.path),
              ...(operation.content !== undefined
                ? { content: encodeBuffer(operation.content) }
                : {}),
              ...(operation.mode !== undefined ? { mode: operation.mode } : {}),
              ...(operation.appliedContent !== undefined
                ? { appliedContent: encodeBuffer(operation.appliedContent) }
                : {}),
              ...(operation.appliedMode !== undefined
                ? { appliedMode: operation.appliedMode }
                : {}),
            })),
          },
        }
      : {}),
  };
}

function deserializeSynchronizationState(
  request: WorktreeDeliveryJournalTarget,
  state: SerializedSynchronizationState,
): SynchronizationState {
  const files = state.files.map(deserializeSynchronizedFile);
  const previousFiles = state.undo?.previousFiles.map(
    deserializeSynchronizedFile,
  );
  return {
    revision: state.revision,
    files: new Map(files.map((file) => [file.path, file])),
    ...(state.undo
      ? {
          undo: {
            ...(state.undo.previousRevision
              ? { previousRevision: state.undo.previousRevision }
              : {}),
            previousFiles: new Map(
              (previousFiles ?? []).map((file) => [file.path, file]),
            ),
            operations: state.undo.operations.map((operation) => ({
              path: safeTargetPath(request.projectPath, operation.path),
              ...(operation.content !== undefined
                ? { content: decodeBuffer(operation.content) }
                : {}),
              ...(operation.mode !== undefined ? { mode: operation.mode } : {}),
              ...(operation.appliedContent !== undefined
                ? { appliedContent: decodeBuffer(operation.appliedContent) }
                : {}),
              ...(operation.appliedMode !== undefined
                ? { appliedMode: operation.appliedMode }
                : {}),
            })),
          },
        }
      : {}),
  };
}

function serializeSynchronizedFile(
  file: SynchronizedFile,
): SerializedSynchronizedFile {
  return {
    path: normalizeJournalPath(file.path),
    binary: file.binary,
    localOnly: file.localOnly,
    ...(file.initialContent !== undefined
      ? { initialContent: encodeBuffer(file.initialContent) }
      : {}),
    ...(file.initialMode !== undefined ? { initialMode: file.initialMode } : {}),
    ...(file.taskContent !== undefined
      ? { taskContent: encodeBuffer(file.taskContent) }
      : {}),
    ...(file.taskMode !== undefined ? { taskMode: file.taskMode } : {}),
  };
}

function deserializeSynchronizedFile(
  file: SerializedSynchronizedFile,
): SynchronizedFile {
  return {
    path: normalizeJournalPath(file.path),
    binary: file.binary,
    localOnly: file.localOnly,
    ...(file.initialContent !== undefined
      ? { initialContent: decodeBuffer(file.initialContent) }
      : {}),
    ...(file.initialMode !== undefined ? { initialMode: file.initialMode } : {}),
    ...(file.taskContent !== undefined
      ? { taskContent: decodeBuffer(file.taskContent) }
      : {}),
    ...(file.taskMode !== undefined ? { taskMode: file.taskMode } : {}),
  };
}

function serializeTransitionOperation(
  operation: DeliveryTransitionOperation,
): SerializedTransitionOperation {
  return {
    path: normalizeJournalPath(operation.path),
    ...(operation.beforeContent !== undefined
      ? { beforeContent: encodeBuffer(operation.beforeContent) }
      : {}),
    ...(operation.beforeMode !== undefined
      ? { beforeMode: operation.beforeMode }
      : {}),
    ...(operation.afterContent !== undefined
      ? { afterContent: encodeBuffer(operation.afterContent) }
      : {}),
    ...(operation.afterMode !== undefined
      ? { afterMode: operation.afterMode }
      : {}),
  };
}

function deserializeTransitionOperation(
  request: WorktreeDeliveryJournalTarget,
  operation: SerializedTransitionOperation,
): DeliveryTransitionOperation {
  const path = normalizeJournalPath(operation.path);
  safeTargetPath(request.projectPath, path);
  return {
    path,
    ...(operation.beforeContent !== undefined
      ? { beforeContent: decodeBuffer(operation.beforeContent) }
      : {}),
    ...(operation.beforeMode !== undefined
      ? { beforeMode: operation.beforeMode }
      : {}),
    ...(operation.afterContent !== undefined
      ? { afterContent: decodeBuffer(operation.afterContent) }
      : {}),
    ...(operation.afterMode !== undefined
      ? { afterMode: operation.afterMode }
      : {}),
  };
}

async function readJournal(
  request: WorktreeDeliveryJournalTarget,
): Promise<DeliveryJournal | undefined> {
  const path = deliveryJournalPath(request);
  await assertSafeJournalPath(request.projectPath, path);
  let metadata;
  try {
    metadata = await stat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  if (!metadata.isFile() || metadata.size > MAX_DELIVERY_JOURNAL_BYTES) {
    throw new Error("The automatic delivery journal is invalid or too large.");
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("The automatic delivery journal is invalid.");
  }
  validateJournal(value, request);
  return value;
}

async function writeJournal(
  request: WorktreeDeliveryJournalTarget,
  journal: DeliveryJournal,
): Promise<void> {
  const path = deliveryJournalPath(request);
  const content = `${JSON.stringify(journal)}\n`;
  if (Buffer.byteLength(content) > MAX_DELIVERY_JOURNAL_BYTES) {
    throw new Error(
      "The automatic delivery journal is too large to persist safely.",
    );
  }
  await assertSafeJournalPath(request.projectPath, path);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  await assertSafeJournalPath(request.projectPath, path);
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, content, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function removeJournal(
  request: WorktreeDeliveryJournalTarget,
): Promise<void> {
  const path = deliveryJournalPath(request);
  await assertSafeJournalPath(request.projectPath, path);
  await rm(path, { force: true });
}

function deliveryJournalPath(
  request: WorktreeDeliveryJournalTarget,
): string {
  const id = createHash("sha256")
    .update(request.projectId)
    .update("\0")
    .update(request.threadId)
    .digest("hex");
  return safeTargetPath(
    request.projectPath,
    join(".threadlight", "delivery-journal", `${id}.json`),
  );
}

async function assertSafeJournalPath(
  projectPath: string,
  path: string,
): Promise<void> {
  if (!isInside(projectPath, path)) {
    throw new Error("The automatic delivery journal escapes the project.");
  }
  const root = resolve(projectPath);
  const parts = relative(root, path).split(sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]!);
    try {
      const metadata = await lstat(current);
      const final = index === parts.length - 1;
      if (
        metadata.isSymbolicLink() ||
        (final ? !metadata.isFile() : !metadata.isDirectory())
      ) {
        throw new Error("The automatic delivery journal path is unsafe.");
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }
  }
}

function journalRelativePath(projectPath: string, path: string): string {
  if (!isInside(projectPath, path)) {
    throw new Error("The automatic delivery journal contains an unsafe path.");
  }
  return normalizeJournalPath(relative(resolve(projectPath), resolve(path)));
}

function normalizeJournalPath(path: string): string {
  const normalized = path.split("\\").join("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("The automatic delivery journal contains an unsafe path.");
  }
  return normalized;
}

function encodeBuffer(value: Buffer): string {
  return value.toString("base64");
}

function decodeBuffer(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error("The automatic delivery journal contains invalid data.");
  }
  return decoded;
}

function targetMatches(
  target: { content?: Buffer; mode?: number },
  content: Buffer | undefined,
  mode: number | undefined,
): boolean {
  if (!buffersEqual(target.content, content)) return false;
  if (content === undefined || mode === undefined) return true;
  return target.mode !== undefined &&
    (target.mode & 0o777) === (mode & 0o777);
}

function validateJournal(
  value: unknown,
  request: WorktreeDeliveryJournalTarget,
): asserts value is DeliveryJournal {
  if (!isRecord(value) ||
    value.version !== DELIVERY_JOURNAL_VERSION ||
    value.projectId !== request.projectId ||
    value.threadId !== request.threadId ||
    (value.committed !== undefined && !validSerializedState(value.committed)) ||
    (value.pending !== undefined && !validPendingJournal(value.pending)) ||
    (value.history !== undefined && !validHistory(value.history))
  ) {
    throw new Error("The automatic delivery journal is invalid.");
  }
}

function validHistory(value: unknown): boolean {
  return Array.isArray(value) &&
    value.length <= MAX_DELIVERY_HISTORY_ENTRIES &&
    value.every(validHistoryEntry);
}

function validHistoryEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" || value.id.length > 128 ||
    typeof value.createdAt !== "string" || value.createdAt.length > 64 ||
    typeof value.revision !== "string" || value.revision.length > 512 ||
    !["synced", "conflict", "failed", "undone"].includes(
      value.status as string,
    )
  ) {
    return false;
  }
  const shortString = (candidate: unknown, max = 8_192) =>
    candidate === undefined ||
    (typeof candidate === "string" && candidate.length <= max);
  const count = (candidate: unknown) =>
    candidate === undefined ||
    (typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= 0);
  return shortString(value.taskBranch, 512) &&
    shortString(value.targetBranch, 512) &&
    count(value.files) &&
    count(value.appliedFiles) &&
    count(value.revertedFiles) &&
    shortString(value.commit, 512) &&
    (value.undoAvailable === undefined ||
      typeof value.undoAvailable === "boolean") &&
    (value.conflicts === undefined ||
      (Array.isArray(value.conflicts) &&
        value.conflicts.every(validDeliveryConflict))) &&
    shortString(value.error, 32_768);
}

function validDeliveryConflict(value: unknown): boolean {
  return isRecord(value) &&
    validPath(value.path) &&
    [
      "both_added",
      "target_deleted",
      "target_modified",
      "merge_conflict",
      "unsafe_target",
    ].includes(value.reason as string);
}

function validPendingJournal(value: unknown): boolean {
  return isRecord(value) &&
    (value.next === undefined || validSerializedState(value.next)) &&
    Array.isArray(value.operations) &&
    value.operations.every(validTransitionOperation);
}

function validSerializedState(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.revision === "string" &&
    value.revision.length <= 512 &&
    Array.isArray(value.files) &&
    value.files.every(validSynchronizedFile) &&
    (value.undo === undefined || validSerializedUndo(value.undo));
}

function validSerializedUndo(value: unknown): boolean {
  return isRecord(value) &&
    (value.previousRevision === undefined ||
      (typeof value.previousRevision === "string" && value.previousRevision.length <= 512)) &&
    Array.isArray(value.previousFiles) &&
    value.previousFiles.every(validSynchronizedFile) &&
    Array.isArray(value.operations) &&
    value.operations.every(validUndoOperation);
}

function validSynchronizedFile(value: unknown): boolean {
  return isRecord(value) && validPath(value.path) &&
    typeof value.binary === "boolean" &&
    typeof value.localOnly === "boolean" &&
    validOptionalBuffer(value.initialContent) &&
    validOptionalMode(value.initialMode) &&
    validOptionalBuffer(value.taskContent) &&
    validOptionalMode(value.taskMode);
}

function validUndoOperation(value: unknown): boolean {
  return isRecord(value) && validPath(value.path) &&
    validOptionalBuffer(value.content) &&
    validOptionalMode(value.mode) &&
    validOptionalBuffer(value.appliedContent) &&
    validOptionalMode(value.appliedMode);
}

function validTransitionOperation(value: unknown): boolean {
  return isRecord(value) && validPath(value.path) &&
    validOptionalBuffer(value.beforeContent) &&
    validOptionalMode(value.beforeMode) &&
    validOptionalBuffer(value.afterContent) &&
    validOptionalMode(value.afterMode);
}

function validPath(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 8_192) return false;
  try {
    normalizeJournalPath(value);
    return true;
  } catch {
    return false;
  }
}

function validOptionalBuffer(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  try {
    decodeBuffer(value);
    return true;
  } catch {
    return false;
  }
}

function validOptionalMode(value: unknown): boolean {
  return value === undefined ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function incrementalDeliveryFiles(
  currentFiles: readonly ConversationDeliveryFile[],
  previousFiles: ReadonlyMap<string, SynchronizedFile> = new Map(),
): {
  files: readonly ConversationDeliveryFile[];
  nextFiles: ReadonlyMap<string, SynchronizedFile>;
} {
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file]));
  const paths = [...new Set([...currentByPath.keys(), ...previousFiles.keys()])]
    .sort((left, right) => left.localeCompare(right));
  const files: ConversationDeliveryFile[] = [];
  const nextFiles = new Map<string, SynchronizedFile>();

  for (const path of paths) {
    const current = currentByPath.get(path);
    const previous = previousFiles.get(path);
    if (current) {
      const synchronizedFile: SynchronizedFile = {
        path,
        binary: current.binary,
        localOnly: !!current.localOnly,
        initialContent: previous?.initialContent ?? current.baselineContent,
        initialMode: previous?.initialMode ?? current.baselineMode,
        taskContent: current.taskContent,
        taskMode: current.taskMode,
      };
      nextFiles.set(path, synchronizedFile);
      files.push({
        ...current,
        baselineContent: previous?.taskContent ?? current.baselineContent,
        baselineMode: previous?.taskMode ?? current.baselineMode,
      });
      continue;
    }
    if (!previous) continue;
    files.push({
      path,
      status: previous.initialContent === undefined ? "deleted" : "modified",
      binary: previous.binary,
      ...(previous.localOnly ? { localOnly: true } : {}),
      ...(previous.taskContent !== undefined
        ? { baselineContent: previous.taskContent }
        : {}),
      ...(previous.taskMode !== undefined
        ? { baselineMode: previous.taskMode }
        : {}),
      ...(previous.initialContent !== undefined
        ? { taskContent: previous.initialContent }
        : {}),
      ...(previous.initialMode !== undefined
        ? { taskMode: previous.initialMode }
        : {}),
    });
  }
  return { files, nextFiles };
}

async function planFile(
  file: ConversationDeliveryFile,
  projectPath: string,
  mergeText: TextMerger,
  submodulePaths?: ReadonlySet<string>,
): Promise<DeliveryOperation> {
  const localOnly = !!file.localOnly;
  const targetPath = safeTargetPath(projectPath, file.path);
  if (inSubmodule(file.path, submodulePaths)) {
    return conflict(file.path, targetPath, "unsafe_target", localOnly);
  }
  const target = await readTarget(projectPath, targetPath);
  if (target.unsafe) {
    return conflict(file.path, targetPath, "unsafe_target", localOnly);
  }
  const baseline = file.baselineContent;
  const task = file.taskContent;

  if (buffersEqual(target.content, task)) {
    return {
      path: file.path,
      targetPath,
      expectedContent: target.content,
      content: task,
      mode: file.taskMode,
      alreadyApplied: true,
      localOnly,
    };
  }
  if (!baseline) {
    if (target.content) {
      return conflict(file.path, targetPath, "both_added", localOnly);
    }
    return {
      path: file.path,
      targetPath,
      expectedContent: target.content,
      content: task,
      mode: file.taskMode,
      alreadyApplied: false,
      localOnly,
    };
  }
  if (!task) {
    if (!target.content) {
      return {
        path: file.path,
        targetPath,
        expectedContent: target.content,
        alreadyApplied: true,
        localOnly,
      };
    }
    if (!target.content.equals(baseline)) {
      return conflict(file.path, targetPath, "target_modified", localOnly);
    }
    return {
      path: file.path,
      targetPath,
      expectedContent: target.content,
      alreadyApplied: false,
      localOnly,
    };
  }
  if (!target.content) {
    return conflict(file.path, targetPath, "target_deleted", localOnly);
  }
  if (target.content.equals(baseline)) {
    return {
      path: file.path,
      targetPath,
      expectedContent: target.content,
      content: task,
      mode: file.taskMode,
      alreadyApplied: false,
      localOnly,
    };
  }
  if (
    file.binary ||
    isBinaryFileContent(target.content) ||
    isBinaryFileContent(baseline) ||
    isBinaryFileContent(task)
  ) {
    return conflict(file.path, targetPath, "target_modified", localOnly);
  }

  const merged = await mergeText(target.content, baseline, task);
  if (merged.conflict) {
    return conflict(file.path, targetPath, "merge_conflict", localOnly);
  }
  return {
    path: file.path,
    targetPath,
    expectedContent: target.content,
    content: merged.content,
    mode: file.taskMode,
    alreadyApplied: merged.content.equals(target.content),
    localOnly,
  };
}

async function applyOperations(
  projectPath: string,
  operations: readonly DeliveryOperation[],
  preparedBackups?: readonly TargetBackup[],
): Promise<void> {
  if (operations.length === 0) return;
  const backups =
    preparedBackups ?? (await operationBackups(projectPath, operations));
  try {
    for (const operation of operations) {
      if (operation.content === undefined) {
        await rm(operation.targetPath, { force: true });
        continue;
      }
      await mkdir(dirname(operation.targetPath), {
        recursive: true,
        mode: 0o700,
      });
      await writeFile(operation.targetPath, operation.content);
      if (operation.mode !== undefined) {
        await chmod(operation.targetPath, operation.mode & 0o777);
      }
    }
  } catch (error) {
    await Promise.all(backups.map(restoreBackup));
    throw error;
  }
}

async function operationBackups(
  projectPath: string,
  operations: readonly DeliveryOperation[],
): Promise<readonly TargetBackup[]> {
  return Promise.all(
    operations.map(async ({ targetPath, expectedContent }) => {
      const target = await readTarget(projectPath, targetPath);
      if (target.unsafe) {
        throw new Error("The original workspace changed during delivery");
      }
      if (!buffersEqual(target.content, expectedContent)) {
        throw new Error(
          "The original workspace changed after delivery preflight. Run the preflight again.",
        );
      }
      return {
        path: targetPath,
        content: target.content,
        mode: target.mode,
      } satisfies TargetBackup;
    }),
  );
}

async function assertUndoTargets(
  projectPath: string,
  operations: readonly UndoOperation[],
): Promise<void> {
  for (const operation of operations) {
    const target = await readTarget(projectPath, operation.path);
    if (
      target.unsafe ||
      !buffersEqual(target.content, operation.appliedContent) ||
      (operation.appliedMode !== undefined &&
        target.mode !== undefined &&
        (target.mode & 0o777) !== (operation.appliedMode & 0o777))
    ) {
      throw new Error(
        "The original workspace changed after the automatic application. Review those changes before undoing.",
      );
    }
  }
}

async function restoreBackup(backup: TargetBackup): Promise<void> {
  if (backup.content === undefined) {
    await rm(backup.path, { force: true });
    return;
  }
  await mkdir(dirname(backup.path), { recursive: true, mode: 0o700 });
  await writeFile(backup.path, backup.content);
  if (backup.mode !== undefined) {
    await chmod(backup.path, backup.mode & 0o777);
  }
}

function deliveredResult(
  preflight: WorktreeDeliveryPreflight,
  appliedFiles: number,
): WorktreeDeliveryResult {
  return {
    ...preflight,
    pendingFiles: 0,
    alreadyAppliedFiles: preflight.alreadyAppliedFiles + appliedFiles,
    appliedFiles,
  };
}

function assertReady(preflight: WorktreeDeliveryPreflight): void {
  if (preflight.files === 0) return;
  if (preflight.branchChanged) {
    throw new Error(
      `The original worktree is now on ${preflight.targetBranch}, but this task started from ${preflight.sourceBranch}. Switch back before delivering.`,
    );
  }
  if (preflight.conflicts.length > 0) {
    throw new Error(
      `Delivery has ${preflight.conflicts.length} conflict${preflight.conflicts.length === 1 ? "" : "s"}. Resolve the original workspace changes and try again.`,
    );
  }
}

function assertWorktreeRequest(request: WorktreeDeliveryRequest): void {
  if (!isInside(request.workspace.repositoryRoot, request.projectPath)) {
    throw new Error("The project path is outside the original repository");
  }
  if (!isInside(request.workspace.root, request.workspace.path)) {
    throw new Error("The task path is outside its managed worktree");
  }
}

async function currentBranch(
  repositoryRoot: string,
  run: GitRunner,
): Promise<string> {
  const { stdout } = await run(repositoryRoot, [
    "branch",
    "--show-current",
  ]);
  return stdout.trim() || "detached HEAD";
}

async function readTarget(
  projectPath: string,
  path: string,
): Promise<{ content?: Buffer; mode?: number; unsafe: boolean }> {
  if (!isInside(projectPath, path)) return { unsafe: true };
  const root = resolve(projectPath);
  const parts = relative(root, path).split(sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]!);
    try {
      const metadata = await lstat(current);
      const target = index === parts.length - 1;
      if (
        metadata.isSymbolicLink() ||
        (!target && !metadata.isDirectory()) ||
        (target && !metadata.isFile())
      ) {
        return { unsafe: true };
      }
      if (target) {
        return {
          content: await readFile(current),
          mode: metadata.mode,
          unsafe: false,
        };
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { unsafe: false };
      }
      throw error;
    }
  }
  return { unsafe: true };
}

function safeTargetPath(projectPath: string, relativePath: string): string {
  const target = resolve(projectPath, relativePath);
  if (!isInside(projectPath, target)) {
    throw new Error("Delivery path escapes the original project");
  }
  return target;
}

function gitPath(repositoryRoot: string, targetPath: string): string {
  const path = relative(repositoryRoot, targetPath);
  if (
    !path ||
    isAbsolute(path) ||
    path === ".." ||
    path.startsWith(`..${sep}`)
  ) {
    throw new Error("Delivery path escapes the original repository");
  }
  return path.split(sep).join("/");
}

function synchronizationKey(request: WorktreeDeliveryJournalTarget): string {
  return `${resolve(request.projectPath)}\u0000${request.projectId}\u0000${request.threadId}`;
}

async function mergeTextWithGit(
  target: Buffer,
  baseline: Buffer,
  task: Buffer,
): Promise<{ content: Buffer; conflict: boolean }> {
  const directory = await mkdtemp(join(tmpdir(), "threadlight-merge-"));
  const targetPath = join(directory, "target");
  const baselinePath = join(directory, "baseline");
  const taskPath = join(directory, "task");
  try {
    await Promise.all([
      writeFile(targetPath, target),
      writeFile(baselinePath, baseline),
      writeFile(taskPath, task),
    ]);
    return await new Promise((resolvePromise, reject) => {
      execFile(
        "git",
        [
          "merge-file",
          "-p",
          "-L",
          "original",
          "-L",
          "task base",
          "-L",
          "task",
          targetPath,
          baselinePath,
          taskPath,
        ],
        {
          encoding: "buffer",
          env: { ...process.env, LC_ALL: "C" },
          maxBuffer: MAX_GIT_OUTPUT_BYTES,
        },
        (error, stdout, stderr) => {
          const code =
            error && "code" in error && typeof error.code === "number"
              ? error.code
              : 0;
          if (!error || code === 1) {
            resolvePromise({
              content: Buffer.from(stdout),
              conflict: code === 1,
            });
            return;
          }
          reject(
            new Error(
              Buffer.from(stderr).toString("utf8").trim() ||
                "Git could not perform the three-way merge",
            ),
          );
        },
      );
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runGit(
  cwd: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function inSubmodule(
  path: string,
  submodulePaths: ReadonlySet<string> | undefined,
): boolean {
  if (!submodulePaths || submodulePaths.size === 0) return false;
  const normalized = path.replace(/\/$/, "");
  for (const submodule of submodulePaths) {
    if (normalized === submodule || normalized.startsWith(`${submodule}/`)) {
      return true;
    }
  }
  return false;
}

function conflict(
  path: string,
  targetPath: string,
  reason: WorktreeDeliveryConflict["reason"],
  localOnly: boolean,
): DeliveryOperation {
  return {
    path,
    targetPath,
    expectedContent: undefined,
    alreadyApplied: false,
    localOnly,
    conflict: { path, reason },
  };
}

function buffersEqual(
  left: Buffer | undefined,
  right: Buffer | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined && left.equals(right);
}

function isInside(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target));
  return (
    path === "" ||
    (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
