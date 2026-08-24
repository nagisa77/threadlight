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
