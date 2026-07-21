import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.cjs",
        },
      },
    },
  },
  renderer: {
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
      ],
    },
    plugins: [react()],
  },
});
