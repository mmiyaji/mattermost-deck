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
if (manifest.default_locale !== "en") {
  report('dist/manifest.json default_locale must be "en"');
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

const expectedOptionalHostPermissions = [
  "http://*.localhost/*",
  "http://127.0.0.1/*",
  "http://[::1]/*",
  "http://localhost/*",
  "https://*/*",
];
const actualOptionalHostPermissions = [
  ...(manifest.optional_host_permissions ?? []),
].sort();
if (
  JSON.stringify(actualOptionalHostPermissions) !==
  JSON.stringify(expectedOptionalHostPermissions)
) {
  report(
    `dist/manifest.json optional_host_permissions must exactly match the reviewed allowlist; found ${actualOptionalHostPermissions.join(", ")}`,
  );
}

const expectedIcons = {
  16: "assets/icons/icon-16.png",
  32: "assets/icons/icon-32.png",
  48: "assets/icons/icon-48.png",
  128: "assets/icons/icon-128.png",
};
if (JSON.stringify(manifest.icons ?? {}) !== JSON.stringify(expectedIcons)) {
  report("dist/manifest.json icons do not match the reviewed icon set");
}

const expectedLocales = ["de", "en", "fr", "ja", "zh_CN"];
const actualLocales = fs
  .readdirSync(path.join(distDir, "_locales"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (JSON.stringify(actualLocales) !== JSON.stringify(expectedLocales)) {
  report(
    `dist/_locales must contain exactly ${expectedLocales.join(", ")}; found ${actualLocales.join(", ")}`,
  );
}
for (const locale of expectedLocales) {
  const messagesPath = path.join(
    distDir,
    "_locales",
    locale,
    "messages.json",
  );
  if (!fs.existsSync(messagesPath)) {
    report(`dist/_locales/${locale}/messages.json is missing`);
    continue;
  }
  const messages = readJson(messagesPath);
  for (const key of ["appName", "appDescription"]) {
    if (
      typeof messages[key]?.message !== "string" ||
      messages[key].message.trim().length === 0
    ) {
      report(
        `dist/_locales/${locale}/messages.json ${key}.message is missing`,
      );
    }
  }
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
