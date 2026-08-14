import type { ProjectSummary } from "../../projects.js";
import type { SettingsSnapshot } from "../../settings.js";
import { providerIsConfigured } from "../../settings-readiness.js";

export function composerProviderIsReady(
  settingsAvailable: boolean,
  runtimeSettings?: SettingsSnapshot,
): boolean {
  return settingsAvailable
    ? Boolean(runtimeSettings && providerIsConfigured(runtimeSettings))
    : true;
}

export function projectSupportsDevelopmentMode(
  project: Pick<ProjectSummary, "scope"> | undefined,
): boolean {
  return Boolean(project && project.scope !== "standalone");
}
