import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ChevronDown,
  Code2,
  FolderOpen,
  LoaderCircle,
  Terminal,
} from "lucide-react";

import { useI18n } from "./i18n.js";

export type ProjectOpenerId = string;

export interface ProjectOpenerOption {
  id: ProjectOpenerId;
  label: string;
  available: boolean;
  default: boolean;
  iconDataUrl?: string;
}

export interface ProjectOpenerAdapter {
  load(projectId?: string): Promise<readonly ProjectOpenerOption[]>;
  open(
    projectId: string,
    opener: ProjectOpenerId,
    threadId?: string,
  ): Promise<void>;
}

export function ProjectOpenControl({
  adapter,
  projectId,
  threadId,
  preferred,
  openers,
}: {
  adapter: ProjectOpenerAdapter;
  projectId: string;
  threadId?: string;
  preferred: ProjectOpenerId;
  openers: readonly ProjectOpenerOption[];
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [opening, setOpening] = useState<ProjectOpenerId>();
  const [error, setError] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuItems = useRef<Array<HTMLButtonElement | null>>([]);
  const availableOpeners = openers.filter((opener) => opener.available);
  const selected =
    resolvePreferredProjectOpener(availableOpeners, preferred) ??
    availableOpeners.find((opener) => opener.default) ??
    availableOpeners[0];

  useEffect(() => {
    setMenuOpen(false);
    setError(undefined);
  }, [projectId, threadId]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuTrigger.current?.focus();
    };
    window.addEventListener("pointerdown", closeFromOutside);
    window.addEventListener("keydown", closeFromKeyboard);
    return () => {
      window.removeEventListener("pointerdown", closeFromOutside);
      window.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [menuOpen]);

  async function openWith(opener: ProjectOpenerOption) {
    if (opening) return;
    setOpening(opener.id);
    setError(undefined);
    try {
      await adapter.open(projectId, opener.id, threadId);
      setMenuOpen(false);
    } catch (reason) {
      setError(
        t("openProjectFailed", {
          message: reason instanceof Error ? reason.message : String(reason),
        }),
      );
      setMenuOpen(true);
    } finally {
      setOpening(undefined);
    }
  }

  function handleMenuKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") {
      nextIndex = (index + 1) % availableOpeners.length;
    } else if (event.key === "ArrowUp") {
      nextIndex =
        (index - 1 + availableOpeners.length) % availableOpeners.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = availableOpeners.length - 1;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    menuItems.current[nextIndex]?.focus();
  }

  if (!selected) return null;

  return (
    <div className="project-open-control" ref={root}>
      <div className="project-open-split">
        <button
          type="button"
          className="project-open-primary pressable"
          aria-label={t("openProjectIn", { app: selected.label })}
          title={t("openProjectIn", { app: selected.label })}
          disabled={Boolean(opening)}
          onClick={() => void openWith(selected)}
        >
          {opening === selected.id ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <ProjectOpenerIcon opener={selected} />
          )}
        </button>
        <button
          ref={menuTrigger}
          type="button"
          className="project-open-menu-trigger pressable"
          aria-label={t("chooseProjectOpener")}
          title={t("chooseProjectOpener")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={Boolean(opening)}
          onClick={() => {
            const nextOpen = !menuOpen;
            setMenuOpen(nextOpen);
            setError(undefined);
            if (nextOpen) {
              requestAnimationFrame(() => {
                const preferredIndex = Math.max(
                  0,
                  availableOpeners.findIndex(
                    (opener) => opener.id === selected.id,
                  ),
                );
                menuItems.current[preferredIndex]?.focus();
              });
            }
          }}
        >
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      </div>
      {menuOpen && (
        <div className="project-opener-menu" role="menu">
          {availableOpeners.map((opener, index) => (
            <button
              key={opener.id}
              ref={(element) => {
                menuItems.current[index] = element;
              }}
              type="button"
              className="project-opener-option pressable"
              role="menuitem"
              disabled={Boolean(opening)}
              onClick={() => void openWith(opener)}
              onKeyDown={(event) => handleMenuKeyDown(event, index)}
            >
              {opening === opener.id ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <ProjectOpenerIcon opener={opener} />
              )}
              <span>{opener.label}</span>
            </button>
          ))}
          {error && (
            <p className="project-opener-error" role="status">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function resolvePreferredProjectOpener(
  openers: readonly ProjectOpenerOption[],
  preferred: string,
): ProjectOpenerOption | undefined {
  const exact = openers.find((opener) => opener.id === preferred);
  if (exact || !preferred) return exact;
  const normalizedPreference = normalizeOpenerName(preferred);
  return openers.find((opener) => {
    const bundleName = opener.id.split(".").at(-1) ?? opener.id;
    return (
      normalizeOpenerName(bundleName) === normalizedPreference ||
      normalizeOpenerName(opener.label) === normalizedPreference
    );
  });
}

export function ProjectOpenerIcon({
  opener,
}: {
  opener: Pick<
    ProjectOpenerOption,
    "id" | "label" | "iconDataUrl" | "default"
  >;
}) {
  if (opener.iconDataUrl) {
    return (
      <img
        className="project-opener-icon"
        src={opener.iconDataUrl}
        alt=""
        aria-hidden="true"
      />
    );
  }
  if (opener.default || opener.label.toLowerCase().includes("finder")) {
    return <FolderOpen size={16} aria-hidden="true" />;
  }
  if (opener.label.toLowerCase().includes("term")) {
    return <Terminal size={16} aria-hidden="true" />;
  }
  return <Code2 size={16} aria-hidden="true" />;
}

function normalizeOpenerName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}
