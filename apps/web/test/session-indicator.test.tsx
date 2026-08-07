import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider, type Language } from "@threadlight/ui/i18n";
import { WebSessionIndicator } from "../src/session-indicator.js";

describe("web session indicator", () => {
  it.each([
    ["en", "Disconnect from remote Host"],
    ["zh-CN", "断开远端 Host"],
    ["zh-TW", "中斷遠端 Host 連線"],
    ["ja", "リモート Host から切断"],
    ["ko", "원격 Host 연결 해제"],
  ] satisfies readonly [Language, string][])(
    "localizes the disconnect action in %s",
    (language, label) => {
      const html = renderToStaticMarkup(
        <I18nProvider language={language}>
          <WebSessionIndicator
            hostName="Development Host"
            onDisconnect={vi.fn()}
          />
        </I18nProvider>,
      );

      expect(html).toContain(`aria-label="${label}"`);
      expect(html).toContain(`title="${label}"`);
      expect(html).toContain("Development Host");
    },
  );
});
