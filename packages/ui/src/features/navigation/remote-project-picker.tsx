import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import type {
  HostDirectoryEntry,
  HostDirectoryListOptions,
  HostDirectoryListing,
} from "@threadlight/protocol";
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Home,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  Star,
  TriangleAlert,
  X,
} from "lucide-react";

import { Dialog } from "../../dialog.js";
import { useI18n } from "../../i18n.js";
import { errorMessage } from "../shared/format.js";

const FAVORITES_STORAGE_PREFIX = "threadlight:remote-folder-favorites:v1:";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RemoteProjectPickerRecentProject {
  name: string;
  path: string;
  lastOpenedAt: string;
}

export interface RemotePathBreadcrumb {
  label: string;
  path: string;
}

export interface RemoteDirectoryHistory {
  paths: readonly string[];
  index: number;
}

export function RemoteProjectPathDialog({
  busy,
  error,
  hostId,
  hostName,
  recentProjects = [],
  onBrowse,
  onCancel,
  onOpen,
}: {
  busy: boolean;
  error?: string;
  hostId: string;
  hostName: string;
  recentProjects?: readonly RemoteProjectPickerRecentProject[];
  onBrowse?(
    path: string,
    options?: HostDirectoryListOptions,
  ): Promise<HostDirectoryListing>;
  onCancel(): void;
  onOpen(path: string): void;
}) {
  const { t } = useI18n();
  const [requestedPath, setRequestedPath] = useState("~");
  const [listing, setListing] = useState<HostDirectoryListing>();
  const [homePath, setHomePath] = useState<string>();
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState<string>();
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string>();
  const [showHidden, setShowHidden] = useState(false);
  const [addressEditing, setAddressEditing] = useState(false);
  const [addressValue, setAddressValue] = useState("~");
  const [addressError, setAddressError] = useState<string>();
  const [history, setHistory] = useState<RemoteDirectoryHistory>({
    paths: ["~"],
    index: 0,
  });
  const [reloadVersion, setReloadVersion] = useState(0);
  const [favorites, setFavorites] = useState<readonly string[]>(() =>
    loadRemoteFolderFavorites(hostId, browserStorage()),
  );
  const searchInput = useRef<HTMLInputElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const browseRequest = useRef(0);
  const listingCache = useRef(new Map<string, HostDirectoryListing>());
  const forceRefresh = useRef(false);

  useEffect(() => {
    if (!onBrowse) {
      setDirectoryLoading(false);
      setDirectoryError(t("remoteFolderBrowsingUnavailable"));
      return;
    }
    const cacheKey = directoryCacheKey(requestedPath, showHidden);
    const cached = forceRefresh.current
      ? undefined
      : listingCache.current.get(cacheKey);
    forceRefresh.current = false;
    if (cached) {
      setListing(cached);
      setDirectoryLoading(false);
      setDirectoryError(undefined);
      return;
    }

    const request = ++browseRequest.current;
    setDirectoryLoading(true);
    setDirectoryError(undefined);
    setListing(undefined);
    void onBrowse(requestedPath, { showHidden, strict: true })
      .then((nextListing) => {
        if (browseRequest.current !== request) return;
        const visibleListing = {
          ...nextListing,
          directories: visibleRemoteDirectories(
            "",
            nextListing.directories,
            showHidden,
          ),
        };
        listingCache.current.set(cacheKey, visibleListing);
        listingCache.current.set(
          directoryCacheKey(nextListing.path, showHidden),
          visibleListing,
        );
        setListing(visibleListing);
        if (requestedPath === "~") setHomePath(nextListing.path);
      })
      .catch((browseError) => {
        if (browseRequest.current !== request) return;
        setDirectoryError(errorMessage(browseError));
      })
      .finally(() => {
        if (browseRequest.current === request) setDirectoryLoading(false);
      });
    return () => {
      if (browseRequest.current === request) browseRequest.current += 1;
    };
  }, [onBrowse, reloadVersion, requestedPath, showHidden, t]);

  useEffect(() => {
    if (!addressEditing) return;
    requestAnimationFrame(() => {
      addressInput.current?.focus();
      addressInput.current?.select();
    });
  }, [addressEditing]);

  const currentPath = listing?.path ?? requestedPath;
  const targetPath = selectedPath ?? listing?.path;
  const breadcrumbs = remoteDirectoryBreadcrumbs(currentPath);
  const filteredDirectories = useMemo(
    () => filterRemoteDirectories(listing?.directories ?? [], query),
    [listing?.directories, query],
  );
  const sortedRecentProjects = useMemo(
    () =>
      recentProjects
        .filter((project) => project.path.trim())
        .slice()
        .sort((left, right) =>
          right.lastOpenedAt.localeCompare(left.lastOpenedAt),
        )
        .slice(0, 6),
    [recentProjects],
  );
  const rootPath = remoteDirectoryRoot(listing?.path ?? homePath ?? "");
  const parentPath = listing?.parentPath;
  const favorite = Boolean(
    targetPath && favorites.some((path) => remotePathsEqual(path, targetPath)),
  );

  function navigate(path: string, recordHistory = true) {
    const nextPath = path.trim();
    if (!nextPath || busy) return;
    setRequestedPath(nextPath);
    setQuery("");
    setSelectedPath(undefined);
    setAddressEditing(false);
    setAddressError(undefined);
    if (recordHistory) {
      setHistory((current) => pushRemoteDirectoryHistory(current, nextPath));
    }
    requestAnimationFrame(() => searchInput.current?.focus());
  }

  function navigateHistory(offset: -1 | 1) {
    const nextIndex = history.index + offset;
    const nextPath = history.paths[nextIndex];
    if (!nextPath || busy) return;
    setHistory((current) => ({ ...current, index: nextIndex }));
    navigate(nextPath, false);
  }

  function refresh() {
    forceRefresh.current = true;
    listingCache.current.delete(directoryCacheKey(requestedPath, showHidden));
    setReloadVersion((version) => version + 1);
  }

  function toggleHiddenDirectories() {
    setSelectedPath(undefined);
    setShowHidden((visible) => !visible);
  }

  function beginAddressEditing() {
    setAddressValue(currentPath);
    setAddressError(undefined);
    setAddressEditing(true);
  }

  function submitAddress() {
    const nextPath = addressValue.trim();
    if (!isRemoteAbsolutePath(nextPath)) {
      setAddressError(t("invalidRemoteFolderPath"));
      return;
    }
    navigate(nextPath);
  }

  function focusDirectory(index: number) {
    const boundedIndex = Math.max(
      0,
      Math.min(index, filteredDirectories.length - 1),
    );
    const directory = filteredDirectories[boundedIndex];
    if (!directory) return;
    setSelectedPath(directory.path);
    rowRefs.current[boundedIndex]?.focus();
  }

  function handleListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const activeIndex = rowRefs.current.findIndex(
      (row) => row === event.target,
    );
    focusDirectory(
      event.key === "ArrowDown" ? activeIndex + 1 : activeIndex - 1,
    );
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLocaleLowerCase() === "l") {
      event.preventDefault();
      beginAddressEditing();
      return;
    }
    if (modifier && event.shiftKey && event.code === "Period") {
      event.preventDefault();
      toggleHiddenDirectories();
      return;
    }
    if (modifier && event.key.toLocaleLowerCase() === "r") {
      event.preventDefault();
      refresh();
      return;
    }
    if (modifier && event.key === "Enter" && targetPath && !busy) {
      event.preventDefault();
      onOpen(targetPath);
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (
      parentPath &&
      ((modifier && event.key === "ArrowUp") || event.key === "Backspace")
    ) {
      event.preventDefault();
      navigate(parentPath);
    }
  }

  function updateFavorites(next: readonly string[]) {
    setFavorites(next);
    saveRemoteFolderFavorites(hostId, next, browserStorage());
  }

  function toggleFavorite(path: string) {
    const exists = favorites.some((entry) => remotePathsEqual(entry, path));
    updateFavorites(
      exists
        ? favorites.filter((entry) => !remotePathsEqual(entry, path))
        : [...favorites, path],
    );
  }

  const emptyCopy = query ? t("noMatchingFolders") : t("remoteFolderEmpty");

  return (
    <Dialog
      className="connector-dialog remote-project-dialog"
      backdropClassName="dialog-backdrop remote-project-picker-backdrop"
      aria-labelledby="remote-project-title"
      initialFocusRef={searchInput}
      dismissDisabled={busy}
      closeOnBackdrop={false}
      onClose={onCancel}
      onKeyDown={handleDialogKeyDown}
    >
      <header className="remote-project-picker-header">
        <span className="connector-dialog-icon" aria-hidden="true">
          <FolderPlus size={18} />
        </span>
        <div className="remote-project-picker-heading-copy">
          <h2 id="remote-project-title">{t("chooseRemoteProjectFolder")}</h2>
          <p>{t("chooseRemoteProjectFolderDescription", { host: hostName })}</p>
        </div>
        <button
          type="button"
          className="remote-picker-icon-button pressable"
          aria-label={t("cancel")}
          title={t("cancel")}
          disabled={busy}
          onClick={onCancel}
        >
          <X size={16} />
        </button>
      </header>

      <div className="remote-project-picker-shell">
        <aside className="remote-project-picker-sidebar">
          <RemotePickerSection label={t("remoteLocations")}>
            <RemotePickerPlace
              icon={<Home size={15} />}
              label={t("remoteHome")}
              path={homePath ?? "~"}
              active={Boolean(
                homePath && remotePathsEqual(currentPath, homePath),
              )}
              onSelect={() => navigate(homePath ?? "~")}
            />
            <RemotePickerPlace
              icon={<HardDrive size={15} />}
              label={t("remoteRoot")}
              path={rootPath}
              active={Boolean(
                rootPath && remotePathsEqual(currentPath, rootPath),
              )}
              disabled={!rootPath}
              onSelect={() => rootPath && navigate(rootPath)}
            />
          </RemotePickerSection>

          {favorites.length > 0 && (
            <RemotePickerSection label={t("favoriteFolders")}>
              {favorites.map((path) => (
                <div className="remote-picker-favorite-row" key={path}>
                  <RemotePickerPlace
                    icon={<Star size={14} fill="currentColor" />}
                    label={remotePathName(path)}
                    path={path}
                    active={remotePathsEqual(currentPath, path)}
                    onSelect={() => navigate(path)}
                  />
                  <button
                    type="button"
                    className="remote-picker-favorite-remove"
                    aria-label={t("removeFolderFavorite", {
                      name: remotePathName(path),
                    })}
                    title={t("removeFolderFavorite", {
                      name: remotePathName(path),
                    })}
                    onClick={() => toggleFavorite(path)}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </RemotePickerSection>
          )}

          {sortedRecentProjects.length > 0 && (
            <RemotePickerSection label={t("recentRemoteProjects")}>
              {sortedRecentProjects.map((project) => (
                <RemotePickerPlace
                  key={project.path}
                  icon={<Clock3 size={14} />}
                  label={project.name}
                  path={project.path}
                  active={remotePathsEqual(currentPath, project.path)}
                  onSelect={() => navigate(project.path)}
                />
              ))}
            </RemotePickerSection>
          )}
        </aside>

        <section className="remote-project-picker-browser">
          <div className="remote-picker-navigation-bar">
            <div className="remote-picker-navigation-actions">
              <button
                type="button"
                className="remote-picker-icon-button pressable"
                aria-label={t("remoteFolderBack")}
                title={t("remoteFolderBack")}
                disabled={history.index === 0 || busy}
                onClick={() => navigateHistory(-1)}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                className="remote-picker-icon-button pressable"
                aria-label={t("remoteFolderForward")}
                title={t("remoteFolderForward")}
                disabled={history.index >= history.paths.length - 1 || busy}
                onClick={() => navigateHistory(1)}
              >
                <ChevronRight size={16} />
              </button>
              <button
                type="button"
                className="remote-picker-icon-button pressable"
                aria-label={t("remoteParentFolder")}
                title={`${t("remoteParentFolder")} · ⌘↑`}
                disabled={!parentPath || busy}
                onClick={() => parentPath && navigate(parentPath)}
              >
                <ChevronUp size={16} />
              </button>
            </div>

            {addressEditing ? (
              <form
                className="remote-picker-address-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitAddress();
                }}
              >
                <label className="sr-only" htmlFor="remote-picker-address">
                  {t("remoteProjectPath")}
                </label>
                <input
                  id="remote-picker-address"
                  ref={addressInput}
                  value={addressValue}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={addressError ? true : undefined}
                  onChange={(event) => {
                    setAddressValue(event.target.value);
                    setAddressError(undefined);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitAddress();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      setAddressEditing(false);
                      setAddressError(undefined);
                      requestAnimationFrame(() => searchInput.current?.focus());
                    }
                  }}
                />
              </form>
            ) : (
              <div
                className="remote-picker-breadcrumbs"
                aria-label={t("remoteProjectPath")}
              >
                {breadcrumbs.map((crumb, index) => (
                  <span key={crumb.path}>
                    {index > 0 && <ChevronRight size={12} aria-hidden="true" />}
                    <button
                      type="button"
                      title={crumb.path}
                      onClick={() => navigate(crumb.path)}
                    >
                      {crumb.label}
                    </button>
                  </span>
                ))}
              </div>
            )}

            <button
              type="button"
              className="remote-picker-icon-button pressable"
              aria-label={t("editRemoteFolderPath")}
              title={`${t("editRemoteFolderPath")} · ⌘L`}
              onClick={beginAddressEditing}
            >
              <Pencil size={14} />
            </button>
          </div>

          <div className="remote-picker-filter-bar">
            <label className="remote-picker-search">
              <Search size={14} aria-hidden="true" />
              <span className="sr-only">{t("searchRemoteFolders")}</span>
              <input
                ref={searchInput}
                type="search"
                value={query}
                placeholder={t("searchRemoteFolders")}
                autoComplete="off"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedPath(undefined);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusDirectory(0);
                  } else if (event.key === "Escape" && query) {
                    event.preventDefault();
                    event.stopPropagation();
                    setQuery("");
                  }
                }}
              />
              {query && (
                <button
                  type="button"
                  aria-label={t("clearSearch")}
                  title={t("clearSearch")}
                  onClick={() => {
                    setQuery("");
                    searchInput.current?.focus();
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </label>
            <button
              type="button"
              className={`remote-picker-tool-button pressable${showHidden ? " active" : ""}`}
              aria-pressed={showHidden}
              title={`${showHidden ? t("hideHiddenFolders") : t("showHiddenFolders")} · ⌘⇧.`}
              onClick={toggleHiddenDirectories}
            >
              {showHidden ? <EyeOff size={14} /> : <Eye size={14} />}
              <span>
                {showHidden ? t("hideHiddenFolders") : t("showHiddenFolders")}
              </span>
            </button>
            <button
              type="button"
              className="remote-picker-icon-button pressable"
              aria-label={t("refresh")}
              title={`${t("refresh")} · ⌘R`}
              disabled={directoryLoading}
              onClick={refresh}
            >
              <RefreshCw
                className={directoryLoading ? "spin" : undefined}
                size={14}
              />
            </button>
          </div>

          <div
            className="remote-picker-directory-list"
            role="listbox"
            aria-label={t("remoteFolders")}
            aria-busy={directoryLoading}
            onKeyDown={handleListKeyDown}
          >
            {directoryLoading ? (
              <RemoteDirectoryLoading label={t("loadingFolders")} />
            ) : directoryError ? (
              <div
                className="remote-picker-state remote-picker-error"
                role="alert"
              >
                <span aria-hidden="true">
                  <TriangleAlert size={18} />
                </span>
                <strong>{t("remoteFolderLoadFailed")}</strong>
                <p>{directoryError}</p>
                <button
                  type="button"
                  className="dialog-button secondary pressable"
                  onClick={refresh}
                >
                  {t("retry")}
                </button>
              </div>
            ) : filteredDirectories.length === 0 ? (
              <div className="remote-picker-state">
                <span aria-hidden="true">
                  <FolderOpen size={19} />
                </span>
                <strong>{emptyCopy}</strong>
                {query && <p>{t("tryAnotherFolderSearch")}</p>}
              </div>
            ) : (
              filteredDirectories.map((directory, index) => {
                const selected = remotePathsEqual(
                  selectedPath ?? "",
                  directory.path,
                );
                return (
                  <button
                    key={directory.path}
                    ref={(element) => {
                      rowRefs.current[index] = element;
                    }}
                    type="button"
                    role="option"
                    className="remote-picker-directory-row"
                    aria-selected={selected}
                    title={directory.path}
                    onClick={() => setSelectedPath(directory.path)}
                    onDoubleClick={() => navigate(directory.path)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === "ArrowRight") {
                        event.preventDefault();
                        navigate(directory.path);
                      } else if (event.key === "ArrowLeft" && parentPath) {
                        event.preventDefault();
                        navigate(parentPath);
                      }
                    }}
                  >
                    <span
                      className="remote-picker-directory-icon"
                      aria-hidden="true"
                    >
                      <Folder size={17} />
                    </span>
                    <span className="remote-picker-directory-copy">
                      <strong>{directory.name}</strong>
                      <small>{directory.path}</small>
                    </span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>

      <footer className="remote-project-picker-footer">
        {(addressError || error) && (
          <p className="remote-project-picker-open-error" role="alert">
            {addressError ?? error}
          </p>
        )}
        <div className="remote-project-picker-selection">
          <FolderOpen size={15} aria-hidden="true" />
          <span>
            <small>
              {selectedPath
                ? t("selectedRemoteFolder")
                : t("currentRemoteFolder")}
            </small>
            <strong title={targetPath}>
              {targetPath ?? t("loadingFolders")}
            </strong>
          </span>
          <button
            type="button"
            className={`remote-picker-icon-button pressable${favorite ? " active" : ""}`}
            aria-pressed={favorite}
            aria-label={
              favorite
                ? t("removeCurrentFolderFavorite")
                : t("addFolderFavorite")
            }
            title={
              favorite
                ? t("removeCurrentFolderFavorite")
                : t("addFolderFavorite")
            }
            disabled={!targetPath}
            onClick={() => targetPath && toggleFavorite(targetPath)}
          >
            <Star size={14} fill={favorite ? "currentColor" : "none"} />
          </button>
        </div>
        <div className="remote-project-picker-actions">
          <button
            type="button"
            className="dialog-button secondary pressable"
            disabled={busy}
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className="dialog-button primary pressable"
            disabled={busy || directoryLoading || !targetPath}
            onClick={() => targetPath && onOpen(targetPath)}
          >
            {busy && <LoaderCircle className="spin" size={14} />}
            {busy ? t("opening") : t("openViaFolder")}
          </button>
        </div>
      </footer>
    </Dialog>
  );
}

function RemotePickerSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="remote-picker-sidebar-section">
      <h3>{label}</h3>
      <div>{children}</div>
    </section>
  );
}

function RemotePickerPlace({
  icon,
  label,
  path,
  active,
  disabled,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  path?: string;
  active: boolean;
  disabled?: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      className={`remote-picker-place${active ? " active" : ""}`}
      title={path ? `${label}\n${path}` : label}
      disabled={disabled}
      onClick={onSelect}
    >
      <span aria-hidden="true">{icon}</span>
      <span>
        <strong>{label}</strong>
        {path && <small>{path}</small>}
      </span>
    </button>
  );
}

function RemoteDirectoryLoading({ label }: { label: string }) {
  return (
    <div className="remote-picker-loading" role="status">
      <span>
        <LoaderCircle className="spin" size={16} />
        {label}
      </span>
      {[0, 1, 2, 3, 4].map((index) => (
        <i key={index} style={{ width: `${58 - index * 4}%` }} />
      ))}
    </div>
  );
}

export function visibleRemoteDirectories(
  path: string,
  directories: readonly HostDirectoryEntry[],
  showHidden = false,
): readonly HostDirectoryEntry[] {
  const typedSegment = trailingRemotePathSegment(path.trim());
  if (showHidden || typedSegment.startsWith(".")) return directories;
  return directories.filter((directory) => !directory.name.startsWith("."));
}

export function filterRemoteDirectories(
  directories: readonly HostDirectoryEntry[],
  query: string,
): readonly HostDirectoryEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return directories;
  return directories.filter((directory) =>
    directory.name.toLocaleLowerCase().includes(normalizedQuery),
  );
}

export function pushRemoteDirectoryHistory(
  history: RemoteDirectoryHistory,
  path: string,
): RemoteDirectoryHistory {
  const currentPath = history.paths[history.index];
  if (currentPath && remotePathsEqual(currentPath, path)) return history;
  const paths = [...history.paths.slice(0, history.index + 1), path];
  return { paths, index: paths.length - 1 };
}

export function isRemoteAbsolutePath(path: string): boolean {
  const value = path.trim();
  return (
    value === "~" ||
    value.startsWith("~/") ||
    value.startsWith("~\\") ||
    value.startsWith("/") ||
    /^[a-z]:[\\/]/i.test(value) ||
    /^\\\\[^\\]+\\[^\\]+/.test(value)
  );
}

export function remoteDirectoryBreadcrumbs(
  path: string,
): readonly RemotePathBreadcrumb[] {
  const value = path.trim();
  if (!value) return [];
  if (value === "~") return [{ label: "~", path: "~" }];

  const windowsValue = value.replaceAll("/", "\\");
  const drive = windowsValue.match(/^([a-z]:)\\?(.*)$/i);
  if (drive) {
    const root = `${drive[1]}\\`;
    const parts = (drive[2] ?? "").split(/\\+/).filter(Boolean);
    let current = root;
    return [
      { label: drive[1]!, path: root },
      ...parts.map((part) => {
        current = `${current}${current.endsWith("\\") ? "" : "\\"}${part}`;
        return { label: part, path: current };
      }),
    ];
  }

  if (windowsValue.startsWith("\\\\")) {
    const parts = windowsValue.slice(2).split(/\\+/).filter(Boolean);
    const server = parts[0];
    const share = parts[1];
    if (server && share) {
      const root = `\\\\${server}\\${share}\\`;
      let current = root;
      return [
        { label: `\\\\${server}\\${share}`, path: root },
        ...parts.slice(2).map((part) => {
          current = `${current}${current.endsWith("\\") ? "" : "\\"}${part}`;
          return { label: part, path: current };
        }),
      ];
    }
  }

  if (value.startsWith("/")) {
    const parts = value.split(/\/+/).filter(Boolean);
    let current = "";
    return [
      { label: "/", path: "/" },
      ...parts.map((part) => {
        current += `/${part}`;
        return { label: part, path: current };
      }),
    ];
  }

  return [{ label: value, path: value }];
}

export function remoteDirectoryRoot(path: string): string | undefined {
  return remoteDirectoryBreadcrumbs(path)[0]?.path;
}

export function remotePathName(path: string): string {
  const breadcrumbs = remoteDirectoryBreadcrumbs(path);
  return breadcrumbs.at(-1)?.label ?? path;
}

export function remotePathsEqual(left: string, right: string): boolean {
  const windows =
    /^[a-z]:[\\/]/i.test(left) ||
    /^[a-z]:[\\/]/i.test(right) ||
    left.startsWith("\\\\") ||
    right.startsWith("\\\\");
  const normalizePath = (value: string) => {
    const trimmed = value.trim();
    const normalized = trimmed.replace(/[\\/]+$/, "");
    if (!normalized && trimmed.startsWith("/")) return "/";
    return windows
      ? normalized.replaceAll("/", "\\").toLowerCase()
      : normalized;
  };
  return normalizePath(left) === normalizePath(right);
}

export function loadRemoteFolderFavorites(
  hostId: string,
  storage?: StorageLike,
): readonly string[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(
      storage.getItem(`${FAVORITES_STORAGE_PREFIX}${hostId}`) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (path): path is string =>
        typeof path === "string" && isRemoteAbsolutePath(path),
    );
  } catch {
    return [];
  }
}

export function saveRemoteFolderFavorites(
  hostId: string,
  favorites: readonly string[],
  storage?: StorageLike,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      `${FAVORITES_STORAGE_PREFIX}${hostId}`,
      JSON.stringify(favorites),
    );
  } catch {
    // Favorites are a convenience; private browsing must not block selection.
  }
}

function trailingRemotePathSegment(path: string): string {
  const lastSeparator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return path.slice(lastSeparator + 1);
}

function directoryCacheKey(path: string, showHidden: boolean): string {
  return `${showHidden ? "hidden" : "visible"}:${path}`;
}

function browserStorage(): StorageLike | undefined {
  if (typeof window === "undefined") return;
  try {
    return window.localStorage;
  } catch {
    return;
  }
}
