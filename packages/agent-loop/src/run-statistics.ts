import type { TokenUsage } from "./types.js";

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

/** Run-local token and duration accounting, independent of loop control flow. */
export class RunStatistics {
  private readonly totalUsage = { ...EMPTY_USAGE };

  constructor(private readonly clock: () => number = () => performance.now()) {}

  now(): number {
    return this.clock();
  }

  elapsedSince(startedAt: number): number {
    return Math.max(0, Math.round((this.now() - startedAt) * 10) / 10);
  }

  addUsage(usage: Partial<TokenUsage> | undefined): void {
    this.totalUsage.inputTokens += usage?.inputTokens ?? 0;
    this.totalUsage.outputTokens += usage?.outputTokens ?? 0;
    this.totalUsage.totalTokens += usage?.totalTokens ?? 0;
  }

  snapshot(): TokenUsage {
    return { ...this.totalUsage };
  }
}
