import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { initialWebStartupPhase } from "../src/startup.js";

describe("Web startup transaction", () => {
  it("restores an active saved session without rendering the connection page", () => {
    expect(
      initialWebStartupPhase(
        { endpoint: "https://host.example.com", token: "token" },
        true,
      ),
    ).toBe("restoring");
  });

  it("shows the connection page when credentials or active-session metadata are missing", () => {
    expect(
      initialWebStartupPhase(
        { endpoint: "https://host.example.com", token: "" },
        true,
      ),
    ).toBe("connection");
    expect(
      initialWebStartupPhase(
        { endpoint: "https://host.example.com", token: "token" },
        false,
      ),
    ).toBe("connection");
  });

  it("keeps the restored app hidden until its initial task and scroll position are ready", () => {
    const source = readFileSync(
      new URL("../src/main.tsx", import.meta.url),
      "utf8",
    );
    const styles = readFileSync(
      new URL("../src/web.css", import.meta.url),
      "utf8",
    );

    expect(source).toContain("className={`web-runtime${appReady");
    expect(source).toContain("onInitialViewReady={() => setAppReady(true)}");
    expect(source).not.toContain("Loading Threadlight");
    expect(styles).toMatch(
      /\.web-runtime\.is-restoring\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/s,
    );
  });
});
