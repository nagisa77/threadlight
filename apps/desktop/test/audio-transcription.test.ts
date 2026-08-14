import { describe, expect, it, vi } from "vitest";
import { VOICE_INPUT_ERROR_CODES } from "@threadlight/protocol";

import {
  MAX_TRANSCRIPTION_BYTES,
  parseAudioTranscriptionRequest,
  transcribeAudio,
} from "../src/main/audio-transcription.js";

describe("audio transcription", () => {
  it("sends a bounded WebM recording to the scripted transcription provider", async () => {
    const fetcher = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit) => {
        const form = init?.body as FormData;
        const file = form.get("file") as File;

        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer test-openai-key",
        );
        expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
        expect(form.get("response_format")).toBe("json");
        expect(file.name).toBe("threadlight-recording.webm");
        expect(file.type).toBe("audio/webm");
        expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([
          1, 2, 3, 4,
        ]);

        return new Response(JSON.stringify({ text: "  修复登录问题。  " }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    ) as typeof fetch;

    await expect(
      transcribeAudio(
        {
          audio: Uint8Array.from([1, 2, 3, 4]).buffer,
          mimeType: "audio/webm;codecs=opus",
        },
        { apiKey: "test-openai-key", fetcher },
      ),
    ).resolves.toBe("修复登录问题。");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects missing credentials and oversized recordings offline", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const request = { audio: new ArrayBuffer(1), mimeType: "audio/webm" };

    await expect(
      transcribeAudio(request, { apiKey: "", fetcher }),
    ).rejects.toThrow(VOICE_INPUT_ERROR_CODES.openAiKeyRequired);
    await expect(
      transcribeAudio(
        {
          audio: new ArrayBuffer(MAX_TRANSCRIPTION_BYTES + 1),
          mimeType: "audio/webm",
        },
        { apiKey: "test-key", fetcher },
      ),
    ).rejects.toThrow(VOICE_INPUT_ERROR_CODES.recordingTooLarge);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps authentication errors without exposing the upstream payload", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { message: "upstream credential detail" } }),
          { status: 401 },
        ),
    ) as unknown as typeof fetch;

    await expect(
      transcribeAudio(
        { audio: new ArrayBuffer(1), mimeType: "audio/webm" },
        { apiKey: "invalid-key", fetcher },
      ),
    ).rejects.toThrow(VOICE_INPUT_ERROR_CODES.openAiKeyInvalid);
  });

  it("validates renderer payloads before reading audio", () => {
    expect(
      parseAudioTranscriptionRequest({
        audio: new ArrayBuffer(2),
        mimeType: "audio/webm",
      }),
    ).toEqual({ audio: new ArrayBuffer(2), mimeType: "audio/webm" });
    expect(() =>
      parseAudioTranscriptionRequest({
        audio: "not-bytes",
        mimeType: "audio/webm",
      }),
    ).toThrow("Invalid audio transcription data");
  });
});
