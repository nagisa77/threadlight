import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.THREADLIGHT_WEB_BASE_PATH ?? "/",
  resolve: {
    alias: [
      {
        find: "@threadlight/ui/styles.css",
        replacement: resolve(
          import.meta.dirname,
          "../../packages/ui/src/styles.css",
        ),
      },
      {
        find: "@threadlight/ui",
        replacement: resolve(
          import.meta.dirname,
          "../../packages/ui/src/index.ts",
        ),
      },
      {
        find: "@threadlight/web-runtime",
        replacement: resolve(
          import.meta.dirname,
          "../../packages/web-runtime/src/index.ts",
        ),
      },
    ],
  },
  plugins: [react()],
});
