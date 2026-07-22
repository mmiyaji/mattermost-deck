import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const watch = process.argv.includes("--watch");
const inGithubActions = process.env.GITHUB_ACTIONS === "true";
const storeBuild = process.env.STORE_BUILD === "true";
const sourcemap = watch || (!storeBuild && !inGithubActions);

const root = process.cwd();
const srcDir = path.join(root, "src");
const distDir = path.join(root, "dist");

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(distDir, { recursive: true });

// Load the source manifest and override the version when EXT_VERSION is set.
const manifestPath = path.join(srcDir, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const localesDir = path.join(srcDir, "_locales");
const LOCAL_DEVELOPMENT_MATCHES = new Set([
  "http://127.0.0.1/*",
  "http://localhost/*",
]);

function assertChromeExtensionVersion(version) {
  const parts = String(version).split(".");
  const valid =
    parts.length >= 1 &&
    parts.length <= 4 &&
    parts.every((part) => /^(0|[1-9]\d*)$/.test(part) && Number(part) <= 65_535) &&
    parts.some((part) => Number(part) !== 0);
  if (!valid) {
    throw new Error(
      `Invalid Chrome extension version "${version}". Use 1-4 numeric components between 0 and 65535.`,
    );
  }
}

// If EXT_VERSION is provided, use it for the built manifest version. Validate
// both tag-derived and source versions before creating a release artifact.
manifest.version = process.env.EXT_VERSION
  ? process.env.EXT_VERSION.replace(/^v/, "")
  : manifest.version;
assertChromeExtensionVersion(manifest.version);

for (const localeEntry of await fs.readdir(localesDir, { withFileTypes: true })) {
  if (!localeEntry.isDirectory()) continue;
  const messagesPath = path.join(localesDir, localeEntry.name, "messages.json");
  const messages = JSON.parse(await fs.readFile(messagesPath, "utf8"));
  const description = messages?.appDescription?.message;
  if (typeof description !== "string" || description.length === 0 || description.length > 132) {
    throw new Error(
      `Locale ${localeEntry.name} appDescription must contain 1-132 characters; found ${String(description ?? "").length}.`,
    );
  }
}

if (storeBuild && Array.isArray(manifest.content_scripts)) {
  manifest.content_scripts = manifest.content_scripts
    .map((entry) => {
      if (!Array.isArray(entry.matches)) return entry;

      const filteredMatches = entry.matches.filter((match) => !LOCAL_DEVELOPMENT_MATCHES.has(match));

      return {
        ...entry,
        matches: filteredMatches,
      };
    })
    .filter((entry) => Array.isArray(entry.matches) && entry.matches.length > 0);

  if (manifest.content_scripts.length === 0) {
    delete manifest.content_scripts;
  }
}

if (storeBuild && Array.isArray(manifest.host_permissions)) {
  manifest.host_permissions = manifest.host_permissions.filter(
    (match) => !LOCAL_DEVELOPMENT_MATCHES.has(match),
  );
  if (manifest.host_permissions.length === 0) {
    delete manifest.host_permissions;
  }
}

await fs.writeFile(
  path.join(distDir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  "utf8"
);

await fs.copyFile(
  path.join(srcDir, "options", "index.html"),
  path.join(distDir, "options.html")
);
await fs.copyFile(
  path.join(srcDir, "popup", "index.html"),
  path.join(distDir, "popup.html")
);
await fs.cp(path.join(srcDir, "assets"), path.join(distDir, "assets"), {
  recursive: true,
});
await fs.cp(localesDir, path.join(distDir, "_locales"), {
  recursive: true,
});

const appVersion = process.env.EXT_VERSION ? process.env.EXT_VERSION.replace(/^v/, "") : manifest.version;

// Keep the in-app version label aligned with the build version.
const versionPath = path.join(srcDir, "version.ts");
const versionContent = `export const APP_VERSION = "${appVersion}";\n`;
await fs.writeFile(versionPath, versionContent, "utf8");

const ctx = await esbuild.context({
  entryPoints: {
    background: path.join(srcDir, "background.ts"),
    content: path.join(srcDir, "content", "index.tsx"),
    options: path.join(srcDir, "options", "index.tsx"),
    popup: path.join(srcDir, "popup", "index.ts"),
    "pwa-install-config": path.join(srcDir, "pwa-install", "config.ts"),
    "pwa-install": path.join(srcDir, "pwa-install", "index.ts"),
  },
  bundle: true,
  outdir: distDir,
  format: "iife",
  target: "chrome120",
  sourcemap,
  minifySyntax: storeBuild,
  define: {
    __MATTERMOST_DECK_E2E_DEBUG__: JSON.stringify(!storeBuild),
  },
  loader: {
    ".ts": "ts",
    ".tsx": "tsx",
    ".json": "json",
  },
});

if (watch) {
  await ctx.watch();
  console.log("Watching extension sources...");
} else {
  await ctx.rebuild();
  await ctx.dispose();

  const contentBundle = await fs.readFile(path.join(distDir, "content.js"), "utf8");
  const debugBridgeMarkers = [
    "mattermost-deck-debug-request",
    "mattermost-deck-debug-response",
    "mattermost-deck-debug-open-thread",
    "__mattermostDeckDebug",
  ];
  const includedDebugMarkers = debugBridgeMarkers.filter((marker) => contentBundle.includes(marker));
  if (storeBuild && includedDebugMarkers.length > 0) {
    throw new Error(`Store build contains E2E debug bridge markers: ${includedDebugMarkers.join(", ")}`);
  }
  if (!storeBuild && !contentBundle.includes("mattermost-deck-debug-request")) {
    throw new Error("Development build is missing the E2E debug bridge");
  }
}
