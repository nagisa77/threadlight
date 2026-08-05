import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      exclude: [
        "**/dist/**",
        "**/test/**",
        "**/*.d.ts",
        "**/*.config.*",
        "apps/desktop/src/main/computer-input/**",
      ],
      thresholds: {
        lines: 56,
        functions: 50,
        statements: 53,
        branches: 49,
      },
    },
  },
});
