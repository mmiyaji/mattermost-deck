import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("docs");
const requiredFiles = [
  "index.html",
  "privacy/index.html",
  "terms/index.html",
  "assets/styles.css",
  "assets/site.js",
  "assets/mattermost-deck-icon.png",
  "_headers",
  "_redirects",
  "robots.txt",
  "sitemap.xml",
];
const errors = [];

function reportError(message) {
  errors.push(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function count(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

function resolveLocalReference(htmlFile, reference) {
  const trimmed = reference.trim().split(/\s+/)[0];
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:")
  ) {
    return null;
  }

  const parsed = new URL(trimmed, `https://site.invalid/${htmlFile.replaceAll("\\", "/")}`);
  if (parsed.origin !== "https://site.invalid") {
    return null;
  }

  let pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  if (!pathname || pathname.endsWith("/")) {
    pathname += "index.html";
  }
  const resolved = path.resolve(root, pathname);
  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== path.join(root, "index.html")) {
    reportError(`${htmlFile}: local reference escapes docs/: ${reference}`);
    return null;
  }
  return { pathname, resolved };
}

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    reportError(`Missing required site file: docs/${relativePath}`);
  }
}

const htmlFiles = ["index.html", "privacy/index.html", "terms/index.html"];
for (const htmlFile of htmlFiles) {
  const source = read(htmlFile);
  if (!/^<!doctype html>/i.test(source)) {
    reportError(`${htmlFile}: missing HTML doctype`);
  }
  if (source.includes("\uFFFD") || /(?:縺|繧|螟|隱)/u.test(source)) {
    reportError(`${htmlFile}: possible encoding corruption detected`);
  }
  if (!source.includes('data-lang-panel="ja"') || !source.includes('data-lang-panel="en"')) {
    reportError(`${htmlFile}: both Japanese and English panels are required`);
  }
  if (!source.includes('rel="canonical"') || !source.includes('name="description"')) {
    reportError(`${htmlFile}: canonical URL and description metadata are required`);
  }
  if (!source.includes("assets/styles.css") || !source.includes("assets/site.js")) {
    reportError(`${htmlFile}: shared stylesheet and script must be referenced`);
  }

  for (const [japanesePattern, englishPattern, label] of [
    [/data-i18n-ja=/g, /data-i18n-en=/g, "text"],
    [/data-i18n-aria-ja=/g, /data-i18n-aria-en=/g, "ARIA"],
    [/data-i18n-alt-ja=/g, /data-i18n-alt-en=/g, "alt text"],
    [/data-i18n-content-ja=/g, /data-i18n-content-en=/g, "metadata"],
  ]) {
    const japaneseCount = count(source, japanesePattern);
    const englishCount = count(source, englishPattern);
    if (japaneseCount !== englishCount) {
      reportError(`${htmlFile}: ${label} localization mismatch (${japaneseCount} ja / ${englishCount} en)`);
    }
  }

  const references = [
    ...source.matchAll(/\b(?:href|src)=["']([^"'<>]+)["']/gi),
    ...source.matchAll(/\bsrcset=["']([^"'<>]+)["']/gi),
  ].map((match) => match[1]);
  for (const reference of references) {
    const local = resolveLocalReference(htmlFile, reference);
    if (local && !fs.existsSync(local.resolved)) {
      reportError(`${htmlFile}: missing local target ${local.pathname}`);
    }
  }

  const ids = new Set([...source.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]));
  for (const match of source.matchAll(/\bhref=["']#([^"']+)["']/gi)) {
    const fragment = match[1];
    if (!ids.has(fragment)) {
      reportError(`${htmlFile}: missing fragment target #${fragment}`);
    }
  }
}

for (const legalFile of ["privacy/index.html", "terms/index.html"]) {
  const source = read(legalFile);
  const sectionCounts = new Map();
  for (const match of source.matchAll(/data-legal-section=["']([^"']+)["']/g)) {
    sectionCounts.set(match[1], (sectionCounts.get(match[1]) ?? 0) + 1);
  }
  for (const [section, sectionCount] of sectionCounts) {
    if (sectionCount !== 2) {
      reportError(`${legalFile}: legal section "${section}" must exist in both languages`);
    }
  }
}

const headers = read("_headers");
if (headers.includes("'unsafe-inline'") || !headers.includes("Content-Security-Policy:")) {
  reportError("_headers: strict Content-Security-Policy is required");
}
const globalHeaders = headers
  .split(/\r?\n\r?\n/)
  .find((block) => /^\/\*\r?\n/.test(block.trimStart()));
if (globalHeaders?.includes("Cache-Control:")) {
  reportError("_headers: global Cache-Control must not conflict with asset caching");
}

const sitemap = read("sitemap.xml");
if (!sitemap.includes("https://mattermost-deck.ruhenheim.org/")) {
  reportError("sitemap.xml: canonical custom domain is missing");
}

const css = read("assets/styles.css");
if (count(css, /\{/g) !== count(css, /\}/g)) {
  reportError("assets/styles.css: unbalanced braces");
}
const screenImageRule = css.match(/\.screen-card img\s*\{([^}]*)\}/)?.[1] ?? "";
if (!/\bheight:\s*auto\s*;/.test(screenImageRule)) {
  reportError("assets/styles.css: screen previews must preserve their intrinsic aspect ratio");
}

const scriptCheck = spawnSync(process.execPath, ["--check", path.join(root, "assets/site.js")], {
  encoding: "utf8",
});
if (scriptCheck.status !== 0) {
  reportError(`assets/site.js: ${scriptCheck.stderr.trim() || "syntax check failed"}`);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Site validation passed for ${htmlFiles.length} HTML pages and ${requiredFiles.length} required files.`);
