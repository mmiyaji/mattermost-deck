import { defineConfig } from "@playwright/test";
import path from "node:path";

const extensionPath = path.resolve("./dist");

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  reporter: "list",
  use: {
    headless: false,
  }
});
