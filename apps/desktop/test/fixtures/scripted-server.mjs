import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });

lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "hang") return;
  const result =
    request.method === "environment"
      ? { configured: process.env.THREADLIGHT_TEST_SETTING }
      : { accepted: true };
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`,
  );
});
