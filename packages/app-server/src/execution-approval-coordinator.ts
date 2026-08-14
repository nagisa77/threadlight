import { randomUUID } from "node:crypto";

import type { ThreadlightNotificationMap } from "./protocol.js";
import type {
  ExecutionApprovalRequest,
  ExecutionApprovalRequester,
} from "./execution-policy-controller.js";
import { RpcError } from "./rpc-router.js";

type ApprovalNotificationMethod =
  "execution/approval-required" | "execution/approval-resolved";

export class ExecutionApprovalCoordinator {
  readonly requester: ExecutionApprovalRequester = {
    request: (request, signal) => this.request(request, signal),
  };
  private readonly pending = new Map<
    string,
    {
      request: ThreadlightNotificationMap["execution/approval-required"];
      resolve(decision: "allow" | "deny"): void;
      dispose(): void;
    }
  >();
  enabled = false;

  constructor(
    private readonly notify: (
      method: ApprovalNotificationMethod,
      params:
        | ThreadlightNotificationMap["execution/approval-required"]
        | ThreadlightNotificationMap["execution/approval-resolved"],
    ) => void,
  ) {}

  enable(params: unknown): void {
    if (!params || typeof params !== "object" || Array.isArray(params)) return;
    const capabilities = (params as Record<string, unknown>).capabilities;
    if (
      capabilities &&
      typeof capabilities === "object" &&
      !Array.isArray(capabilities) &&
      (capabilities as Record<string, unknown>).executionApprovals === true
    ) {
      this.enabled = true;
    }
  }

  replay(threadId: string): void {
    const requests = [...this.pending.values()]
      .map(({ request }) => request)
      .filter((request) => request.threadId === threadId);
    if (requests.length === 0) return;
    setTimeout(() => {
      for (const request of requests) {
        if (this.pending.has(request.requestId)) {
          this.notify("execution/approval-required", request);
        }
      }
    }, 0);
  }

  resolve(params: unknown): { accepted: boolean } {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw new RpcError(-32602, "Approval response params must be an object");
    }
    const { requestId, decision } = params as Record<string, unknown>;
    if (typeof requestId !== "string") {
      throw new RpcError(-32602, "requestId must be a string");
    }
    if (decision !== "allow" && decision !== "deny") {
      throw new RpcError(-32602, "decision must be allow or deny");
    }
    const pending = this.pending.get(requestId);
    if (!pending) return { accepted: false };
    pending.resolve(decision);
    return { accepted: true };
  }

  private request(
    request: ExecutionApprovalRequest,
    signal?: AbortSignal,
  ): Promise<"allow" | "deny"> {
    if (signal?.aborted) return Promise.resolve("deny");
    const requestId = randomUUID();
    const notification = { requestId, ...request };
    return new Promise((resolve) => {
      const onAbort = () => settle("deny");
      const settle = (decision: "allow" | "deny") => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        pending.dispose();
        resolve(decision);
        this.notify("execution/approval-resolved", {
          requestId,
          threadId: request.threadId,
        });
      };
      this.pending.set(requestId, {
        request: notification,
        resolve: settle,
        dispose: () => signal?.removeEventListener("abort", onAbort),
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.notify("execution/approval-required", notification);
    });
  }
}
