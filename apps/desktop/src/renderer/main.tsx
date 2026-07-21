import { createRoot } from "react-dom/client";
import { ThreadlightClient } from "@threadlight/client";
import { ThreadlightApp, type SettingsAdapter } from "@threadlight/ui";
import "@threadlight/ui/styles.css";

import { ElectronTransport } from "./electron-transport.js";

const client = new ThreadlightClient(new ElectronTransport());
const settings: SettingsAdapter = {
  load: () => window.threadlightDesktop.getSettings(),
  save: (update) => window.threadlightDesktop.updateSettings(update),
};
const root = document.getElementById("root");

if (!root) throw new Error("Missing root element");

createRoot(root).render(<ThreadlightApp client={client} settings={settings} />);
