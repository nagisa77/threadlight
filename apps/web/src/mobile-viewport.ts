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
}

interface ViewportDocument {
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

  const measure = () => {
    frame = undefined;
    const height = visualViewport?.height ?? viewportWindow.innerHeight;
    root.style.setProperty("--web-viewport-height", `${height}px`);
  };
  const scheduleMeasure: EventListener = () => {
    if (frame !== undefined) viewportWindow.cancelAnimationFrame(frame);
    frame = viewportWindow.requestAnimationFrame(measure);
  };

  measure();
  viewportWindow.addEventListener("resize", scheduleMeasure);
  viewportWindow.addEventListener("orientationchange", scheduleMeasure);
  visualViewport?.addEventListener("resize", scheduleMeasure);
  visualViewport?.addEventListener("scroll", scheduleMeasure);

  return () => {
    if (frame !== undefined) viewportWindow.cancelAnimationFrame(frame);
    viewportWindow.removeEventListener("resize", scheduleMeasure);
    viewportWindow.removeEventListener("orientationchange", scheduleMeasure);
    visualViewport?.removeEventListener("resize", scheduleMeasure);
    visualViewport?.removeEventListener("scroll", scheduleMeasure);
    root.style.removeProperty("--web-viewport-height");
  };
}
