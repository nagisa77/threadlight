export interface ConversationFileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary: boolean;
  localOnly?: boolean;
  oldContent?: string;
  newContent?: string;
}

export interface ConversationChangesSnapshot {
  threadId: string;
  additions: number;
  deletions: number;
  revision: string;
  files: readonly ConversationFileChange[];
}

export interface PullRequestDescription {
  title: string;
  body: string;
}

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
  localOnlyFiles?: number;
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

export interface AutomaticDeliveryState {
  scope: string;
  revision: string;
  status: "syncing" | "synced" | "conflict" | "failed" | "undoing" | "undone";
  result?: WorktreeDeliveryResult;
  preflight?: WorktreeDeliveryPreflight;
  error?: string;
}

export interface CodeHostCheck {
  name: string;
  status: "queued" | "running" | "success" | "failure" | "skipped";
  url?: string;
}

export interface CodeHostReviewComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
  path?: string;
  line?: number;
  kind: "comment" | "review" | "inline";
  state?: string;
}

export interface CodeHostPullRequest {
  number: number;
  url: string;
  title: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  headBranch: string;
  baseBranch: string;
  ciStatus: "none" | "pending" | "success" | "failure";
  reviewDecision?: string;
  checks: readonly CodeHostCheck[];
  comments: readonly CodeHostReviewComment[];
}

export interface CodeHostDeliveryStatus {
  provider: "github";
  available: boolean;
  setupIssue?: CodeHostDeliverySetupIssue;
  reason?: string;
  repository?: string;
  remote?: string;
  taskBranch: string;
  baseBranch: string;
  pushed: boolean;
  ahead: number;
  pullRequest?: CodeHostPullRequest;
}

export type CodeHostDeliverySetupIssue =
  | "cli_missing"
  | "authentication_required"
  | "remote_missing"
  | "remote_ambiguous"
  | "repository_unavailable"
  | "unknown";

export interface CodeHostCommitPushResult {
  commit: string;
  status: CodeHostDeliveryStatus;
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface WorkspaceFile {
  path: string;
  name: string;
  content?: string;
  binary: boolean;
  size: number;
}

export interface SystemFileEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
}

export interface SystemFileListing {
  path: string;
  parentPath?: string;
  entries: readonly SystemFileEntry[];
}

export interface WorkspaceAdapter {
  getChanges(
    projectId: string,
    threadId: string,
  ): Promise<ConversationChangesSnapshot>;
  restoreChanges?(
    projectId: string,
    threadId: string,
    revision: string,
    paths?: readonly string[],
  ): Promise<ConversationChangesSnapshot>;
  preflightDelivery?(
    projectId: string,
    threadId: string,
    revision: string,
  ): Promise<WorktreeDeliveryPreflight>;
  getDeliveryHistory?(
    projectId: string,
    threadId: string,
  ): Promise<WorktreeDeliveryHistorySnapshot>;
  applyDelivery?(
    projectId: string,
    threadId: string,
    revision: string,
  ): Promise<WorktreeDeliveryResult>;
  undoDelivery?(
    projectId: string,
    threadId: string,
    revision: string,
  ): Promise<WorktreeDeliveryUndoResult>;
  commitDelivery?(
    projectId: string,
    threadId: string,
    revision: string,
    message: string,
  ): Promise<WorktreeDeliveryResult>;
  getCodeHostStatus?(
    projectId: string,
    threadId: string,
    revision: string,
  ): Promise<CodeHostDeliveryStatus>;
  commitAndPush?(
    projectId: string,
    threadId: string,
    revision: string,
    message: string,
  ): Promise<CodeHostCommitPushResult>;
  createPullRequest?(
    projectId: string,
    threadId: string,
    revision: string,
    title: string,
    body?: string,
    draft?: boolean,
  ): Promise<CodeHostDeliveryStatus>;
  list(
    projectId: string,
    path?: string,
    threadId?: string,
  ): Promise<readonly WorkspaceEntry[]>;
  read(
    projectId: string,
    path: string,
    threadId?: string,
  ): Promise<WorkspaceFile>;
  download?(
    projectId: string,
    path: string,
    threadId?: string,
  ): Promise<ArrayBuffer>;
  reveal?(projectId: string, path: string, threadId?: string): Promise<void>;
  chooseSystemFile?(): Promise<string | undefined>;
  listSystemFiles?(path: string): Promise<SystemFileListing>;
  readSystemFile?(path: string): Promise<WorkspaceFile>;
  downloadSystemFile?(path: string): Promise<ArrayBuffer>;
  revealSystemFile?(path: string): Promise<void>;
}

export interface WorkspaceFileOpenRequest {
  id: number;
  path: string;
  source?: "workspace" | "system";
  activate?: boolean;
  line?: number;
  column?: number;
}
