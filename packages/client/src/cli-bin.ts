#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createInterface, type Interface } from "node:readline/promises";

import { THREADLIGHT_HOST_PROTOCOL_VERSION } from "@threadlight/protocol";

import {
  parseThreadlightCli,
  threadlightCliUsage,
  ThreadlightCliUsageError,
  type ThreadlightProjectsCommand,
  type ThreadlightRunCommand,
} from "./command-cli-options.js";
import { HttpHostClient } from "./http-host-client.js";
import {
  runRemoteTask,
  type RemoteTaskApproval,
  type RemoteTaskStatus,
} from "./remote-task.js";

const command = readCommand(process.argv.slice(2));
if (command.action === "help") {
  process.stdout.write(threadlightCliUsage());
  process.exit(0);
}
if (command.action === "version") {
  try {
    process.stdout.write(`threadlight ${await installedVersion()}\n`);
    process.exit(0);
  } catch (error) {
    fail(error);
  }
}

try {
  const connection = connectionOptions(command);
  if (command.action === "projects") {
    await listProjects(command, connection);
  } else {
    const exitCode = await runTask(command, connection);
    if (exitCode !== 0) process.exitCode = exitCode;
  }
} catch (error) {
  fail(error);
}

function readCommand(values: string[]) {
  try {
    return parseThreadlightCli(values);
  } catch (error) {
    if (!(error instanceof ThreadlightCliUsageError)) throw error;
    process.stderr.write(
      `Error: ${error.message}\n\nRun 'threadlight --help' for usage.\n`,
    );
    process.exit(2);
  }
}

function connectionOptions(command: { endpoint?: string; token?: string }): {
  endpoint: string;
  token: string;
} {
  const endpoint = command.endpoint ?? process.env.THREADLIGHT_HOST_URL;
  const token = command.token ?? process.env.THREADLIGHT_HOST_TOKEN;
  if (!endpoint?.trim()) {
    throw new ThreadlightCliUsageError(
      "Pass --host or set THREADLIGHT_HOST_URL.",
    );
  }
  if (!token?.trim()) {
    throw new ThreadlightCliUsageError(
      "Pass --token or set THREADLIGHT_HOST_TOKEN.",
    );
  }
  return { endpoint: endpoint.trim(), token };
}

async function listProjects(
  command: ThreadlightProjectsCommand,
  connection: { endpoint: string; token: string },
): Promise<void> {
  const host = new HttpHostClient(connection);
  const health = await host.health();
  if (health.protocolVersion !== THREADLIGHT_HOST_PROTOCOL_VERSION) {
    throw new Error(
      `Incompatible Threadlight Host protocol: client ${THREADLIGHT_HOST_PROTOCOL_VERSION}, Host ${health.protocolVersion}.`,
    );
  }
  const snapshot = await host.projects();
  if (command.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          host: {
            id: health.hostId,
            name: health.name,
            protocolVersion: health.protocolVersion,
          },
          ...snapshot,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (snapshot.projects.length === 0) {
    process.stdout.write("No projects are registered on this Host.\n");
    return;
  }
  process.stdout.write("ID\tSCOPE\tNAME\tPATH\n");
  for (const project of snapshot.projects) {
    process.stdout.write(
      `${project.id}\t${project.scope ?? "project"}\t${project.name}\t${project.basePath}\n`,
    );
  }
}

async function runTask(
  command: ThreadlightRunCommand,
  connection: { endpoint: string; token: string },
): Promise<number> {
  const prompt = command.prompt ?? (await pipedPrompt());
  if (!prompt?.trim()) {
    throw new ThreadlightCliUsageError(
      "Pass a prompt as arguments, after --, or on stdin.",
    );
  }

  const controller = new AbortController();
  const onInterrupt = () => {
    process.stderr.write("Interrupting the remote task…\n");
    controller.abort(new Error("Interrupted by the user."));
  };
  process.once("SIGINT", onInterrupt);
  let input: Interface | undefined;
  const approve = async (approval: RemoteTaskApproval) => {
    if (command.approveWrites) return "allow" as const;
    if (!process.stdin.isTTY) return "deny" as const;
    input ??= createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write(`\nApproval requested: ${approval.request.summary}\n`);
    if (approval.request.detail) {
      process.stderr.write(`${approval.request.detail}\n`);
    }
    const answer = await input.question("Allow this write? [y/N] ");
    return /^(?:y|yes)$/i.test(answer.trim()) ? "allow" : "deny";
  };

  try {
    const result = await runRemoteTask({
      ...connection,
      prompt,
      ...(command.project ? { project: command.project } : {}),
      ...(command.standalone ? { standalone: true } : {}),
      ...(command.threadId ? { threadId: command.threadId } : {}),
      developmentMode: command.developmentMode,
      turnMode: command.turnMode,
      fullAccess: command.fullAccess,
      capabilityRefs: command.capabilityRefs,
      ...(command.provider ? { provider: command.provider } : {}),
      ...(command.model ? { model: command.model } : {}),
      ...(command.timeoutMs ? { timeoutMs: command.timeoutMs } : {}),
      signal: controller.signal,
      approve,
      onStatus: command.json ? undefined : printStatus,
    });
    if (command.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (result.status === "completed") {
      process.stdout.write(`${result.output ?? ""}\n`);
    } else {
      process.stderr.write(`Task failed: ${result.error ?? "Unknown error"}\n`);
    }
    return result.status === "completed" ? 0 : 1;
  } finally {
    input?.close();
    process.removeListener("SIGINT", onInterrupt);
  }
}

function printStatus(status: RemoteTaskStatus): void {
  if (status.type === "connected") {
    process.stderr.write(
      `Connected to ${status.hostName} (${status.hostId}).\n`,
    );
  }
  if (status.type === "task-created") {
    process.stderr.write(`Created task ${status.threadId}.\n`);
  }
  if (status.type === "task-resumed") {
    process.stderr.write(`Continuing task ${status.threadId}.\n`);
  }
  if (status.type === "turn-started") {
    process.stderr.write(`Running turn ${status.turnId}…\n`);
  }
  if (status.type === "approval") {
    process.stderr.write(
      `${status.decision === "allow" ? "Allowed" : "Denied"}: ${status.summary}\n`,
    );
  }
}

async function pipedPrompt(): Promise<string | undefined> {
  if (process.stdin.isTTY) return;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 1024 * 1024) {
      throw new Error("Piped prompt is larger than 1 MB.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function installedVersion(): Promise<string> {
  for (const url of [
    new URL("../package.json", import.meta.url),
    new URL("./package.json", import.meta.url),
  ]) {
    try {
      const value = JSON.parse(await readFile(url, "utf8")) as {
        version?: unknown;
      };
      if (typeof value.version === "string" && value.version.trim()) {
        return value.version;
      }
    } catch {
      // Bundled and workspace layouts keep package.json in different places.
    }
  }
  throw new Error("Unable to read the installed Threadlight version.");
}

function fail(error: unknown): never {
  const usage = error instanceof ThreadlightCliUsageError;
  process.stderr.write(
    `Error: ${error instanceof Error ? error.message : String(error)}\n${
      usage ? "\nRun 'threadlight --help' for usage.\n" : ""
    }`,
  );
  process.exit(usage ? 2 : 1);
}
