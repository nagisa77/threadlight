import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  I18nProvider,
  LANGUAGE_OPTIONS,
  useI18n,
  type Language,
} from "../src/i18n.js";

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

describe("i18n", () => {
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

  it("renders Traditional Chinese and Korean strings", () => {
    expect(renderLanguage("zh-TW")).toContain("<h1>設定</h1>");
    expect(renderLanguage("ko")).toContain("<h1>설정</h1>");
    expect(renderLanguage("ko")).toContain("파일 변경됨");
  });
});
