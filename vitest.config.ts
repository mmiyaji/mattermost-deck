import { defineConfig } from "vitest/config";

const browserStorageTests = [
  "src/favoriteCacheDatabase.test.ts",
  "src/mentionCacheDatabase.test.ts",
  "src/reviewDatabase.test.ts",
  "src/traceStorage.test.ts",
];

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: browserStorageTests,
        },
      },
      {
        extends: true,
        test: {
          name: "browser-storage",
          include: browserStorageTests,
          fileParallelism: false,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
