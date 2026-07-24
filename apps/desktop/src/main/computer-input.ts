import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { ComputerUseAction } from "@threadlight/builtin-tools";

export type RoutedComputerAction =
  | (Extract<
      ComputerUseAction,
      { type: "click" | "double_click" | "move" | "scroll" }
    > & {
      processId?: number;
    })
  | (Extract<ComputerUseAction, { type: "drag" }> & {
      processId?: number;
    })
  | (Extract<ComputerUseAction, { type: "keypress" | "type" }> & {
      processId?: number;
    });

export interface NativeComputerInputAddon {
  perform(request: string): void;
}

let nativeAddon: NativeComputerInputAddon | undefined;

export async function performMacOSComputerActions(
  actions: readonly RoutedComputerAction[],
  inputMode: "virtual" | "system",
  signal: AbortSignal,
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Desktop computer input currently requires macOS");
  }
  if (actions.length === 0) return;
  if (signal.aborted) throw signal.reason;
  performComputerActionsWithAddon(loadNativeAddon(), actions, inputMode);
  if (signal.aborted) throw signal.reason;
}

export function performComputerActionsWithAddon(
  addon: NativeComputerInputAddon,
  actions: readonly RoutedComputerAction[],
  inputMode: "virtual" | "system",
): void {
  addon.perform(JSON.stringify({ actions, inputMode }));
}

export function nativeComputerInputCandidates(
  moduleDirectory = import.meta.dirname,
): readonly string[] {
  const resourcesPath =
    typeof process.resourcesPath === "string"
      ? resolve(
          process.resourcesPath,
          "app.asar.unpacked/out/native/computer-input.node",
        )
      : undefined;
  return [
    process.env.THREADLIGHT_COMPUTER_INPUT_NATIVE,
    resolve(moduleDirectory, "../native/computer-input.node"),
    resolve(moduleDirectory, "../../out/native/computer-input.node"),
    resourcesPath,
  ].filter((candidate): candidate is string => !!candidate);
}

function loadNativeAddon(): NativeComputerInputAddon {
  if (nativeAddon) return nativeAddon;
  const path = nativeComputerInputCandidates().find(existsSync);
  if (!path) {
    throw new Error(
      "The native macOS computer input module is missing. Rebuild Threadlight and restart the app.",
    );
  }
  const loaded = createRequire(import.meta.url)(path) as unknown;
  if (
    !loaded ||
    typeof loaded !== "object" ||
    typeof (loaded as Partial<NativeComputerInputAddon>).perform !== "function"
  ) {
    throw new Error("The native macOS computer input module is invalid");
  }
  nativeAddon = loaded as NativeComputerInputAddon;
  return nativeAddon;
}
