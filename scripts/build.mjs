import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const watch = process.argv.includes("--watch");
const root = process.cwd();
const srcDir = path.join(root, "src");
const distDir = path.join(root, "dist");

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(distDir, { recursive: true });
await fs.copyFile(path.join(srcDir, "manifest.json"), path.join(distDir, "manifest.json"));
await fs.copyFile(path.join(srcDir, "options", "index.html"), path.join(distDir, "options.html"));
await fs.cp(path.join(srcDir, "assets"), path.join(distDir, "assets"), { recursive: true });

const ctx = await esbuild.context({
  entryPoints: {
    background: path.join(srcDir, "background.ts"),
    content: path.join(srcDir, "content", "index.tsx"),
    options: path.join(srcDir, "options", "index.tsx"),
  },
  bundle: true,
  outdir: distDir,
  format: "iife",
  target: "chrome120",
  sourcemap: true,
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
