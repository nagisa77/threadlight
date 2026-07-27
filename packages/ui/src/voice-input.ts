import type { Translate } from "./i18n.js";

export interface VoiceRecording {
  audio: ArrayBuffer;
  mimeType: string;
}

export interface VoiceInputAdapter {
  prepare?(): Promise<void>;
  transcribe(recording: VoiceRecording): Promise<string>;
}

export const MAX_VOICE_AUDIO_BYTES = 25 * 1024 * 1024;

const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

export function preferredRecordingMimeType(
  supports: (mimeType: string) => boolean,
): string | undefined {
  return RECORDING_MIME_TYPES.find(supports);
}

export function appendVoiceTranscript(
  current: string,
  transcript: string,
): string {
  const normalized = transcript.trim();
  if (!normalized) return current;
  if (!current) return normalized;
  if (/\s$/u.test(current)) return current + normalized;

  const previous = current.at(-1) ?? "";
  const next = normalized.at(0) ?? "";
  const separator = isCjk(previous) || isCjk(next) ? "" : " ";
  return current + separator + normalized;
}

export function voiceInputErrorMessage(
  error: unknown,
  t?: Translate,
): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return t
        ? t("microphonePermissionDenied")
        : "未获得麦克风权限，请在系统设置中允许 Threadlight 访问麦克风。";
    }
    if (error.name === "NotFoundError") {
      return t ? t("microphoneNotFound") : "没有找到可用的麦克风。";
    }
    if (error.name === "NotReadableError") {
      return t
        ? t("microphoneUnavailable")
        : "麦克风暂时不可用，请检查是否被其他应用占用。";
    }
  }
  if (
    t &&
    error instanceof Error &&
    error.message === "请先在设置中配置 OpenAI API Key，再使用语音输入。"
  ) {
    return t("configureOpenAIForVoice");
  }
  return error instanceof Error ? error.message : String(error);
}

function isCjk(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。！？、：；（）《》“”]/u.test(
    value,
  );
}
