import { VOICE_INPUT_ERROR_CODES } from "@threadlight/protocol";
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

export function voiceInputErrorMessage(error: unknown, t?: Translate): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return t
        ? t("microphonePermissionDenied")
        : "Microphone access was denied. Allow Threadlight to use the microphone in System Settings.";
    }
    if (error.name === "NotFoundError") {
      return t ? t("microphoneNotFound") : "No microphone was found.";
    }
    if (error.name === "NotReadableError") {
      return t
        ? t("microphoneUnavailable")
        : "The microphone is unavailable. Check whether another app is using it.";
    }
  }
  if (error instanceof Error) {
    const localized = localizedVoiceInputError(error.message, t);
    if (localized) return localized;
  }
  return error instanceof Error ? error.message : String(error);
}

function localizedVoiceInputError(
  code: string,
  t?: Translate,
): string | undefined {
  if (code === VOICE_INPUT_ERROR_CODES.openAiKeyRequired) {
    return t
      ? t("configureOpenAIForVoice")
      : "Configure an OpenAI API Key in Settings before using voice input.";
  }
  if (code === VOICE_INPUT_ERROR_CODES.unsupportedFormat) {
    return t
      ? t("unsupportedRecordingFormat")
      : "This recording format is not supported for voice input.";
  }
  if (code === VOICE_INPUT_ERROR_CODES.emptyRecording) {
    return t ? t("emptyRecording") : "No audio was recorded. Try again.";
  }
  if (code === VOICE_INPUT_ERROR_CODES.recordingTooLarge) {
    return t
      ? t("recordingTooLarge")
      : "The recording is larger than 25 MB. Shorten it and try again.";
  }
  if (code === VOICE_INPUT_ERROR_CODES.serviceUnavailable) {
    return t
      ? t("voiceTranscriptionUnavailable")
      : "Could not reach the transcription service. Check your connection and try again.";
  }
  if (code === VOICE_INPUT_ERROR_CODES.emptyTranscript) {
    return t
      ? t("voiceTranscriptionEmpty")
      : "The transcription did not return any text. Try again.";
  }
  if (code === VOICE_INPUT_ERROR_CODES.openAiKeyInvalid) {
    return t
      ? t("voiceOpenAIKeyInvalid")
      : "The OpenAI API Key is invalid. Update it in Settings and try again.";
  }
  if (code === VOICE_INPUT_ERROR_CODES.rateLimited) {
    return t
      ? t("voiceTranscriptionRateLimited")
      : "Voice transcription has reached its usage limit. Try again later.";
  }
  const failurePrefix = `${VOICE_INPUT_ERROR_CODES.transcriptionFailed}:`;
  if (!code.startsWith(failurePrefix)) return undefined;
  const [status = "unknown", encodedDetail] = code
    .slice(failurePrefix.length)
    .split(":", 2);
  const message = t
    ? t("voiceTranscriptionFailed", { status })
    : `Voice transcription failed (status ${status}).`;
  const detail = decodeVoiceErrorDetail(encodedDetail);
  return detail ? `${message} ${detail}` : message;
}

function decodeVoiceErrorDetail(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function isCjk(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。！？、：；（）《》“”]/u.test(
    value,
  );
}
