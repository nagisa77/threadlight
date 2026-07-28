import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const source = resolve(
  repositoryRoot,
  "packages/app-server/src/builtin-skills",
);
const destination = resolve(
  repositoryRoot,
  "packages/app-server/dist/builtin-skills",
);

await mkdir(dirname(destination), { recursive: true });
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
