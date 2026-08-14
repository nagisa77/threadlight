import { describe, expect, it } from "vitest";
import { VOICE_INPUT_ERROR_CODES } from "@threadlight/protocol";
import type { Translate } from "../src/i18n.js";

import {
  appendVoiceTranscript,
  preferredRecordingMimeType,
  voiceInputErrorMessage,
} from "../src/voice-input.js";

describe("voice input", () => {
  it("chooses the first recording format supported by the browser", () => {
    expect(
      preferredRecordingMimeType((mimeType) => mimeType === "audio/webm"),
    ).toBe("audio/webm");
    expect(preferredRecordingMimeType(() => false)).toBeUndefined();
  });

  it("appends Chinese and English transcripts with natural spacing", () => {
    expect(appendVoiceTranscript("请帮我", "  修复测试  ")).toBe(
      "请帮我修复测试",
    );
    expect(appendVoiceTranscript("Please", "fix the tests")).toBe(
      "Please fix the tests",
    );
    expect(appendVoiceTranscript("已有内容\n", "继续")).toBe("已有内容\n继续");
  });

  it("turns microphone permission failures into actionable copy", () => {
    expect(
      voiceInputErrorMessage(
        new DOMException("Permission denied", "NotAllowedError"),
      ),
    ).toContain("System Settings");
  });

  it("localizes stable transport errors instead of matching transport copy", () => {
    const t = ((key: string, values?: Record<string, string | number>) =>
      values?.status ? `${key}:${values.status}` : key) as Translate;

    expect(
      voiceInputErrorMessage(
        new Error(VOICE_INPUT_ERROR_CODES.openAiKeyRequired),
        t,
      ),
    ).toBe("configureOpenAIForVoice");
    expect(
      voiceInputErrorMessage(
        new Error(
          `${VOICE_INPUT_ERROR_CODES.transcriptionFailed}:503:${encodeURIComponent("upstream unavailable")}`,
        ),
        t,
      ),
    ).toBe("voiceTranscriptionFailed:503 upstream unavailable");
  });
});
