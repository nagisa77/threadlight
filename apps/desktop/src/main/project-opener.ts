import { execFile } from "node:child_process";

import type {
  DesktopProjectOpener,
  DesktopProjectOpenerOption,
} from "../shared/desktop-api.js";

const DISCOVER_PROJECT_OPENERS_SCRIPT = String.raw`
ObjC.import("AppKit");

function run(argv) {
  const targetURL = $.NSURL.fileURLWithPath(argv[0]);
  const workspace = $.NSWorkspace.sharedWorkspace;
  const applicationURLs = workspace.URLsForApplicationsToOpenURL(targetURL);
  const defaultURL = workspace.URLForApplicationToOpenURL(targetURL);
  const defaultPath = defaultURL ? ObjC.unwrap(defaultURL.path) : "";
  const openers = [];

  for (let index = 0; index < applicationURLs.count; index += 1) {
    const applicationPath = ObjC.unwrap(
      applicationURLs.objectAtIndex(index).path,
    );
    const bundle = $.NSBundle.bundleWithPath(applicationPath);
    const identifier = bundle ? ObjC.unwrap(bundle.bundleIdentifier) : "";
    if (!identifier) continue;
    const displayName = ObjC.unwrap(
      $.NSFileManager.defaultManager.displayNameAtPath(applicationPath),
    ).replace(/\.app$/i, "");
    const configuredIcon =
      bundle.objectForInfoDictionaryKey("CFBundleIconFile") ||
      bundle.objectForInfoDictionaryKey("CFBundleIconName");
    const configuredIconName = configuredIcon
      ? ObjC.unwrap(configuredIcon)
      : "";
    const iconFileName =
      configuredIconName && /\.icns$/i.test(configuredIconName)
        ? configuredIconName
        : configuredIconName
          ? configuredIconName + ".icns"
          : "";
    const iconPath = iconFileName
      ? applicationPath + "/Contents/Resources/" + iconFileName
      : "";
    openers.push({
      id: identifier,
      label: displayName,
      applicationPath,
      iconPath,
      default: applicationPath === defaultPath,
    });
  }

  return JSON.stringify(openers);
}
`;

interface DiscoveredProjectOpener {
  id: string;
  label: string;
  applicationPath: string;
  iconPath: string;
  default: boolean;
}

export interface ProjectOpenerMetadata extends DesktopProjectOpenerOption {
  applicationPath: string;
  iconPath?: string;
}

export async function projectOpeners(
  basePath: string,
  options: {
    platform?: NodeJS.Platform;
    runScript?: (
      executable: string,
      args: readonly string[],
    ) => Promise<string>;
  } = {},
): Promise<readonly ProjectOpenerMetadata[]> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    return [
      {
        id: "system",
        label: "File Manager",
        applicationPath: "",
        available: true,
        default: true,
      },
    ];
  }

  const runScript = options.runScript ?? runForOutput;
  const output = await runScript("/usr/bin/osascript", [
    "-l",
    "JavaScript",
    "-e",
    DISCOVER_PROJECT_OPENERS_SCRIPT,
    basePath,
  ]);
  return parseDiscoveredOpeners(output);
}

export async function openProjectWith(
  basePath: string,
  opener: DesktopProjectOpener,
  options: {
    platform?: NodeJS.Platform;
    runApplication?: (
      executable: string,
      args: readonly string[],
    ) => Promise<void>;
    openPath?: (path: string) => Promise<string>;
  } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    if (opener !== "system" || !options.openPath) {
      throw new Error("The selected project app is not available");
    }
    const error = await options.openPath(basePath);
    if (error) throw new Error(error);
    return;
  }

  const runApplication = options.runApplication ?? run;
  await runApplication("/usr/bin/open", ["-b", opener, basePath]);
}

export function parseDiscoveredOpeners(
  output: string,
): readonly ProjectOpenerMetadata[] {
  const value = JSON.parse(output) as unknown;
  if (!Array.isArray(value)) throw new Error("Invalid project opener result");
  const seen = new Set<string>();
  const openers: ProjectOpenerMetadata[] = [];
  for (const candidate of value) {
    if (!isDiscoveredProjectOpener(candidate) || seen.has(candidate.id)) {
      continue;
    }
    seen.add(candidate.id);
    openers.push({
      id: candidate.id,
      label: candidate.label,
      applicationPath: candidate.applicationPath,
      ...(candidate.iconPath ? { iconPath: candidate.iconPath } : {}),
      available: true,
      default: candidate.default,
    });
  }
  return openers.sort(
    (left, right) => Number(right.default) - Number(left.default),
  );
}

function isDiscoveredProjectOpener(
  value: unknown,
): value is DiscoveredProjectOpener {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const opener = value as Record<string, unknown>;
  return (
    typeof opener.id === "string" &&
    opener.id.length > 0 &&
    typeof opener.label === "string" &&
    opener.label.length > 0 &&
    typeof opener.applicationPath === "string" &&
    opener.applicationPath.endsWith(".app") &&
    typeof opener.iconPath === "string" &&
    typeof opener.default === "boolean"
  );
}

function run(executable: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function runForOutput(
  executable: string,
  args: readonly string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
