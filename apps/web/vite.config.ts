import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.THREADLIGHT_WEB_BASE_PATH ?? "/",
  build: {
    manifest: true,
  },
  resolve: {
    alias: [
      {
        find: "@threadlight/ui/app",
        replacement: resolve(
          import.meta.dirname,
          "../../packages/ui/src/app.tsx",
        ),
      },
      {
        find: "@threadlight/ui/i18n",
        replacement: resolve(
          import.meta.dirname,
          "../../packages/ui/src/i18n.tsx",
        ),
      },
      {
        find: "@threadlight/ui/theme",
        replacement: resolve(
          import.meta.dirname,
          "../../packages/ui/src/theme.tsx",
        ),
      },
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
