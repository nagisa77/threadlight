interface ViewportTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface ViewportMeasurement extends ViewportTarget {
  height: number;
}

interface ViewportWindow extends ViewportTarget {
  innerHeight: number;
  visualViewport: ViewportMeasurement | null;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
  scrollTo(x: number, y: number): void;
}

interface ViewportDocument extends ViewportTarget {
  documentElement: {
    style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">;
  };
}

export function installMobileViewportHeight(
  viewportWindow: ViewportWindow = window,
  viewportDocument: ViewportDocument = document,
): () => void {
  const root = viewportDocument.documentElement;
  const visualViewport = viewportWindow.visualViewport;
  let frame: number | undefined;
  const recoveryTimers = new Set<number>();

  const applyMeasurement = () => {
    const height = visualViewport?.height ?? viewportWindow.innerHeight;
    root.style.setProperty("--web-viewport-height", `${height}px`);
  };
  const measure = () => {
    frame = undefined;
    applyMeasurement();
  };
  const scheduleMeasure: EventListener = () => {
    if (frame !== undefined) viewportWindow.cancelAnimationFrame(frame);
    frame = viewportWindow.requestAnimationFrame(measure);
  };
  const stabilizeAfterFocusChange: EventListener = () => {
    for (const timer of recoveryTimers) viewportWindow.clearTimeout(timer);
    recoveryTimers.clear();
    for (const delay of [0, 120, 300, 500]) {
      const timer = viewportWindow.setTimeout(() => {
        recoveryTimers.delete(timer);
        applyMeasurement();
        viewportWindow.scrollTo(0, 0);
      }, delay);
      recoveryTimers.add(timer);
    }
  };

  applyMeasurement();
  viewportWindow.addEventListener("resize", scheduleMeasure);
  viewportWindow.addEventListener("orientationchange", scheduleMeasure);
  visualViewport?.addEventListener("resize", scheduleMeasure);
  visualViewport?.addEventListener("scroll", scheduleMeasure);
  viewportDocument.addEventListener("focusin", stabilizeAfterFocusChange);
  viewportDocument.addEventListener("focusout", stabilizeAfterFocusChange);

  return () => {
    if (frame !== undefined) viewportWindow.cancelAnimationFrame(frame);
    for (const timer of recoveryTimers) viewportWindow.clearTimeout(timer);
    viewportWindow.removeEventListener("resize", scheduleMeasure);
    viewportWindow.removeEventListener("orientationchange", scheduleMeasure);
    visualViewport?.removeEventListener("resize", scheduleMeasure);
    visualViewport?.removeEventListener("scroll", scheduleMeasure);
    viewportDocument.removeEventListener("focusin", stabilizeAfterFocusChange);
    viewportDocument.removeEventListener("focusout", stabilizeAfterFocusChange);
    root.style.removeProperty("--web-viewport-height");
  };
}
