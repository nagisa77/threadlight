import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://threadlight.xyz",
  output: "static",
  build: {
    assets: "assets",
  },
  vite: {
    build: {
      cssMinify: "lightningcss",
    },
  },
});
