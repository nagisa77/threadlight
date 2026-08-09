process.stdout.write(
  `${JSON.stringify({
    jsonrpc: "2.0",
    method: "fixture/complete-output",
    params: { accepted: true },
  })}\n`,
);
process.stdout.write('{"jsonrpc":"2.0","method":"fixture/incomplete');
