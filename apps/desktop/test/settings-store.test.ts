import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  runtimeEnvironment,
  SettingsStore,
  type SecretCodec,
} from "../src/main/settings-store.js";

const directories: string[] = [];
const codec: SecretCodec = {
  encrypt: (value) => Buffer.from(`protected:${value}`).toString("base64"),
  decrypt: (value) =>
    Buffer.from(value, "base64").toString("utf8").replace(/^protected:/, ""),
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), "threadlight-settings-"));
  directories.push(directory);
  const path = join(directory, "settings.json");
  return { path, store: new SettingsStore(path, codec) };
}

describe("SettingsStore", () => {
  it("encrypts API keys and exposes only configuration status", () => {
    const { path, store } = createStore();

    const snapshot = store.update(
      {
        openAIApiKey: "  sk-test-openai  ",
        searchApiKey: "search-test-key",
        autoApproveAll: true,
      },
      {},
    );

    expect(snapshot).toEqual({
      openAIApiKeyConfigured: true,
      searchApiKeyConfigured: true,
      autoApproveAll: true,
    });
    expect(readFileSync(path, "utf8")).not.toContain("sk-test-openai");
    expect(readFileSync(path, "utf8")).not.toContain("search-test-key");
    expect(store.runtimeSettings({})).toEqual({
      openAIApiKey: "sk-test-openai",
      searchApiKey: "search-test-key",
      autoApproveAll: true,
    });
  });

  it("keeps unchanged keys, supports clearing, and falls back to environment", () => {
    const { store } = createStore();
    store.update(
      { openAIApiKey: "stored-key", autoApproveAll: false },
      {},
    );

    store.update(
      { openAIApiKey: null, autoApproveAll: false },
      { OPENAI_API_KEY: "environment-key" },
    );

    expect(
      store.runtimeSettings({ OPENAI_API_KEY: "environment-key" }),
    ).toEqual({
      openAIApiKey: "environment-key",
      searchApiKey: undefined,
      autoApproveAll: false,
    });
  });

  it("maps runtime settings to child-process environment variables", () => {
    expect(
      runtimeEnvironment({
        openAIApiKey: "openai",
        searchApiKey: "search",
        autoApproveAll: true,
      }),
    ).toEqual({
      OPENAI_API_KEY: "openai",
      BRAVE_SEARCH_API_KEY: "search",
      THREADLIGHT_AUTO_APPROVE: "1",
    });
  });
});
