import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {},
  preload: {
    build: {
      // Sandboxed Electron preload scripts can only require Electron and a
      // small Node.js allowlist. Bundle the protocol values used by the bridge
      // instead of leaving a workspace-package require in the output.
      externalizeDeps: {
        exclude: ["@threadlight/protocol"],
      },
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
