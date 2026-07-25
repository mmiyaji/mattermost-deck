import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function report(message) {
  errors.push(message);
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const manifest = readJson("src/manifest.json");
const versionSource = read("src/version.ts");
const versionMatch = versionSource.match(
  /^\s*export const APP_VERSION = ["']([^"']+)["'];?\s*$/m,
);
const version = packageJson.version;

if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
  report(`package.json: expected a numeric SemVer version, found "${String(version)}"`);
} else {
  const parts = version.split(".").map(Number);
  if (parts.some((part) => part > 65_535) || parts.every((part) => part === 0)) {
    report(`package.json: "${version}" is not a valid Chrome extension version`);
  }
}

for (const [label, candidate] of [
  ["package-lock.json top-level version", packageLock.version],
  ["package-lock.json root package version", packageLock.packages?.[""]?.version],
  ["src/manifest.json version", manifest.version],
  ["src/version.ts APP_VERSION", versionMatch?.[1]],
]) {
  if (candidate !== version) {
    report(`${label}: expected "${version}", found "${String(candidate)}"`);
  }
}

if (manifest.minimum_chrome_version !== "120") {
  report(
    `src/manifest.json minimum_chrome_version: expected "120", found "${String(manifest.minimum_chrome_version)}"`,
  );
}

if (manifest.permissions?.includes("windows")) {
  report('src/manifest.json: unnecessary named permission "windows" must not be included');
}

const requestedTag = process.argv[2] ?? process.env.EXT_VERSION;
if (requestedTag) {
  const requestedVersion = requestedTag.replace(/^v/, "");
  if (requestedVersion !== version) {
    report(`release tag/version "${requestedTag}" does not match source version "${version}"`);
  }
}

for (const [relativePath, requiredText] of [
  ["CHANGELOG.md", `## [${version}] - `],
  ["README.md", `v${version}`],
  ["README.ja.md", `v${version}`],
  ["docs/index.html", `Chrome extension · v${version}`],
  ["docs/index.html", `Mattermost Deck v${version}`],
  ["docs/index.html", `assets/styles.css?v=${version}`],
  ["docs/privacy/index.html", `assets/styles.css?v=${version}`],
  ["docs/terms/index.html", `assets/styles.css?v=${version}`],
  ["docs/chrome-web-store-submission.md", `## v${version} release notes`],
  ["docs/chrome-web-store-submission.ja.md", `## v${version} リリースノート`],
]) {
  if (!read(relativePath).includes(requiredText)) {
    report(`${relativePath}: missing release marker "${requiredText}"`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Release metadata is aligned at v${version}.`);
