import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");
const durationMinutes = process.env.MM_DECK_SOAK_MINUTES ?? "20";
const seed = process.env.MM_DECK_SOAK_SEED ?? "42";
const commandLineMode = process.argv.includes("--control")
  ? "control"
  : process.argv.includes("--auto-adjust-off")
    ? "auto-adjust-off"
    : undefined;
const mode = process.env.MM_DECK_SOAK_MODE ?? commandLineMode ?? "deck";

if (!["deck", "auto-adjust-off", "control"].includes(mode)) {
  console.error(
    `Unsupported MM_DECK_SOAK_MODE "${mode}"; use deck, auto-adjust-off, or control`,
  );
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [
    playwrightCli,
    "test",
    "e2e/layout-memory-soak.spec.ts",
    "--workers=1",
    "--retries=0",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      MM_DECK_RUN_SOAK: "1",
      MM_DECK_SOAK_MINUTES: durationMinutes,
      MM_DECK_SOAK_SEED: seed,
      MM_DECK_SOAK_MODE: mode,
    },
  },
);

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Layout memory soak terminated by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
