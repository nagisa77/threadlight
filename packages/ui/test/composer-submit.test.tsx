import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createSubmissionGate } from "../src/app.js";
import { attachmentHint } from "../src/features/conversation-content.js";
import {
  I18nProvider,
  LANGUAGE_OPTIONS,
  useI18n,
  type Language,
  type Translate,
} from "../src/i18n.js";

function translate(
  key: string,
  values?: Record<string, string | number>,
): string {
  if (!values) return key;
  return key.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

describe("composer submission gate", () => {
  it("allows only one in-flight submission", () => {
    const gate = createSubmissionGate();
    expect(gate.pending).toBe(false);
    expect(gate.tryStart()).toBe(true);
    expect(gate.pending).toBe(true);
    // Rapid second Enter / send click while the first submission is in flight.
    expect(gate.tryStart()).toBe(false);
    expect(gate.tryStart()).toBe(false);
  });

  it("releases the gate after the submission settles", () => {
    const gate = createSubmissionGate();
    expect(gate.tryStart()).toBe(true);
    gate.stop();
    expect(gate.pending).toBe(false);
    expect(gate.tryStart()).toBe(true);
    gate.stop();
  });

  it("keeps the gate independent across instances", () => {
    const first = createSubmissionGate();
    const second = createSubmissionGate();
    expect(first.tryStart()).toBe(true);
    expect(second.pending).toBe(false);
    expect(second.tryStart()).toBe(true);
  });
});

describe("composer sending hint", () => {
  it("shows the sending hint while a submission is in flight", () => {
    const hint = attachmentHint(
      "idle",
      undefined,
      undefined,
      undefined,
      [],
      false,
      false,
      true,
      translate as Translate,
    );
    expect(hint).toBe("sending");
  });

  it("prefers submission failures over the sending hint", () => {
    const hint = attachmentHint(
      "idle",
      undefined,
      undefined,
      "runtime offline",
      [],
      false,
      false,
      true,
      translate as Translate,
    );
    expect(hint).toBe("sendFailed");
  });

  it("falls back to the regular composer hint when idle", () => {
    const hint = attachmentHint(
      "idle",
      undefined,
      undefined,
      undefined,
      [],
      false,
      false,
      false,
      translate as Translate,
    );
    expect(hint).toBe("composerHint");
  });
});

describe("sending copy", () => {
  it("defines the sending key for every supported language", () => {
    const expectations: Record<Language, string> = {
      "zh-CN": "正在发送…",
      en: "Sending…",
      ja: "送信中…",
      "zh-TW": "正在傳送…",
      ko: "전송 중…",
    };
    for (const option of LANGUAGE_OPTIONS) {
      const language = option.value as Language;
      let copy = "";
      function Probe() {
        const { t } = useI18n();
        copy = t("sending");
        return null;
      }
      renderToStaticMarkup(
        <I18nProvider language={language}>
          <Probe />
        </I18nProvider>,
      );
      expect(copy).toBe(expectations[language]);
    }
  });
});
