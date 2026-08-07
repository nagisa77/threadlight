import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

export interface PopoverPosition {
  /** Distance from the viewport top to the popover's top edge. */
  top?: number;
  /** Distance from the viewport bottom to the popover's bottom edge. */
  bottom?: number;
  left: number;
  transformOrigin: "top left" | "top right" | "bottom left" | "bottom right";
}

export interface AnchoredPopoverOptions {
  width: number;
  height?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  gap?: number;
  margin?: number;
  align?: "start" | "end";
  placement?: "auto" | "top" | "bottom";
  pin?: "top" | "bottom";
}

interface PopoverEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface PopoverTrackingWindow extends PopoverEventTarget {
  visualViewport: PopoverEventTarget | null;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
}

/**
 * Keeps a fixed popover attached while mobile browsers resize and pan their
 * visual viewport around the software keyboard.
 */
export function observePopoverAnchor(
  reposition: () => void,
  trackingWindow: PopoverTrackingWindow = window,
  trackingDocument: PopoverEventTarget = document,
): () => void {
  const visualViewport = trackingWindow.visualViewport;
  const recoveryTimers = new Set<number>();
  let frame: number | undefined;

  const scheduleReposition = () => {
    if (frame !== undefined) trackingWindow.cancelAnimationFrame(frame);
    frame = trackingWindow.requestAnimationFrame(() => {
      frame = undefined;
      reposition();
    });
  };
  const stabilizeAfterFocusChange: EventListener = () => {
    for (const timer of recoveryTimers) trackingWindow.clearTimeout(timer);
    recoveryTimers.clear();
    for (const delay of [0, 120, 300, 500]) {
      const timer = trackingWindow.setTimeout(() => {
        recoveryTimers.delete(timer);
        scheduleReposition();
      }, delay);
      recoveryTimers.add(timer);
    }
  };

  trackingWindow.addEventListener("resize", scheduleReposition);
  trackingWindow.addEventListener("orientationchange", scheduleReposition);
  visualViewport?.addEventListener("resize", scheduleReposition);
  visualViewport?.addEventListener("scroll", scheduleReposition);
  trackingDocument.addEventListener("focusin", stabilizeAfterFocusChange);
  trackingDocument.addEventListener("focusout", stabilizeAfterFocusChange);
  scheduleReposition();

  return () => {
    if (frame !== undefined) trackingWindow.cancelAnimationFrame(frame);
    for (const timer of recoveryTimers) trackingWindow.clearTimeout(timer);
    trackingWindow.removeEventListener("resize", scheduleReposition);
    trackingWindow.removeEventListener("orientationchange", scheduleReposition);
    visualViewport?.removeEventListener("resize", scheduleReposition);
    visualViewport?.removeEventListener("scroll", scheduleReposition);
    trackingDocument.removeEventListener("focusin", stabilizeAfterFocusChange);
    trackingDocument.removeEventListener("focusout", stabilizeAfterFocusChange);
  };
}

export function anchoredPopoverPosition(
  bounds: Pick<DOMRect, "top" | "right" | "bottom"> & {
    left?: number;
  },
  options: AnchoredPopoverOptions,
): PopoverPosition {
  const viewportWidth =
    options.viewportWidth ?? window.visualViewport?.width ?? window.innerWidth;
  const viewportHeight =
    options.viewportHeight ??
    window.visualViewport?.height ??
    window.innerHeight;
  const gap = options.gap ?? 6;
  const margin = options.margin ?? 8;
  const align = options.align ?? "end";
  const placement = options.placement ?? "auto";
  const height = options.height ?? 0;

  const desiredLeft =
    align === "start"
      ? (bounds.left ?? bounds.right - options.width)
      : bounds.right - options.width;
  const left = Math.max(
    margin,
    Math.min(
      viewportWidth - options.width - margin,
      Math.max(margin, desiredLeft),
    ),
  );
  const origin = (opensBelow: boolean) =>
    `${opensBelow ? "top" : "bottom"} ${align === "start" ? "left" : "right"}` as const;

  // Pinned mode anchors one popover edge at a fixed distance from the
  // trigger, so the menu grows outward without depending on its own height.
  if (options.pin === "bottom") {
    const opensAbove = bounds.top - gap - margin >= margin;
    return {
      top: opensAbove ? undefined : bounds.bottom + gap,
      bottom: opensAbove ? viewportHeight - bounds.top + gap : undefined,
      left,
      transformOrigin: origin(!opensAbove),
    };
  }
  if (options.pin === "top") {
    const opensBelow = viewportHeight - bounds.bottom - gap - margin >= margin;
    return {
      top: opensBelow ? bounds.bottom + gap : undefined,
      bottom: opensBelow ? undefined : viewportHeight - bounds.top + gap,
      left,
      transformOrigin: origin(opensBelow),
    };
  }

  const opensBelow =
    placement === "bottom"
      ? true
      : placement === "top"
        ? false
        : viewportHeight - bounds.bottom >= height + gap + margin;
  return {
    top: opensBelow
      ? bounds.bottom + gap
      : Math.max(margin, bounds.top - height - gap),
    left,
    transformOrigin: origin(opensBelow),
  };
}

export function ActionPopover({
  label,
  position,
  className,
  role = "menu",
  anchorRef,
  anchorOptions,
  initialFocusRef,
  returnFocusRef,
  onClose,
  children,
}: {
  label: string;
  position: PopoverPosition;
  className?: string;
  role?: "menu" | "dialog";
  anchorRef?: RefObject<HTMLElement | null>;
  anchorOptions?: AnchoredPopoverOptions;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [trackedPosition, setTrackedPosition] = useState<{
    source: PopoverPosition;
    value: PopoverPosition;
  }>();
  const effectivePosition =
    trackedPosition?.source === position ? trackedPosition.value : position;

  useEffect(() => {
    if (!anchorRef || !anchorOptions) return;
    return observePopoverAnchor(() => {
      const bounds = anchorRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const value = anchoredPopoverPosition(bounds, anchorOptions);
      setTrackedPosition((current) =>
        current?.source === position &&
        current.value.top === value.top &&
        current.value.bottom === value.bottom &&
        current.value.left === value.left &&
        current.value.transformOrigin === value.transformOrigin
          ? current
          : { source: position, value },
      );
    });
  }, [anchorOptions, anchorRef, position]);

  useEffect(() => {
    const initialFocus =
      initialFocusRef?.current ?? popoverItems(root.current)[0];
    initialFocus?.focus();

    function closeFromOutside(event: globalThis.PointerEvent) {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !returnFocusRef?.current?.contains(event.target)
      ) {
        onCloseRef.current();
      }
    }
    window.addEventListener("pointerdown", closeFromOutside);
    return () => window.removeEventListener("pointerdown", closeFromOutside);
  }, [initialFocusRef, returnFocusRef]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
      returnFocusRef?.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      onCloseRef.current();
      return;
    }
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    if (
      (event.key === "Home" || event.key === "End") &&
      event.target instanceof HTMLInputElement
    ) {
      return;
    }
    const items = popoverItems(root.current);
    if (items.length === 0) return;
    event.preventDefault();
    if (event.key === "Home") {
      items[0]?.focus();
      return;
    }
    if (event.key === "End") {
      items.at(-1)?.focus();
      return;
    }
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next =
      current < 0
        ? event.key === "ArrowDown"
          ? 0
          : items.length - 1
        : (current + delta + items.length) % items.length;
    items[next]?.focus();
  }

  const style: CSSProperties = {
    top: effectivePosition.top,
    bottom: effectivePosition.bottom,
    left: effectivePosition.left,
    transformOrigin: effectivePosition.transformOrigin,
  };

  const popover = (
    <div
      ref={root}
      className={`action-popover${className ? ` ${className}` : ""}`}
      data-dialog-portal=""
      role={role}
      aria-label={label}
      style={style}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );

  return typeof document === "undefined"
    ? popover
    : createPortal(popover, document.body);
}

export function ActionPopoverItem({
  icon,
  children,
  disabled,
  onSelect,
}: {
  icon: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-popover-item
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="action-popover-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </button>
  );
}

export function ActionPopoverHeading({ children }: { children: ReactNode }) {
  return (
    <div className="action-popover-heading" aria-hidden="true">
      {children}
    </div>
  );
}

function popoverItems(root: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(
    root?.querySelectorAll<HTMLButtonElement>(
      "button[data-popover-item]:not(:disabled)",
    ) ?? [],
  );
}
