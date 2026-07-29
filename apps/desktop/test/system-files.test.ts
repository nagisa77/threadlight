import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  readSystemFile,
  resolveSystemFilePath,
} from "../src/main/system-files.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("system files", () => {
  it("reads text files by absolute path", async () => {
    const root = await temporaryDirectory();
    const path = join(root, "notes.txt");
    await writeFile(path, "outside the project\n");
    const canonicalPath = await realpath(path);

    await expect(readSystemFile(path)).resolves.toEqual({
      path: canonicalPath,
      name: "notes.txt",
      content: "outside the project\n",
      binary: false,
      size: 20,
    });
  });

  it("detects binary files without decoding their content", async () => {
    const root = await temporaryDirectory();
    const path = join(root, "image.bin");
    await writeFile(path, Buffer.from([0x89, 0x50, 0x00, 0x47]));
    const canonicalPath = await realpath(path);

    await expect(readSystemFile(path)).resolves.toEqual({
      path: canonicalPath,
      name: "image.bin",
      binary: true,
      size: 4,
    });
  });

  it("recognizes common binary signatures even without NUL bytes", async () => {
    const root = await temporaryDirectory();
    const path = join(root, "report.pdf");
    await writeFile(path, "%PDF-1.7\nplain header");

    await expect(readSystemFile(path)).resolves.toMatchObject({
      name: "report.pdf",
      binary: true,
      size: 21,
    });
    expect((await readSystemFile(path)).content).toBeUndefined();
  });

  it("rejects relative paths and directories", async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, "folder"));

    await expect(readSystemFile("notes.txt")).rejects.toThrow(
      "must be absolute",
    );
    await expect(readSystemFile(join(root, "folder"))).rejects.toThrow(
      "not a file",
    );
  });

  it("resolves symlinks to the canonical Finder target", async () => {
    const root = await temporaryDirectory();
    const target = join(root, "target.txt");
    const link = join(root, "link.txt");
    await writeFile(target, "target\n");
    await symlink(target, link);

    await expect(resolveSystemFilePath(link)).resolves.toBe(
      await realpath(target),
    );
  });
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "threadlight-system-files-"));
  temporaryDirectories.push(path);
  return path;
}
