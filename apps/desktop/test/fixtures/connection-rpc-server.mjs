import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";

const input = createReadStream("", { fd: 4, autoClose: false });
const output = createWriteStream("", { fd: 4, autoClose: false });
const lines = createInterface({ input });

lines.once("line", (line) => {
  const response = JSON.parse(line);
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 92,
      result: response.result,
    })}\n`,
  );
});

output.write(
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 7,
    method: "connection/get",
    params: {
      connectorId: "gmail",
      version: "1.0.0",
      field: "tokens",
    },
  })}\n`,
);
