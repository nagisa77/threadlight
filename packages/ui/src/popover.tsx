import {
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

export interface PopoverPosition {
  top: number;
  left: number;
  transformOrigin:
    | "top left"
    | "top right"
    | "bottom left"
    | "bottom right";
}

export function anchoredPopoverPosition(
  bounds: Pick<DOMRect, "top" | "right" | "bottom"> & {
    left?: number;
  },
  options: {
    width: number;
    height: number;
    viewportWidth?: number;
    viewportHeight?: number;
    gap?: number;
    margin?: number;
    align?: "start" | "end";
  },
): PopoverPosition {
  const viewportWidth = options.viewportWidth ?? window.innerWidth;
  const viewportHeight = options.viewportHeight ?? window.innerHeight;
  const gap = options.gap ?? 6;
  const margin = options.margin ?? 8;
  const align = options.align ?? "end";
  const opensBelow =
    viewportHeight - bounds.bottom >= options.height + gap + margin;
  const desiredLeft =
    align === "start"
      ? (bounds.left ?? bounds.right - options.width)
      : bounds.right - options.width;
  return {
    top: opensBelow
      ? bounds.bottom + gap
      : Math.max(margin, bounds.top - options.height - gap),
    left: Math.max(
      margin,
      Math.min(
        viewportWidth - options.width - margin,
        Math.max(margin, desiredLeft),
      ),
    ),
    transformOrigin: `${opensBelow ? "top" : "bottom"} ${align === "start" ? "left" : "right"}`,
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
    return () =>
      window.removeEventListener("pointerdown", closeFromOutside);
  }, [initialFocusRef, returnFocusRef]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
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
    left: position.left,
    transformOrigin: position.transformOrigin,
  };

  return (
    <div
      ref={root}
      className={`action-popover${className ? ` ${className}` : ""}`}
      role={role}
      aria-label={label}
      style={style}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
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

function popoverItems(root: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(
    root?.querySelectorAll<HTMLButtonElement>(
      "button[data-popover-item]:not(:disabled)",
    ) ?? [],
  );
}
