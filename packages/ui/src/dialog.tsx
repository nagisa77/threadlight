import {
  useEffect,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";

import {
  collectBackgroundSiblings,
  dialogTabDestination,
} from "./dialog-logic.js";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not(:disabled)",
  "input:not(:disabled):not([type='hidden'])",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "iframe",
  "object",
  "embed",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const useClientLayoutEffect =
  typeof document === "undefined" ? useEffect : useLayoutEffect;

type DialogElement = HTMLDivElement | HTMLElement;
type DialogTag = "aside" | "div" | "section";

interface DialogController {
  backdrop: HTMLDivElement;
  panel: DialogElement;
  opener: HTMLElement | null;
  onClose(): void;
  dismissDisabled: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const dialogStack: DialogController[] = [];
const inertSnapshots = new Map<HTMLElement, boolean>();
let lockedBody: HTMLElement | undefined;
let previousBodyOverflow = "";

export interface DialogProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "role"
> {
  children: ReactNode;
  className: string;
  backdropClassName?: string;
  role?: "alertdialog" | "dialog";
  as?: DialogTag;
  onClose(): void;
  dismissDisabled?: boolean;
  closeOnBackdrop?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  panelRef?: RefObject<HTMLElement | null>;
}

/**
 * Shared modal primitive. It owns focus trapping/restoration, Escape handling,
 * scroll locking, and background inertness so modal call sites only describe
 * their content and whether dismissal is currently allowed.
 */
export function Dialog({
  children,
  className,
  backdropClassName = "dialog-backdrop",
  role = "dialog",
  as = "section",
  onClose,
  dismissDisabled = false,
  closeOnBackdrop = true,
  initialFocusRef,
  panelRef,
  tabIndex = -1,
  ...panelProps
}: DialogProps) {
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<DialogElement>(null);
  const controller = useRef<DialogController | undefined>(undefined);

  if (controller.current) {
    controller.current.onClose = onClose;
    controller.current.dismissDisabled = dismissDisabled;
    controller.current.initialFocusRef = initialFocusRef;
  }

  useClientLayoutEffect(() => {
    if (!backdrop.current || !panel.current) return;
    const ownerDocument = panel.current.ownerDocument;
    const activeElement = ownerDocument.activeElement;
    const nextController: DialogController = {
      backdrop: backdrop.current,
      panel: panel.current,
      opener: activeElement instanceof HTMLElement ? activeElement : null,
      onClose,
      dismissDisabled,
      initialFocusRef,
    };
    controller.current = nextController;
    registerDialog(nextController);
    focusDialog(nextController);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (topDialog() !== nextController) return;
      if (event.key === "Escape") {
        if (eventTargetIsDialogPortal(event.target)) return;
        if (nextController.dismissDisabled) return;
        event.preventDefault();
        nextController.onClose();
        return;
      }
      if (event.key !== "Tab") return;
      trapDialogFocus(event, nextController.panel);
    };
    const keepFocusInside = (event: FocusEvent) => {
      if (topDialog() !== nextController) return;
      const target = event.target;
      if (target instanceof Node && nextController.panel.contains(target)) {
        return;
      }
      if (eventTargetIsDialogPortal(target)) return;
      focusDialog(nextController);
    };
    ownerDocument.addEventListener("keydown", handleKeyDown);
    ownerDocument.addEventListener("focusin", keepFocusInside);
    return () => {
      ownerDocument.removeEventListener("keydown", handleKeyDown);
      ownerDocument.removeEventListener("focusin", keepFocusInside);
      unregisterDialog(nextController);
      controller.current = undefined;
    };
    // Modal registration is intentionally tied to mount/unmount. Mutable
    // controller fields above keep callbacks and busy state current.
  }, []);

  const Panel = as;
  const setPanel = (element: DialogElement | null) => {
    panel.current = element;
    if (panelRef) panelRef.current = element;
  };

  return (
    <div
      ref={backdrop}
      className={backdropClassName}
      data-dialog-backdrop=""
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          closeOnBackdrop &&
          !dismissDisabled
        ) {
          onClose();
        }
      }}
    >
      <Panel
        {...panelProps}
        ref={setPanel}
        className={className}
        role={role}
        aria-modal="true"
        tabIndex={tabIndex}
        data-dialog-panel=""
      >
        {children}
      </Panel>
    </div>
  );
}

function topDialog(): DialogController | undefined {
  return dialogStack.at(-1);
}

function registerDialog(controller: DialogController) {
  const body = controller.panel.ownerDocument.body;
  if (dialogStack.length === 0) {
    lockedBody = body;
    previousBodyOverflow = body.style.overflow;
    body.style.overflow = "hidden";
  }
  dialogStack.push(controller);
  refreshInertBackground(controller.panel.ownerDocument);
}

function unregisterDialog(controller: DialogController) {
  const wasTop = topDialog() === controller;
  const index = dialogStack.lastIndexOf(controller);
  if (index >= 0) dialogStack.splice(index, 1);
  refreshInertBackground(controller.panel.ownerDocument);
  if (dialogStack.length === 0) {
    if (lockedBody) lockedBody.style.overflow = previousBodyOverflow;
    lockedBody = undefined;
  }
  if (wasTop) restoreDialogFocus(controller);
}

function refreshInertBackground(ownerDocument: Document) {
  for (const [element, inert] of inertSnapshots) element.inert = inert;
  const activeDialog = topDialog();
  if (!activeDialog) {
    inertSnapshots.clear();
    return;
  }
  const background = collectBackgroundSiblings(
    activeDialog.backdrop,
    (element) => element.parentElement ?? undefined,
    (element) =>
      Array.from(element.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      ),
    ownerDocument.body,
  );
  for (const element of background) {
    if (!inertSnapshots.has(element)) {
      inertSnapshots.set(element, element.inert);
    }
    element.inert = true;
  }
}

function focusDialog(controller: DialogController) {
  const requested = controller.initialFocusRef?.current;
  const target =
    (requested && isFocusable(requested) ? requested : undefined) ??
    focusableElements(controller.panel)[0] ??
    controller.panel;
  target.focus({ preventScroll: true });
}

function restoreDialogFocus(controller: DialogController) {
  const opener = controller.opener;
  if (opener?.isConnected && !opener.closest("[inert]")) {
    opener.focus({ preventScroll: true });
    return;
  }
  const activeDialog = topDialog();
  if (activeDialog) focusDialog(activeDialog);
}

function trapDialogFocus(
  event: globalThis.KeyboardEvent,
  panel: DialogElement,
) {
  const focusable = focusableElements(panel);
  if (focusable.length === 0) {
    event.preventDefault();
    panel.focus({ preventScroll: true });
    return;
  }
  const active = panel.ownerDocument.activeElement;
  const destination = dialogTabDestination(
    focusable,
    active instanceof HTMLElement ? active : undefined,
    event.shiftKey,
  );
  if (!destination) return;
  event.preventDefault();
  destination.focus({ preventScroll: true });
}

function focusableElements(panel: DialogElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(isFocusable);
}

function isFocusable(element: HTMLElement): boolean {
  if (
    element.hidden ||
    element.matches(":disabled") ||
    element.getAttribute("aria-hidden") === "true" ||
    element.getAttribute("aria-disabled") === "true" ||
    element.closest("[inert]")
  ) {
    return false;
  }
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style?.display !== "none" && style?.visibility !== "hidden";
}

function eventTargetIsDialogPortal(target: EventTarget | null): boolean {
  return (
    target instanceof Element && Boolean(target.closest("[data-dialog-portal]"))
  );
}
