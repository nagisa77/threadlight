import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, "src/preload/index.ts"),
          "computer-preview": resolve(
            import.meta.dirname,
            "src/preload/computer-preview.ts",
          ),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
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
      ],
    },
    plugins: [react()],
  },
});
