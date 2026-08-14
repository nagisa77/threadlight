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

export interface TargetBackup {
  path: string;
  content?: Buffer;
  mode?: number;
}

import {
  appendHistory,
  deserializeSynchronizationState,
  finalizeJournal,
  journalRelativePath,
  loadSynchronizationState,
  prepareJournal,
  readJournal,
  removeJournal,
  targetMatches,
  writeJournal,
  type SynchronizationState,
  type SynchronizedFile,
  type DeliveryTransitionOperation,
  type UndoOperation,
} from "./worktree-delivery-journal.js";

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
    if (previous?.revision === request.revision && pending.length === 0) {
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
    const transitions = pending.map(
      (operation, index) =>
        ({
          path: operation.path,
          beforeContent: backups[index]!.content,
          beforeMode: backups[index]!.mode,
          afterContent: operation.content,
          afterMode: operation.mode,
        }) satisfies DeliveryTransitionOperation,
    );
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
    const transitions = state.undo.operations.map(
      (operation) =>
        ({
          path: journalRelativePath(request.projectPath, operation.path),
          beforeContent: operation.appliedContent,
          beforeMode: operation.appliedMode,
          afterContent: operation.content,
          afterMode: operation.mode,
        }) satisfies DeliveryTransitionOperation,
    );
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
                entry.status === "synced" && entry.revision === state.revision,
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

  async deleteJournal(target: WorktreeDeliveryJournalTarget): Promise<void> {
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
        branchChanged: Boolean(sourceBranch && sourceBranch !== targetBranch),
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

function incrementalDeliveryFiles(
  currentFiles: readonly ConversationDeliveryFile[],
  previousFiles: ReadonlyMap<string, SynchronizedFile> = new Map(),
): {
  files: readonly ConversationDeliveryFile[];
  nextFiles: ReadonlyMap<string, SynchronizedFile>;
} {
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file]));
  const paths = [
    ...new Set([...currentByPath.keys(), ...previousFiles.keys()]),
  ].sort((left, right) => left.localeCompare(right));
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

export async function restoreBackup(backup: TargetBackup): Promise<void> {
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
  const { stdout } = await run(repositoryRoot, ["branch", "--show-current"]);
  return stdout.trim() || "detached HEAD";
}

export async function readTarget(
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

export function safeTargetPath(
  projectPath: string,
  relativePath: string,
): string {
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

export function buffersEqual(
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
