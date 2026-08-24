import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ModelRetryStatus } from "../src/conversation-surface.js";
import { I18nProvider } from "../src/i18n.js";
import { readUiStyles } from "./style-source.js";

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

  it("distinguishes an empty provider response from a dropped connection", () => {
    const html = renderToStaticMarkup(
      <I18nProvider language="zh-CN">
        <ModelRetryStatus
          retry={{
            retryAttempt: 2,
            maxRetries: 2,
            reason: "empty_response",
          }}
        />
      </I18nProvider>,
    );

    expect(html).toContain("模型返回了空响应，正在自动重试（2/2）…");
  });

  it("keeps retry feedback separated from streamed text", () => {
    expect(readUiStyles()).toContain(
      ".streaming-copy + :is(.thinking-row, .model-retry-row) {\n  margin-top: 12px;\n}",
    );
  });
});
