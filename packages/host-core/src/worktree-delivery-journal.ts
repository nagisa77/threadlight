import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  buffersEqual,
  readTarget,
  restoreBackup,
  safeTargetPath,
  type WorktreeDeliveryHistoryEntry,
  type WorktreeDeliveryHistorySnapshot,
  type WorktreeDeliveryJournalTarget,
  type WorktreeDeliveryRequest,
  type TargetBackup,
} from "./worktree-delivery.js";

const DELIVERY_JOURNAL_VERSION = 1;
const MAX_DELIVERY_JOURNAL_BYTES = 256 * 1024 * 1024;
const MAX_DELIVERY_HISTORY_ENTRIES = 100;

export interface SynchronizedFile {
  path: string;
  binary: boolean;
  localOnly: boolean;
  initialContent?: Buffer;
  initialMode?: number;
  taskContent?: Buffer;
  taskMode?: number;
}

export interface UndoOperation extends TargetBackup {
  appliedContent?: Buffer;
  appliedMode?: number;
}

export interface SynchronizationState {
  revision: string;
  files: ReadonlyMap<string, SynchronizedFile>;
  undo?: {
    previousRevision?: string;
    previousFiles: ReadonlyMap<string, SynchronizedFile>;
    operations: readonly UndoOperation[];
  };
}

export interface DeliveryTransitionOperation {
  path: string;
  beforeContent?: Buffer;
  beforeMode?: number;
  afterContent?: Buffer;
  afterMode?: number;
}

export interface SerializedSynchronizedFile {
  path: string;
  binary: boolean;
  localOnly: boolean;
  initialContent?: string;
  initialMode?: number;
  taskContent?: string;
  taskMode?: number;
}

export interface SerializedUndoOperation {
  path: string;
  content?: string;
  mode?: number;
  appliedContent?: string;
  appliedMode?: number;
}

export interface SerializedSynchronizationState {
  revision: string;
  files: readonly SerializedSynchronizedFile[];
  undo?: {
    previousRevision?: string;
    previousFiles: readonly SerializedSynchronizedFile[];
    operations: readonly SerializedUndoOperation[];
  };
}

export interface SerializedTransitionOperation {
  path: string;
  beforeContent?: string;
  beforeMode?: number;
  afterContent?: string;
  afterMode?: number;
}

export interface DeliveryJournal {
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

export async function loadSynchronizationState(
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

export async function prepareJournal(
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
      ...(next ? { next: serializeSynchronizationState(request, next) } : {}),
      operations: operations.map(serializeTransitionOperation),
    },
    ...(history?.length ? { history } : {}),
  });
}

export async function finalizeJournal(
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

export async function appendHistory(
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

export function serializeSynchronizationState(
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

export function deserializeSynchronizationState(
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

export function serializeSynchronizedFile(
  file: SynchronizedFile,
): SerializedSynchronizedFile {
  return {
    path: normalizeJournalPath(file.path),
    binary: file.binary,
    localOnly: file.localOnly,
    ...(file.initialContent !== undefined
      ? { initialContent: encodeBuffer(file.initialContent) }
      : {}),
    ...(file.initialMode !== undefined
      ? { initialMode: file.initialMode }
      : {}),
    ...(file.taskContent !== undefined
      ? { taskContent: encodeBuffer(file.taskContent) }
      : {}),
    ...(file.taskMode !== undefined ? { taskMode: file.taskMode } : {}),
  };
}

export function deserializeSynchronizedFile(
  file: SerializedSynchronizedFile,
): SynchronizedFile {
  return {
    path: normalizeJournalPath(file.path),
    binary: file.binary,
    localOnly: file.localOnly,
    ...(file.initialContent !== undefined
      ? { initialContent: decodeBuffer(file.initialContent) }
      : {}),
    ...(file.initialMode !== undefined
      ? { initialMode: file.initialMode }
      : {}),
    ...(file.taskContent !== undefined
      ? { taskContent: decodeBuffer(file.taskContent) }
      : {}),
    ...(file.taskMode !== undefined ? { taskMode: file.taskMode } : {}),
  };
}

export function serializeTransitionOperation(
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

export function deserializeTransitionOperation(
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

export async function readJournal(
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

export async function writeJournal(
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

export async function removeJournal(
  request: WorktreeDeliveryJournalTarget,
): Promise<void> {
  const path = deliveryJournalPath(request);
  await assertSafeJournalPath(request.projectPath, path);
  await rm(path, { force: true });
}

export function deliveryJournalPath(
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

export async function assertSafeJournalPath(
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

export function journalRelativePath(projectPath: string, path: string): string {
  if (!isInside(projectPath, path)) {
    throw new Error("The automatic delivery journal contains an unsafe path.");
  }
  return normalizeJournalPath(relative(resolve(projectPath), resolve(path)));
}

export function normalizeJournalPath(path: string): string {
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

export function encodeBuffer(value: Buffer): string {
  return value.toString("base64");
}

export function decodeBuffer(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error("The automatic delivery journal contains invalid data.");
  }
  return decoded;
}

export function targetMatches(
  target: { content?: Buffer; mode?: number },
  content: Buffer | undefined,
  mode: number | undefined,
): boolean {
  if (!buffersEqual(target.content, content)) return false;
  if (content === undefined || mode === undefined) return true;
  return target.mode !== undefined && (target.mode & 0o777) === (mode & 0o777);
}

export function validateJournal(
  value: unknown,
  request: WorktreeDeliveryJournalTarget,
): asserts value is DeliveryJournal {
  if (
    !isRecord(value) ||
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

export function validHistory(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= MAX_DELIVERY_HISTORY_ENTRIES &&
    value.every(validHistoryEntry)
  );
}

export function validHistoryEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    value.id.length > 128 ||
    typeof value.createdAt !== "string" ||
    value.createdAt.length > 64 ||
    typeof value.revision !== "string" ||
    value.revision.length > 512 ||
    !["synced", "conflict", "failed", "undone"].includes(value.status as string)
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
  return (
    shortString(value.taskBranch, 512) &&
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
    shortString(value.error, 32_768)
  );
}

export function validDeliveryConflict(value: unknown): boolean {
  return (
    isRecord(value) &&
    validPath(value.path) &&
    [
      "both_added",
      "target_deleted",
      "target_modified",
      "merge_conflict",
      "unsafe_target",
    ].includes(value.reason as string)
  );
}

export function validPendingJournal(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.next === undefined || validSerializedState(value.next)) &&
    Array.isArray(value.operations) &&
    value.operations.every(validTransitionOperation)
  );
}

export function validSerializedState(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.revision === "string" &&
    value.revision.length <= 512 &&
    Array.isArray(value.files) &&
    value.files.every(validSynchronizedFile) &&
    (value.undo === undefined || validSerializedUndo(value.undo))
  );
}

export function validSerializedUndo(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.previousRevision === undefined ||
      (typeof value.previousRevision === "string" &&
        value.previousRevision.length <= 512)) &&
    Array.isArray(value.previousFiles) &&
    value.previousFiles.every(validSynchronizedFile) &&
    Array.isArray(value.operations) &&
    value.operations.every(validUndoOperation)
  );
}

export function validSynchronizedFile(value: unknown): boolean {
  return (
    isRecord(value) &&
    validPath(value.path) &&
    typeof value.binary === "boolean" &&
    typeof value.localOnly === "boolean" &&
    validOptionalBuffer(value.initialContent) &&
    validOptionalMode(value.initialMode) &&
    validOptionalBuffer(value.taskContent) &&
    validOptionalMode(value.taskMode)
  );
}

export function validUndoOperation(value: unknown): boolean {
  return (
    isRecord(value) &&
    validPath(value.path) &&
    validOptionalBuffer(value.content) &&
    validOptionalMode(value.mode) &&
    validOptionalBuffer(value.appliedContent) &&
    validOptionalMode(value.appliedMode)
  );
}

export function validTransitionOperation(value: unknown): boolean {
  return (
    isRecord(value) &&
    validPath(value.path) &&
    validOptionalBuffer(value.beforeContent) &&
    validOptionalMode(value.beforeMode) &&
    validOptionalBuffer(value.afterContent) &&
    validOptionalMode(value.afterMode)
  );
}

export function validPath(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 8_192) return false;
  try {
    normalizeJournalPath(value);
    return true;
  } catch {
    return false;
  }
}

export function validOptionalBuffer(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  try {
    decodeBuffer(value);
    return true;
  } catch {
    return false;
  }
}

export function validOptionalMode(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0)
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInside(root: string, target: string): boolean {
  const value = relative(root, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
