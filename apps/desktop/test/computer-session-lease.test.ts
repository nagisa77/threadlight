import { describe, expect, it } from "vitest";

import { ComputerSessionLease } from "../src/main/computer-session-lease.js";

describe("ComputerSessionLease", () => {
  it("keeps computer use exclusive to one task", () => {
    const lease = new ComputerSessionLease();
    const first = { runId: "run-a", threadId: "thread-a" };
    const second = { runId: "run-b", threadId: "thread-b" };

    expect(lease.acquire(first)).toBe(true);
    expect(lease.owner).toEqual(first);
    expect(lease.acquire(first)).toBe(false);
    expect(() => lease.acquire(second)).toThrow(
      "Computer use is already active in another task",
    );
    expect(lease.owner).toEqual(first);
  });

  it("only lets the owning run release its session", () => {
    const lease = new ComputerSessionLease();
    const owner = { runId: "run-a", threadId: "thread-a" };

    lease.acquire(owner);
    expect(
      lease.release({ runId: "run-b", threadId: "thread-b" }),
    ).toBe(false);
    expect(lease.owner).toEqual(owner);
    expect(lease.release(owner)).toBe(true);
    expect(lease.owner).toBeUndefined();
  });
});
