import type { DesktopApi } from "../shared/desktop-api.js";

declare global {
  interface Window {
    threadlightDesktop: DesktopApi;
  }
}

export {};
