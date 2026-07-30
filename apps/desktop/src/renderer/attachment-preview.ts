export function attachmentPreviewUrl(
  path: string,
  attachmentId?: string,
  mimeType?: string,
): string {
  const bytes = new TextEncoder().encode(path);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encodedPath = btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const prefix = attachmentId
    ? `${encodeURIComponent(attachmentId)}/`
    : "";
  const query = mimeType
    ? `?mimeType=${encodeURIComponent(mimeType)}`
    : "";
  return `threadlight-attachment://local/${prefix}${encodedPath}${query}`;
}
