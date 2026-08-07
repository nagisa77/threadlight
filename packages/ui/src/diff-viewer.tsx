import DiffViewer from "react-diff-viewer-continued";
import { useSyncExternalStore, type ComponentProps } from "react";

export const MOBILE_DIFF_QUERY = "(max-width: 720px)";

type MatchMedia = (query: string) => MediaQueryList;

function browserMatchMedia(): MatchMedia | undefined {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return undefined;
  }
  return window.matchMedia.bind(window);
}

export function isMobileDiffViewport(
  matchMedia: MatchMedia | undefined = browserMatchMedia(),
): boolean {
  return matchMedia?.(MOBILE_DIFF_QUERY).matches ?? false;
}

export function subscribeToMobileDiffViewport(
  onStoreChange: () => void,
  matchMedia: MatchMedia | undefined = browserMatchMedia(),
): () => void {
  if (!matchMedia) return () => undefined;
  const media = matchMedia(MOBILE_DIFF_QUERY);
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function serverMobileDiffViewport(): boolean {
  return false;
}

export function ReviewDiffViewer({
  oldValue,
  newValue,
  layout,
  dark,
  language,
  styles,
}: {
  oldValue: string;
  newValue: string;
  layout: "unified" | "split";
  dark: boolean;
  language?: string;
  styles: ComponentProps<typeof DiffViewer>["styles"];
}) {
  const mobileViewport = useSyncExternalStore(
    subscribeToMobileDiffViewport,
    isMobileDiffViewport,
    serverMobileDiffViewport,
  );
  const effectiveLayout = mobileViewport ? "unified" : layout;

  return (
    <DiffViewer
      key={`${effectiveLayout}-${mobileViewport ? "compact" : "full"}`}
      oldValue={oldValue}
      newValue={newValue}
      splitView={effectiveLayout === "split"}
      useDarkTheme={dark}
      showDiffOnly
      extraLinesSurroundingDiff={3}
      hideSummary
      hideLineNumbers={mobileViewport}
      disableWorker
      highlightLanguage={language}
      styles={styles}
    />
  );
}
