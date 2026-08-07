import { LogOut } from "lucide-react";
import { useI18n } from "@threadlight/ui/i18n";

export function WebSessionIndicator({
  hostName,
  onDisconnect,
}: {
  hostName: string;
  onDisconnect(): void;
}) {
  const { t } = useI18n();
  const disconnectLabel = t("disconnectRemoteHost");

  return (
    <div className="web-session-indicator">
      <span className="web-session-dot" aria-hidden="true" />
      <span className="web-session-name" title={hostName}>
        {hostName}
      </span>
      <button
        type="button"
        className="web-session-disconnect pressable"
        aria-label={disconnectLabel}
        title={disconnectLabel}
        onClick={onDisconnect}
      >
        <LogOut size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
