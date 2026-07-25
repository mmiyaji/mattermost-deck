import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");
const errors = [];

function report(message) {
  errors.push(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(prefix, entry.name);
    return entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), relativePath)
      : [relativePath];
  });
}

if (!fs.existsSync(distDir)) {
  console.error("- dist/: store build output is missing");
  process.exit(1);
}

const packageJson = readJson(path.join(root, "package.json"));
const manifestPath = path.join(distDir, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error("- dist/manifest.json is missing");
  process.exit(1);
}

const manifest = readJson(manifestPath);
const files = listFiles(distDir);
const normalizedFiles = files.map((file) => file.replaceAll("\\", "/"));

for (const requiredFile of [
  "manifest.json",
  "background.js",
  "content.js",
  "options.html",
  "options.js",
  "popup.html",
  "popup.js",
]) {
  if (!normalizedFiles.includes(requiredFile)) {
    report(`dist/${requiredFile} is missing`);
  }
}

if (manifest.version !== packageJson.version) {
  report(
    `dist/manifest.json version "${String(manifest.version)}" does not match package version "${packageJson.version}"`,
  );
}
if (manifest.minimum_chrome_version !== "120") {
  report('dist/manifest.json minimum_chrome_version must be "120"');
}
if (manifest.homepage_url !== "https://mattermost-deck.ruhenheim.org/") {
  report("dist/manifest.json homepage_url is not the canonical public website");
}

const expectedPermissions = ["alarms", "scripting", "storage", "tabs"];
const actualPermissions = [...(manifest.permissions ?? [])].sort();
if (JSON.stringify(actualPermissions) !== JSON.stringify(expectedPermissions)) {
  report(
    `dist/manifest.json permissions must be ${expectedPermissions.join(", ")}; found ${actualPermissions.join(", ")}`,
  );
}
if ("host_permissions" in manifest) {
  report("dist/manifest.json must not contain development-only static host_permissions");
}
if ("content_scripts" in manifest) {
  report("dist/manifest.json must not contain development-only static content_scripts");
}

const sourceMaps = normalizedFiles.filter((file) => file.endsWith(".map"));
if (sourceMaps.length > 0) {
  report(`store build contains source maps: ${sourceMaps.join(", ")}`);
}

const debugMarkers = [
  "mattermost-deck-debug-request",
  "mattermost-deck-debug-response",
  "mattermost-deck-debug-open-thread",
  "__mattermostDeckDebug",
];
for (const file of normalizedFiles.filter((candidate) => candidate.endsWith(".js"))) {
  const source = fs.readFileSync(path.join(distDir, file), "utf8");
  const includedMarkers = debugMarkers.filter((marker) => source.includes(marker));
  if (includedMarkers.length > 0) {
    report(`dist/${file} contains E2E debug markers: ${includedMarkers.join(", ")}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const totalBytes = files.reduce(
  (total, file) => total + fs.statSync(path.join(distDir, file)).size,
  0,
);
console.log(
  `Store build validation passed for v${manifest.version}: ${files.length} files, ${totalBytes.toLocaleString("en-US")} bytes.`,
);
