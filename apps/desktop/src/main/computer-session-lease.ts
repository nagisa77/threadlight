export interface ComputerSessionOwner {
  runId: string;
  threadId: string;
}

export class ComputerSessionLease {
  private currentOwner?: ComputerSessionOwner;

  get owner(): ComputerSessionOwner | undefined {
    return this.currentOwner ? { ...this.currentOwner } : undefined;
  }

  acquire(owner: ComputerSessionOwner): boolean {
    if (
      this.currentOwner &&
      this.currentOwner.runId !== owner.runId
    ) {
      throw new Error(
        "Computer use is already active in another task. Continue without computer use or wait until that task finishes.",
      );
    }
    if (this.currentOwner) return false;
    this.currentOwner = { ...owner };
    return true;
  }

  assertOwnedBy(owner: ComputerSessionOwner): void {
    if (
      !this.currentOwner ||
      this.currentOwner.runId !== owner.runId
    ) {
      throw new Error(
        "Computer use is owned by another task and cannot be changed from this task.",
      );
    }
  }

  release(owner?: ComputerSessionOwner): boolean {
    if (
      owner &&
      this.currentOwner?.runId !== owner.runId
    ) {
      return false;
    }
    if (!this.currentOwner) return false;
    this.currentOwner = undefined;
    return true;
  }
}
