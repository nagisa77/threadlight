import { VOICE_INPUT_ERROR_CODES } from "@threadlight/protocol";

export interface AudioTranscriptionRequest {
  audio: ArrayBuffer;
  mimeType: string;
}

export interface AudioTranscriptionOptions {
  apiKey: string;
  fetcher?: typeof fetch;
}

export const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;

const TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
const TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const AUDIO_FORMATS = new Map([
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/webm", "webm"],
]);

export async function transcribeAudio(
  request: AudioTranscriptionRequest,
  options: AudioTranscriptionOptions,
): Promise<string> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new Error(VOICE_INPUT_ERROR_CODES.openAiKeyRequired);
  }

  const mimeType = normalizeMimeType(request.mimeType);
  const extension = AUDIO_FORMATS.get(mimeType);
  if (!extension) throw new Error(VOICE_INPUT_ERROR_CODES.unsupportedFormat);
  if (request.audio.byteLength === 0) {
    throw new Error(VOICE_INPUT_ERROR_CODES.emptyRecording);
  }
  if (request.audio.byteLength > MAX_TRANSCRIPTION_BYTES) {
    throw new Error(VOICE_INPUT_ERROR_CODES.recordingTooLarge);
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([request.audio], { type: mimeType }),
    `threadlight-recording.${extension}`,
  );
  form.append("model", TRANSCRIPTION_MODEL);
  form.append("response_format", "json");

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch {
    throw new Error(VOICE_INPUT_ERROR_CODES.serviceUnavailable);
  }

  if (!response.ok) throw await transcriptionError(response);

  const body = (await response.json()) as unknown;
  if (!isTranscriptionResponse(body) || !body.text.trim()) {
    throw new Error(VOICE_INPUT_ERROR_CODES.emptyTranscript);
  }
  return body.text.trim();
}

export function parseAudioTranscriptionRequest(
  value: unknown,
): AudioTranscriptionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid audio transcription request");
  }
  const request = value as Record<string, unknown>;
  if (!(request.audio instanceof ArrayBuffer)) {
    throw new Error("Invalid audio transcription data");
  }
  if (typeof request.mimeType !== "string") {
    throw new Error("Invalid audio transcription MIME type");
  }
  return { audio: request.audio, mimeType: request.mimeType };
}

function normalizeMimeType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

async function transcriptionError(response: Response): Promise<Error> {
  if (response.status === 401) {
    return new Error(VOICE_INPUT_ERROR_CODES.openAiKeyInvalid);
  }
  if (response.status === 429) {
    return new Error(VOICE_INPUT_ERROR_CODES.rateLimited);
  }

  let detail = "";
  try {
    const body = (await response.json()) as unknown;
    if (isApiError(body)) detail = body.error.message.trim();
  } catch {
    // The status code is enough when the upstream response is not JSON.
  }
  const suffix = detail ? `:${encodeURIComponent(detail.slice(0, 180))}` : "";
  return new Error(
    `${VOICE_INPUT_ERROR_CODES.transcriptionFailed}:${response.status}${suffix}`,
  );
}

function isTranscriptionResponse(value: unknown): value is { text: string } {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).text === "string"
  );
}

function isApiError(value: unknown): value is { error: { message: string } } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const error = (value as Record<string, unknown>).error;
  return (
    !!error &&
    typeof error === "object" &&
    !Array.isArray(error) &&
    typeof (error as Record<string, unknown>).message === "string"
  );
}
