import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAttachmentReference,
  uploadAttachmentReference,
} from "../src/main/attachment-upload.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("createAttachmentReference", () => {
  it("returns metadata for the original local path without copying into uploads", () => {
    const basePath = mkdtempSync(join(tmpdir(), "threadlight-upload-"));
    temporaryDirectories.push(basePath);
    const sourcePath = join(basePath, "diagram.png");
    writeFileSync(sourcePath, Uint8Array.from([1, 2, 3, 4, 5]));
    const attachment = createAttachmentReference({
      name: "diagram.png",
      mimeType: "image/png",
      size: 5,
      path: sourcePath,
    });

    expect(attachment).toMatchObject({
      name: "diagram.png",
      mimeType: "image/png",
      size: 5,
      kind: "image",
      path: sourcePath,
    });
    expect(existsSync(join(basePath, ".threadlight", "uploads"))).toBe(false);
    expect("url" in attachment).toBe(false);
    expect(JSON.stringify(attachment)).not.toContain("base64");
  });

  it("rejects missing local files", () => {
    const basePath = mkdtempSync(join(tmpdir(), "threadlight-upload-"));
    temporaryDirectories.push(basePath);
    expect(() =>
      createAttachmentReference({
        name: "notes.txt",
        mimeType: "text/plain",
        size: 3,
        path: join(basePath, "missing.txt"),
      }),
    ).toThrow();
  });

  it("uploads validated bytes and returns the Host attachment reference", async () => {
    const basePath = mkdtempSync(join(tmpdir(), "threadlight-upload-"));
    temporaryDirectories.push(basePath);
    const sourcePath = join(basePath, "diagram.png");
    writeFileSync(sourcePath, Uint8Array.from([1, 2, 3, 4, 5]));
    const upload = vi.fn(async () => ({
      id: "remote-attachment",
      name: "diagram.png",
      mimeType: "image/png",
      size: 5,
      kind: "image" as const,
      path: "/remote/project/.threadlight/uploads/remote-diagram.png",
    }));

    const attachment = await uploadAttachmentReference(
      {
        name: "diagram.png",
        mimeType: "image/png",
        size: 5,
        path: sourcePath,
      },
      "project-1",
      upload,
    );

    expect(attachment.id).toBe("remote-attachment");
    expect(upload).toHaveBeenCalledOnce();
    const staged = upload.mock.calls[0]![0];
    expect(staged).toMatchObject({
      projectId: "project-1",
      name: "diagram.png",
      mimeType: "image/png",
      size: 5,
    });
    expect([...new Uint8Array(staged.content)]).toEqual([1, 2, 3, 4, 5]);
  });
});
