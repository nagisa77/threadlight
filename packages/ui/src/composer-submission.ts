import type { CapabilityDescriptor } from "@threadlight/protocol";

export function composerSubmissionAvailable(
  value: string,
  attachmentCount: number,
  capabilities: readonly Pick<CapabilityDescriptor, "id">[],
): boolean {
  return (
    value.trim().length > 0 ||
    attachmentCount > 0 ||
    capabilities.some(({ id }) => id === "tool:compact")
  );
}

export function composerContinuationAvailable(
  value: string,
  attachmentCount: number,
  capabilities: readonly Pick<CapabilityDescriptor, "id">[],
  session: {
    isRunning: boolean;
    continuationAvailable: boolean;
  },
): boolean {
  if (
    value.trim() ||
    attachmentCount > 0 ||
    capabilities.length > 0 ||
    session.isRunning
  ) {
    return false;
  }
  return session.continuationAvailable;
}
