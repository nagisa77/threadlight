import {
  useEffect,
  useRef,
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

export function anchoredPopoverPosition(
  bounds: Pick<DOMRect, "top" | "right" | "bottom"> & {
    left?: number;
  },
  options: {
    width: number;
    height?: number;
    viewportWidth?: number;
    viewportHeight?: number;
    gap?: number;
    margin?: number;
    align?: "start" | "end";
    placement?: "auto" | "top" | "bottom";
    pin?: "top" | "bottom";
  },
): PopoverPosition {
  const viewportWidth = options.viewportWidth ?? window.innerWidth;
  const viewportHeight = options.viewportHeight ?? window.innerHeight;
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
  initialFocusRef,
  returnFocusRef,
  onClose,
  children,
}: {
  label: string;
  position: PopoverPosition;
  className?: string;
  role?: "menu" | "dialog";
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
    top: position.top,
    bottom: position.bottom,
    left: position.left,
    transformOrigin: position.transformOrigin,
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
