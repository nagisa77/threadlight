import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { createBrowserUuid } from "@threadlight/client";
import {
  ATTACHMENT_ERROR_CODES,
  type AttachmentData,
} from "@threadlight/protocol";

import { errorMessage } from "../shared/format.js";
import type { Translate } from "../../i18n.js";
import type {
  AttachmentStageAdapter,
  PendingAttachment,
} from "../shared/adapters.js";

interface AttachmentControllerOptions {
  adapter?: AttachmentStageAdapter;
  enabled: boolean;
  limit: number;
  t: Translate;
}

/** Owns browser File lifetimes, preview URLs, drag state, and staging errors. */
export function useAttachmentController({
  adapter,
  enabled,
  limit,
  t,
}: AttachmentControllerOptions) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(
    () => () => {
      releasePreviews(attachmentsRef.current);
    },
    [],
  );

  function add(files: readonly File[]) {
    if (!adapter || !enabled || preparing || files.length === 0) return;
    const available = Math.max(0, limit - attachmentsRef.current.length);
    const additions = files.slice(0, available).map(
      (file) =>
        ({
          id: createBrowserUuid(),
          file,
          ...(file.type.startsWith("image/")
            ? { previewUrl: URL.createObjectURL(file) }
            : {}),
        }) satisfies PendingAttachment,
    );
    if (additions.length === 0) return;
    setError(undefined);
    update([...attachmentsRef.current, ...additions]);
  }

  function remove(id: string) {
    const removed = attachmentsRef.current.find(
      (attachment) => attachment.id === id,
    );
    if (removed) releasePreviews([removed]);
    update(attachmentsRef.current.filter((attachment) => attachment.id !== id));
  }

  async function stage(
    pending: readonly PendingAttachment[],
  ): Promise<AttachmentData[]> {
    if (pending.length === 0) return [];
    if (!adapter) {
      throw new Error(ATTACHMENT_ERROR_CODES.stagingUnavailable);
    }
    setPreparing(true);
    setError(undefined);
    try {
      return await Promise.all(
        pending.map((attachment) => adapter.stage(attachment.file)),
      );
    } catch (reason) {
      setError(attachmentErrorMessage(reason, t));
      throw reason;
    } finally {
      setPreparing(false);
    }
  }

  function clear(
    completed: readonly PendingAttachment[] = attachmentsRef.current,
  ) {
    const completedIds = new Set(completed.map(({ id }) => id));
    releasePreviews(completed);
    update(
      attachmentsRef.current.filter(
        (attachment) => !completedIds.has(attachment.id),
      ),
    );
    setError(undefined);
  }

  function openPicker() {
    fileInput.current?.click();
  }

  function onPaste(event: ClipboardEvent<HTMLElement>) {
    const files = [...event.clipboardData.files];
    if (files.length === 0) return;
    event.preventDefault();
    add(files);
  }

  function onDragEnter(event: DragEvent<HTMLElement>) {
    if (!adapter || !hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    if (!adapter || !hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(event: DragEvent<HTMLElement>) {
    if (!hasFiles(event.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    if (!adapter || !hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    add([...event.dataTransfer.files]);
  }

  function update(next: PendingAttachment[]) {
    attachmentsRef.current = next;
    setAttachments(next);
  }

  return {
    attachments,
    attachmentsRef,
    preparing,
    error,
    setError,
    dragging,
    fileInput,
    add,
    remove,
    stage,
    clear,
    openPicker,
    onPaste,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  };
}

export function attachmentErrorMessage(reason: unknown, t: Translate): string {
  const code = errorMessage(reason);
  if (code === ATTACHMENT_ERROR_CODES.stagingUnavailable) {
    return t("attachmentStagingUnavailable");
  }
  if (code === ATTACHMENT_ERROR_CODES.localPathUnavailable) {
    return t("attachmentLocalPathUnavailable");
  }
  if (code === ATTACHMENT_ERROR_CODES.localFileRequired) {
    return t("attachmentLocalFileRequired");
  }
  if (code === ATTACHMENT_ERROR_CODES.fileChanged) {
    return t("attachmentFileChanged");
  }
  if (code === ATTACHMENT_ERROR_CODES.invalidLocalPath) {
    return t("attachmentInvalidLocalPath");
  }
  if (code === ATTACHMENT_ERROR_CODES.invalidSize) {
    return t("attachmentInvalidSize");
  }
  if (code === ATTACHMENT_ERROR_CODES.projectRequired) {
    return t("attachmentProjectRequired");
  }
  return code;
}

function releasePreviews(attachments: readonly PendingAttachment[]) {
  for (const attachment of attachments) {
    if (attachment.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}

function hasFiles(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes("Files");
}
