import { useState, type DragEvent } from "react";
import type { QueuedTurnData } from "@threadlight/protocol";
import {
  Check,
  CornerDownRight,
  GripVertical,
  LoaderCircle,
  Paperclip,
  X,
} from "lucide-react";

import { useI18n } from "../../i18n.js";

type DropEdge = "before" | "after";

export function GuidedMessageReceipt() {
  const { t } = useI18n();
  return (
    <div className="message-follow-up-receipt">
      <Check size={12} aria-hidden="true" />
      <span>{t("guidedMessage")}</span>
    </div>
  );
}

export function ComposerQueue({
  items,
  onInject,
  onReorder,
  onCancel,
}: {
  items: readonly QueuedTurnData[];
  onInject(itemId: string): void | Promise<unknown>;
  onReorder(itemId: string, beforeItemId?: string): void | Promise<unknown>;
  onCancel(itemId: string): void | Promise<unknown>;
}) {
  const { t } = useI18n();
  const [draggedId, setDraggedId] = useState<string>();
  const [injectingId, setInjectingId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    edge: DropEdge;
  }>();

  function clearDrag() {
    setDraggedId(undefined);
    setDropTarget(undefined);
  }

  function dragOver(event: DragEvent<HTMLDivElement>, targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge =
      event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    setDropTarget({ id: targetId, edge });
  }

  function drop(event: DragEvent<HTMLDivElement>, targetId: string) {
    event.preventDefault();
    if (!draggedId || draggedId === targetId) {
      clearDrag();
      return;
    }
    const edge = dropTarget?.id === targetId ? dropTarget.edge : "before";
    const beforeItemId = queuedTurnDropBeforeId(
      items,
      draggedId,
      targetId,
      edge,
    );
    void onReorder(draggedId, beforeItemId);
    clearDrag();
  }

  async function inject(itemId: string) {
    if (injectingId) return;
    setInjectingId(itemId);
    try {
      await onInject(itemId);
    } finally {
      setInjectingId(undefined);
    }
  }

  return (
    <div className="composer-queue" aria-label={t("queuedMessages")}>
      {items.map((item, index) => {
        const target = dropTarget?.id === item.id ? dropTarget.edge : undefined;
        return (
          <div
            className={`composer-queue-item${draggedId === item.id ? " dragging" : ""}${target ? ` drop-${target}` : ""}`}
            key={item.id}
            onDragOver={(event) => dragOver(event, item.id)}
            onDrop={(event) => drop(event, item.id)}
          >
            <button
              type="button"
              className="composer-queue-drag-handle pressable"
              draggable
              aria-label={t("dragQueuedMessage")}
              title={t("dragQueuedMessage")}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp" && index > 0) {
                  event.preventDefault();
                  void onReorder(item.id, items[index - 1]?.id);
                } else if (
                  event.key === "ArrowDown" &&
                  index < items.length - 1
                ) {
                  event.preventDefault();
                  void onReorder(item.id, items[index + 2]?.id);
                }
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.id);
                setDraggedId(item.id);
                setDropTarget(undefined);
              }}
              onDragEnd={clearDrag}
            >
              <GripVertical size={14} aria-hidden="true" />
            </button>
            <span className={`composer-queue-badge ${item.delivery}`}>
              {t(item.delivery === "inject" ? "injectSoon" : "afterCurrent")}
            </span>
            <span className="composer-queue-copy">
              <span>{item.input || t("attachmentOnlyFollowUp")}</span>
              {(item.attachments?.length ?? 0) > 0 && (
                <small>
                  <Paperclip size={11} aria-hidden="true" />
                  {t("queuedAttachmentCount", {
                    count: item.attachments?.length ?? 0,
                  })}
                </small>
              )}
            </span>
            <div className="composer-queue-actions">
              {item.delivery === "queued" && (
                <button
                  type="button"
                  className="composer-queue-inject pressable"
                  disabled={Boolean(injectingId)}
                  aria-busy={injectingId === item.id}
                  onClick={() => void inject(item.id)}
                  aria-label={t("guideQueuedMessage")}
                  title={t("guideQueuedMessageDescription")}
                >
                  {injectingId === item.id ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <CornerDownRight size={14} />
                  )}
                  <span>{t("guide")}</span>
                </button>
              )}
              <button
                type="button"
                className="pressable cancel"
                onClick={() => void onCancel(item.id)}
                aria-label={t("cancelQueuedMessage")}
                title={t("cancel")}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function queuedTurnDropBeforeId(
  items: readonly Pick<QueuedTurnData, "id">[],
  draggedId: string,
  targetId: string,
  edge: DropEdge,
): string | undefined {
  const remaining = items.filter(({ id }) => id !== draggedId);
  const targetIndex = remaining.findIndex(({ id }) => id === targetId);
  if (targetIndex < 0) return;
  return edge === "before"
    ? remaining[targetIndex]?.id
    : remaining[targetIndex + 1]?.id;
}
