import { chmod, copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(repositoryRoot, "scripts/self-host.sh");
const destination = resolve(repositoryRoot, "apps/site/dist/install.sh");

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
await chmod(destination, 0o755);
