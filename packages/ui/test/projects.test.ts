import { describe, expect, it } from "vitest";

import {
  mergeRunningThreadIds,
  reduceThreadSession,
} from "../src/features/task-session/session.js";

describe("restored running threads", () => {
  it("keeps host-restored activity alongside live renderer sessions", () => {
    const sessions = reduceThreadSession({}, "live-thread", {
      type: "turn.started",
      mode: "default",
    });

    expect(
      mergeRunningThreadIds(["restored-thread", "shared-thread"], sessions),
    ).toEqual(["restored-thread", "shared-thread", "live-thread"]);
  });
});
