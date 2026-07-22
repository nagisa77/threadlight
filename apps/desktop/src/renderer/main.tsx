import { createRoot } from "react-dom/client";
import { ThreadlightClient } from "@threadlight/client";
import {
  ThreadlightApp,
  type ProjectMemoryAdapter,
  type ProjectsAdapter,
  type SettingsAdapter,
} from "@threadlight/ui";
import "@threadlight/ui/styles.css";

import { ElectronTransport } from "./electron-transport.js";

const client = new ThreadlightClient(new ElectronTransport());
const settings: SettingsAdapter = {
  load: () => window.threadlightDesktop.getSettings(),
  save: (update) => window.threadlightDesktop.updateSettings(update),
};
const projects: ProjectsAdapter = {
  load: () => window.threadlightDesktop.getProjects(),
  openFolder: () => window.threadlightDesktop.openProject(),
  activate: (projectId) =>
    window.threadlightDesktop.activateProject(projectId),
  upsertConversation: (update) =>
    window.threadlightDesktop.upsertConversation(update),
  deleteConversation: (target) =>
    window.threadlightDesktop.deleteConversation(target),
};
const memory: ProjectMemoryAdapter = {
  load: (projectId) => window.threadlightDesktop.getProjectMemory(projectId),
  open: (projectId) => window.threadlightDesktop.openProjectMemory(projectId),
};
const root = document.getElementById("root");

if (!root) throw new Error("Missing root element");

createRoot(root).render(
  <ThreadlightApp
    client={client}
    settings={settings}
    projects={projects}
    memory={memory}
  />,
);
