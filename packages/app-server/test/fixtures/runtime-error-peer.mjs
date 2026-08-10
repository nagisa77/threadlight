process.stderr.write(
  "App-server output transport failed: JSON line output exceeded 67108864 buffered bytes\n",
  () => process.exit(1),
);
