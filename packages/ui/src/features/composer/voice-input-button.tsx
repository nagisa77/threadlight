import { LoaderCircle, Mic, Square } from "lucide-react";

import type { Translate } from "../../i18n.js";
import type { VoiceInputStatus } from "./controller.js";

export function activateVoiceInputFromPointerDown(
  event: Pick<PointerEvent, "button">,
  activate: () => void,
) {
  if (event.button === 0) activate();
}

export function activateVoiceInputFromClick(
  event: Pick<MouseEvent, "detail">,
  activate: () => void,
) {
  // Pointer activation already ran during pointerdown, before an iOS keyboard
  // dismissal can move the button. A detail of zero represents keyboard use.
  if (event.detail === 0) activate();
}

export function VoiceInputButton({
  status,
  disabled,
  onToggle,
  t,
}: {
  status: VoiceInputStatus;
  disabled: boolean;
  onToggle(): void;
  t: Translate;
}) {
  const recording = status === "recording";
  const pending = status === "requesting" || status === "transcribing";
  const label = recording
    ? t("stopRecording")
    : status === "requesting"
      ? t("requestingMicrophone")
      : status === "transcribing"
        ? t("transcribingVoice")
        : t("voiceInput");

  return (
    <button
      type="button"
      className={`composer-action voice pressable ${recording ? "recording" : ""}`}
      onPointerDown={(event) =>
        activateVoiceInputFromPointerDown(event, onToggle)
      }
      onClick={(event) => activateVoiceInputFromClick(event, onToggle)}
      disabled={disabled || pending}
      aria-label={label}
      aria-pressed={recording}
      title={recording ? t("stopRecording") : t("voiceInput")}
    >
      {pending ? (
        <LoaderCircle className="spin" size={17} />
      ) : recording ? (
        <Square size={12} fill="currentColor" strokeWidth={0} />
      ) : (
        <Mic size={17} />
      )}
    </button>
  );
}
