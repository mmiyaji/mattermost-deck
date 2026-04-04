import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const watch = process.argv.includes("--watch");
const inGithubActions = process.env.GITHUB_ACTIONS === "true";
const sourcemap = watch || !inGithubActions;

const root = process.cwd();
const srcDir = path.join(root, "src");
const distDir = path.join(root, "dist");

const rawRef = process.env.EXT_VERSION || "0.1.0";
const normalizedVersion = rawRef.replace(/^v/, "");

if (!/^\d+(\.\d+){0,3}$/.test(normalizedVersion)) {
  throw new Error(
    `Invalid Chrome extension version: ${rawRef} -> ${normalizedVersion}`
  );
}

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(distDir, { recursive: true });

const manifestPath = path.join(srcDir, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
manifest.version = normalizedVersion;
manifest.version_name = rawRef;

await fs.writeFile(
  path.join(distDir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  "utf8"
);

await fs.copyFile(path.join(srcDir, "options", "index.html"), path.join(distDir, "options.html"));
await fs.copyFile(path.join(srcDir, "popup", "index.html"), path.join(distDir, "popup.html"));
await fs.cp(path.join(srcDir, "assets"), path.join(distDir, "assets"), { recursive: true });

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
  },
});

if (watch) {
  await ctx.watch();
  console.log("Watching extension sources...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}