import { useRef, useState } from "react";
import {
  Bookmark,
  Check,
  Download,
  Link2,
  MoreHorizontal,
  Trash2,
  X,
} from "lucide-react";

import { Dialog } from "../../dialog.js";
import { useI18n } from "../../i18n.js";
import {
  ActionPopover,
  ActionPopoverItem,
  anchoredPopoverPosition,
  type PopoverPosition,
} from "../../popover.js";
import type { ProductivityMessage } from "./model.js";

export function TaskProductivityMenu({
  disabled,
  bookmarkCount,
  taskLinksEnabled,
  onCopyReference,
  onExport,
  onOpenBookmarks,
}: {
  disabled?: boolean;
  bookmarkCount: number;
  taskLinksEnabled?: boolean;
  onCopyReference(): Promise<void>;
  onExport(): void;
  onOpenBookmarks(): void;
}) {
  const { t } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<PopoverPosition>();
  const [status, setStatus] = useState<"copied" | "failed">();

  async function copyReference() {
    setPosition(undefined);
    try {
      await onCopyReference();
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    window.setTimeout(() => setStatus(undefined), 1_600);
  }

  return (
    <div className="task-productivity">
      <button
        ref={trigger}
        type="button"
        className={`header-terminal-button task-productivity-trigger pressable${position ? " active" : ""}`}
        disabled={disabled}
        aria-label={t("taskTools")}
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
        title={t("taskTools")}
        onClick={() => {
          if (position) {
            setPosition(undefined);
            return;
          }
          const bounds = trigger.current?.getBoundingClientRect();
          if (!bounds) return;
          setPosition(
            anchoredPopoverPosition(bounds, {
              width: 224,
              height: taskLinksEnabled ? 142 : 104,
              align: "end",
              placement: "bottom",
            }),
          );
        }}
      >
        <MoreHorizontal size={17} aria-hidden="true" />
        {bookmarkCount > 0 && (
          <span className="task-bookmark-count" aria-hidden="true">
            {bookmarkCount}
          </span>
        )}
      </button>
      {status && (
        <span className={`task-action-feedback ${status}`} role="status">
          {status === "copied" ? (
            <Check size={12} aria-hidden="true" />
          ) : (
            <X size={12} aria-hidden="true" />
          )}
          {t(status === "copied" ? "taskReferenceCopied" : "copyFailed")}
        </span>
      )}
      {position && (
        <ActionPopover
          label={t("taskTools")}
          position={position}
          className="task-productivity-popover"
          anchorRef={trigger}
          anchorOptions={{
            width: 224,
            height: taskLinksEnabled ? 142 : 104,
            align: "end",
            placement: "bottom",
          }}
          returnFocusRef={trigger}
          onClose={() => setPosition(undefined)}
        >
          {taskLinksEnabled && (
            <ActionPopoverItem
              icon={<Link2 size={15} />}
              onSelect={() => void copyReference()}
            >
              {t("copyTaskReference")}
            </ActionPopoverItem>
          )}
          <ActionPopoverItem
            icon={<Download size={15} />}
            onSelect={() => {
              setPosition(undefined);
              onExport();
            }}
          >
            {t("exportConversation")}
          </ActionPopoverItem>
          <ActionPopoverItem
            icon={<Bookmark size={15} />}
            onSelect={() => {
              setPosition(undefined);
              onOpenBookmarks();
            }}
          >
            <span className="task-productivity-item-copy">
              <span>{t("messageBookmarks")}</span>
              {bookmarkCount > 0 && <small>{bookmarkCount}</small>}
            </span>
          </ActionPopoverItem>
        </ActionPopover>
      )}
    </div>
  );
}

export function MessageBookmarksDialog({
  messages,
  onClose,
  onJump,
  onRemove,
}: {
  messages: readonly ProductivityMessage[];
  onClose(): void;
  onJump(messageId: string): void;
  onRemove(messageId: string): void;
}) {
  const { t } = useI18n();
  const closeButton = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      className="bookmarks-dialog"
      aria-labelledby="bookmarks-dialog-title"
      initialFocusRef={closeButton}
      onClose={onClose}
    >
      <header className="bookmarks-dialog-header">
        <span className="bookmarks-dialog-mark" aria-hidden="true">
          <Bookmark size={17} />
        </span>
        <span>
          <h2 id="bookmarks-dialog-title">{t("messageBookmarks")}</h2>
          <p>{t("messageBookmarksDescription")}</p>
        </span>
        <button
          ref={closeButton}
          type="button"
          className="icon-button pressable"
          aria-label={t("close")}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      {messages.length === 0 ? (
        <div className="bookmarks-empty">
          <Bookmark size={22} aria-hidden="true" />
          <strong>{t("noMessageBookmarks")}</strong>
          <span>{t("noMessageBookmarksDescription")}</span>
        </div>
      ) : (
        <div className="bookmarks-list">
          {messages.map((message) => (
            <article className="bookmark-item" key={message.id}>
              <button
                type="button"
                className="bookmark-jump pressable"
                onClick={() => onJump(message.id)}
              >
                <span>
                  {t(message.role === "user" ? "you" : "threadlight")}
                </span>
                <strong>{message.text || t("noTextContent")}</strong>
              </button>
              <button
                type="button"
                className="bookmark-remove pressable"
                aria-label={t("removeBookmark")}
                title={t("removeBookmark")}
                onClick={() => onRemove(message.id)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      )}
    </Dialog>
  );
}
