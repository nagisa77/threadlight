import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  defineMessageCatalog,
  I18nProvider,
  LANGUAGE_OPTIONS,
  useI18n,
  type Language,
} from "../src/i18n.js";
import { en } from "../src/features/i18n/messages/en.js";
import { ja } from "../src/features/i18n/messages/ja.js";
import { ko } from "../src/features/i18n/messages/ko.js";
import { zh } from "../src/features/i18n/messages/zh-CN.js";
import { zhTW } from "../src/features/i18n/messages/zh-TW.js";

function Example() {
  const { t } = useI18n();
  return (
    <main>
      <h1>{t("settings")}</h1>
      <p>{t("filesChanged", { count: 3 })}</p>
      <label>{t("language")}</label>
    </main>
  );
}

function renderLanguage(language: Language): string {
  return renderToStaticMarkup(
    <I18nProvider language={language}>
      <Example />
    </I18nProvider>,
  );
}

function FileMenuLabels() {
  const { t } = useI18n();
  return (
    <div>
      <span>{t("previewInThreadlight")}</span>
      <span>{t("revealInFinder")}</span>
    </div>
  );
}

describe("i18n", () => {
  it("ships complete standalone catalogs with matching placeholders", () => {
    const catalogs = { "zh-CN": zh, "zh-TW": zhTW, en, ja, ko } as const;
    const canonicalKeys = Object.keys(zh).sort();

    for (const [language, catalog] of Object.entries(catalogs)) {
      expect(Object.keys(catalog).sort(), language).toEqual(canonicalKeys);
      for (const key of canonicalKeys) {
        expect(
          placeholders(catalog[key as keyof typeof catalog]),
          `${language}.${key}`,
        ).toEqual(placeholders(zh[key as keyof typeof zh]));
      }
    }

    for (const locale of ["en", "ja", "ko"] as const) {
      const source = readFileSync(
        new URL(`../src/features/i18n/messages/${locale}.ts`, import.meta.url),
        "utf8",
      );
      expect(source).not.toMatch(/\.\.\.(?:zh|en)/);
    }
  });

  it("validates scoped catalogs through the shared catalog contract", () => {
    const catalog = defineMessageCatalog<{ label: string }>({
      "zh-CN": { label: "标签" },
      "zh-TW": { label: "標籤" },
      en: { label: "Label" },
      ja: { label: "ラベル" },
      ko: { label: "레이블" },
    });
    expect(catalog.ja.label).toBe("ラベル");
  });

  it("ships Chinese, English, and Japanese language choices", () => {
    expect(LANGUAGE_OPTIONS).toEqual([
      { value: "zh-CN", label: "简体中文" },
      { value: "zh-TW", label: "繁體中文" },
      { value: "en", label: "English" },
      { value: "ja", label: "日本語" },
      { value: "ko", label: "한국어" },
    ]);
  });

  it("renders English strings and interpolation offline", () => {
    expect(renderLanguage("en")).toContain("<h1>Settings</h1>");
    expect(renderLanguage("en")).toContain("3 files changed");
  });

  it("renders Japanese strings and interpolation offline", () => {
    expect(renderLanguage("ja")).toContain("<h1>設定</h1>");
    expect(renderLanguage("ja")).toContain("3 件のファイルを変更");
    expect(renderLanguage("ja")).toContain("<label>言語</label>");
  });

  it("renders an independent Traditional Chinese dictionary with Taiwan terminology", () => {
    expect(renderLanguage("zh-TW")).toContain("<h1>設定</h1>");
    expect(renderLanguage("zh-TW")).toContain("已變更 3 個檔案");
    expect(renderLanguage("zh-TW")).toContain("<label>語言</label>");

    const source = readFileSync(
      new URL("../src/features/i18n/messages/zh-TW.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("export const zhTW: Messages = {");
    expect(source).not.toContain("traditionalize(");
  });

  it("renders Korean strings", () => {
    expect(renderLanguage("ko")).toContain("<h1>설정</h1>");
    expect(renderLanguage("ko")).toContain("파일 변경됨");
  });

  it.each([
    ["zh-CN", "在 Threadlight 内预览", "在 Finder 中显示"],
    ["zh-TW", "在 Threadlight 內預覽", "在 Finder 中顯示"],
    ["en", "Preview in Threadlight", "Show in Finder"],
    ["ja", "Threadlight でプレビュー", "Finder に表示"],
    ["ko", "Threadlight에서 미리 보기", "Finder에서 보기"],
  ] as const)(
    "localizes file menu actions in %s",
    (language, preview, reveal) => {
      const html = renderToStaticMarkup(
        <I18nProvider language={language}>
          <FileMenuLabels />
        </I18nProvider>,
      );
      expect(html).toContain(preview);
      expect(html).toContain(reveal);
    },
  );
});

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}
