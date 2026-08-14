import { useCallback, useEffect, useState } from "react";

import type { Translate } from "../../i18n.js";
import { errorMessage } from "./conversation-content.js";
import type {
  ComputerPermissionAdapter,
  ComputerPermissionCapability,
  ComputerPermissionSnapshot,
  ComputerShareAdapter,
  ComputerShareSnapshot,
} from "./computer-types.js";
import { pendingComputerPermissionResume } from "./turn-status.js";

const COMPUTER_PERMISSION_RESUME_KEY = "threadlight:computer-permission-resume";
const COMPUTER_PERMISSION_RESUME_TTL_MS = 5 * 60 * 1_000;

interface ComputerControllerOptions {
  share?: ComputerShareAdapter;
  permissions?: ComputerPermissionAdapter;
  threadId?: string;
  connection: string;
  running: boolean;
  send(value: string): void | Promise<unknown>;
  t: Translate;
}

/** Owns the complete lifecycle of computer sharing and macOS permissions. */
export function useComputerController({
  share,
  permissions,
  threadId,
  connection,
  running,
  send,
  t,
}: ComputerControllerOptions) {
  const [shareSnapshot, setShareSnapshot] = useState<ComputerShareSnapshot>();
  const [shareError, setShareError] = useState<string>();
  const [permissionSnapshot, setPermissionSnapshot] =
    useState<ComputerPermissionSnapshot>();
  const [permissionBusy, setPermissionBusy] = useState<
    ComputerPermissionCapability | "refresh" | "relaunch"
  >();
  const [permissionError, setPermissionError] = useState<string>();
  const [showingShare, setShowingShare] = useState(false);
  const [stoppingShare, setStoppingShare] = useState(false);

  useEffect(() => {
    if (!share) return;
    let active = true;
    const accept = (snapshot: ComputerShareSnapshot) => {
      if (!active) return;
      setShareSnapshot(snapshot);
      setShareError(undefined);
    };
    const unsubscribe = share.subscribe(accept);
    void share
      .load()
      .then(accept)
      .catch((error) => {
        if (active) setShareError(errorMessage(error));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [share]);

  useEffect(() => {
    if (!permissions) return;
    let active = true;
    const accept = (snapshot: ComputerPermissionSnapshot) => {
      if (!active) return;
      setPermissionSnapshot(snapshot);
      setPermissionError(undefined);
    };
    const unsubscribe = permissions.subscribe(accept);
    void permissions
      .load()
      .then(accept)
      .catch((error) => {
        if (active) setPermissionError(errorMessage(error));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [permissions]);

  const requestPermission = useCallback(
    async (capability: ComputerPermissionCapability) => {
      if (!permissions) return;
      setPermissionBusy(capability);
      setPermissionError(undefined);
      try {
        setPermissionSnapshot(await permissions.request(capability));
      } catch (error) {
        setPermissionError(errorMessage(error));
      } finally {
        setPermissionBusy(undefined);
      }
    },
    [permissions],
  );

  const refreshPermissions = useCallback(async () => {
    if (!permissions) return;
    setPermissionBusy("refresh");
    setPermissionError(undefined);
    try {
      setPermissionSnapshot(await permissions.load());
    } catch (error) {
      setPermissionError(errorMessage(error));
    } finally {
      setPermissionBusy(undefined);
    }
  }, [permissions]);

  const relaunchForPermissions = useCallback(async () => {
    if (!permissions) return;
    setPermissionBusy("relaunch");
    setPermissionError(undefined);
    try {
      const resumeThreadId = permissionSnapshot?.ownerThreadId ?? threadId;
      if (resumeThreadId) {
        window.localStorage.setItem(
          COMPUTER_PERMISSION_RESUME_KEY,
          JSON.stringify({
            threadId: resumeThreadId,
            expiresAt: Date.now() + COMPUTER_PERMISSION_RESUME_TTL_MS,
          }),
        );
      }
      await permissions.relaunch();
    } catch (error) {
      window.localStorage.removeItem(COMPUTER_PERMISSION_RESUME_KEY);
      setPermissionError(errorMessage(error));
      setPermissionBusy(undefined);
    }
  }, [permissionSnapshot?.ownerThreadId, permissions, threadId]);

  useEffect(() => {
    if (connection !== "ready" || running || !threadId) return;
    const pending = pendingComputerPermissionResume(
      window.localStorage.getItem(COMPUTER_PERMISSION_RESUME_KEY),
      Date.now(),
    );
    if (!pending) {
      window.localStorage.removeItem(COMPUTER_PERMISSION_RESUME_KEY);
      return;
    }
    if (pending.threadId !== threadId) return;
    window.localStorage.removeItem(COMPUTER_PERMISSION_RESUME_KEY);
    void send(t("computerPermissionResumePrompt"));
  }, [connection, running, send, t, threadId]);

  const stopShare = useCallback(async (): Promise<boolean> => {
    if (!share || !shareSnapshot?.active) return true;
    setStoppingShare(true);
    setShareError(undefined);
    try {
      setShareSnapshot(await share.stop());
      return true;
    } catch (error) {
      setShareError(errorMessage(error));
      return false;
    } finally {
      setStoppingShare(false);
    }
  }, [share, shareSnapshot?.active]);

  const showSharePreview = useCallback(async () => {
    if (!share || showingShare) return;
    setShowingShare(true);
    setShareError(undefined);
    try {
      setShareSnapshot(await share.showPictureInPicture());
    } catch (error) {
      setShareError(errorMessage(error));
    } finally {
      setShowingShare(false);
    }
  }, [share, showingShare]);

  return {
    shareSnapshot,
    shareError,
    permissionSnapshot,
    permissionBusy,
    permissionError,
    showingShare,
    stoppingShare,
    requestPermission,
    refreshPermissions,
    relaunchForPermissions,
    stopShare,
    showSharePreview,
  };
}
