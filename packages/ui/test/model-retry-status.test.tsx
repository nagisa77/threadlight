import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ModelRetryStatus } from "../src/conversation-surface.js";
import { I18nProvider } from "../src/i18n.js";

describe("ModelRetryStatus", () => {
  it("renders concise localized automatic retry feedback", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <ModelRetryStatus
          retry={{
            retryAttempt: 1,
            maxRetries: 1,
            reason: "connection_lost",
          }}
        />
      </I18nProvider>,
    );

    expect(html).toContain('class="model-retry-row"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("模型连接中断，正在自动重试（1/1）…");
  });
});
