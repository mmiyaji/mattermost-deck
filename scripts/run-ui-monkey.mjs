import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");

const child = spawn(
  process.execPath,
  [
    playwrightCli,
    "test",
    "e2e/ui-monkey.spec.ts",
    "--workers=1",
    "--retries=0",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      MM_DECK_RUN_MONKEY: "1",
    },
  },
);

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`UI monkey test terminated by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
