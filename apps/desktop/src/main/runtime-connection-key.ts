export function runtimeConnectionKey(
  projectId: string,
  workspacePath: string,
  remote: boolean,
): string {
  return `${projectId}\0${remote ? "remote" : workspacePath}`;
}
