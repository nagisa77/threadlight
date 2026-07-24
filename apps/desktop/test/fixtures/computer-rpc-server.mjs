import { Socket } from "node:net";
import { createInterface } from "node:readline";

const pipe = new Socket({
  fd: Number(process.env.THREADLIGHT_COMPUTER_RPC_FD),
  readable: true,
  writable: true,
});
const lines = createInterface({ input: pipe });

lines.once("line", (line) => {
  const response = JSON.parse(line);
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 91,
      result: response.result,
    })}\n`,
  );
});

pipe.write(
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 7,
    method: "computer/list",
    params: {},
  })}\n`,
);
