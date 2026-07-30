import { isUtf8 } from "node:buffer";

export const MAX_FILE_PREVIEW_BYTES = 2 * 1024 * 1024;
const BINARY_SAMPLE_BYTES = 8_000;
const BINARY_SIGNATURES = [
  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.from("GIF8", "ascii"),
  Buffer.from("%PDF-", "ascii"),
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x1f, 0x8b]),
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  Buffer.from("Rar!", "ascii"),
  Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  Buffer.from("SQLite format 3\u0000", "binary"),
] as const;

export function isBinaryFileContent(content: Buffer): boolean {
  const sample = content.subarray(
    0,
    Math.min(content.length, BINARY_SAMPLE_BYTES),
  );
  if (
    BINARY_SIGNATURES.some(
      (signature) =>
        sample.length >= signature.length &&
        sample.subarray(0, signature.length).equals(signature),
    )
  ) {
    return true;
  }
  if (
    sample.length >= 8 &&
    sample.subarray(4, 8).toString("ascii") === "ftyp"
  ) {
    return true;
  }
  return sample.includes(0) || !isUtf8(sample);
}
