import { useI18n } from "../../i18n.js";
import type { DraftPersistenceStatus } from "./controller.js";

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
