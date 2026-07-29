import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
for (const directory of ["builtin-skills", "builtin-plugins"]) {
  const source = resolve(
    repositoryRoot,
    `packages/app-server/src/${directory}`,
  );
  const destination = resolve(
    repositoryRoot,
    `packages/app-server/dist/${directory}`,
  );
  await mkdir(dirname(destination), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });
}
