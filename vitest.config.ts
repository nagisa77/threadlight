import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors apps/web/vite.config.ts for offline tests.
      "@threadlight/ui/popover": fileURLToPath(
        new URL("./packages/ui/src/popover.tsx", import.meta.url),
      ),
    },
  },
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
