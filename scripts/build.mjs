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

// manifest をそのままコピーせず、必要なら書き換えて出力
const manifestPath = path.join(srcDir, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

// EXT_VERSION が設定されている場合、version を更新
if (process.env.EXT_VERSION) {
  manifest.version = process.env.EXT_VERSION.replace(/^v/, '');
}

if (storeBuild && Array.isArray(manifest.content_scripts)) {
  manifest.content_scripts = manifest.content_scripts
    .map((entry) => {
      if (!Array.isArray(entry.matches)) return entry;

      const filteredMatches = entry.matches.filter(
        (m) => m !== "http://127.0.0.1/*" && m !== "http://localhost/*"
      );

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

const appVersion = process.env.EXT_VERSION ? process.env.EXT_VERSION.replace(/^v/, '') : '0.1.0';

// version.ts を書き換え
const versionPath = path.join(srcDir, "version.ts");
const versionContent = `export const APP_VERSION = "${appVersion}";\n`;
await fs.writeFile(versionPath, versionContent, "utf8");

const ctx = await esbuild.context({
  entryPoints: {
    background: path.join(srcDir, "background.ts"),
    content: path.join(srcDir, "content", "index.tsx"),
    options: path.join(srcDir, "options", "index.tsx"),
    popup: path.join(srcDir, "popup", "index.ts"),
    "pwa-install": path.join(srcDir, "pwa-install", "index.ts"),
  },
  bundle: true,
  outdir: distDir,
  format: "iife",
  target: "chrome120",
  sourcemap,
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
}