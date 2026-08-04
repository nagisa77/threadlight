import DiffViewer from "react-diff-viewer-continued";
import type { ComponentProps } from "react";

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
  return (
    <DiffViewer
      oldValue={oldValue}
      newValue={newValue}
      splitView={layout === "split"}
      useDarkTheme={dark}
      showDiffOnly
      extraLinesSurroundingDiff={3}
      hideSummary
      disableWorker
      highlightLanguage={language}
      styles={styles}
    />
  );
}
