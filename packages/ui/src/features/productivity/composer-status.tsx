import { ChevronDown } from "lucide-react";

import { useI18n } from "../../i18n.js";
import type { DraftPersistenceStatus } from "./controller.js";

export function JumpToLatestButton({ onJump }: { onJump(): void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="jump-to-latest pressable"
      onClick={onJump}
      aria-label={t("jumpToLatest")}
    >
      <ChevronDown size={14} aria-hidden="true" />
      <span>{t("jumpToLatest")}</span>
    </button>
  );
}

export function ComposerProductivityStatus({
  hasHistory,
  draftStatus,
}: {
  hasHistory: boolean;
  draftStatus?: DraftPersistenceStatus;
}) {
  const { t } = useI18n();
  return (
    <div className="composer-productivity-status">
      {hasHistory && <span>{t("composerHistoryHint")}</span>}
      {draftStatus && (
        <span className={`draft-status ${draftStatus}`} role="status">
          {t(
            draftStatus === "restored"
              ? "draftRestored"
              : draftStatus === "saving"
                ? "draftSaving"
                : "draftSaved",
          )}
        </span>
      )}
    </div>
  );
}
