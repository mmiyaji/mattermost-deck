import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = process.cwd();
const outputDir = path.join(root, "docs", "assets", "webstore");
const iconSvg = await fs.readFile(path.join(root, "src", "assets", "icons", "icon.svg"), "utf8");

const sizes = [
  { name: "promo-tile-440x280.png", width: 440, height: 280, variant: "promo" },
  { name: "marquee-promo-tile-1400x560.png", width: 1400, height: 560, variant: "marquee" },
];

function escapeForTemplate(value) {
  return value.replaceAll("`", "\\`").replaceAll("${", "\\${");
}

function buildCard(x, y, w, h, accent) {
  return `
    <div class="deck-card" style="left:${x}px; top:${y}px; width:${w}px; height:${h}px;">
      <div class="deck-card-top">
        <span class="deck-card-dot" style="background:${accent};"></span>
        <span class="deck-card-line deck-card-line--short"></span>
      </div>
      <span class="deck-card-line"></span>
      <span class="deck-card-line deck-card-line--soft"></span>
      <span class="deck-card-line deck-card-line--short"></span>
    </div>
  `;
}

function buildMarkup({ width, height, variant }) {
  const iconScale = variant === "promo" ? 1.55 : 2.25;
  const iconSize = Math.round(128 * iconScale);
  const iconLeft = variant === "promo" ? 34 : 118;
  const iconTop = variant === "promo" ? 56 : 142;
  const clusterLeft = variant === "promo" ? 206 : 650;
  const clusterTop = variant === "promo" ? 54 : 86;
  const cards = variant === "promo"
    ? [
        buildCard(clusterLeft + 0, clusterTop + 0, 176, 58, "#29c08a"),
        buildCard(clusterLeft + 16, clusterTop + 70, 154, 54, "#56a3ff"),
        buildCard(clusterLeft - 10, clusterTop + 136, 166, 48, "#f0b94b"),
      ].join("")
    : [
        buildCard(clusterLeft + 0, clusterTop + 8, 480, 94, "#29c08a"),
        buildCard(clusterLeft + 42, clusterTop + 126, 418, 84, "#56a3ff"),
        buildCard(clusterLeft - 16, clusterTop + 236, 456, 78, "#f0b94b"),
      ].join("");

  const orbSize = variant === "promo" ? 168 : 336;
  const orbLeft = variant === "promo" ? 230 : 885;
  const orbTop = variant === "promo" ? -44 : -96;

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          :root {
            color-scheme: dark;
          }
          html, body {
            margin: 0;
            width: ${width}px;
            height: ${height}px;
            overflow: hidden;
            background: #1b2b44;
            font-family: "Segoe UI", sans-serif;
          }
          .frame {
            position: relative;
            width: 100%;
            height: 100%;
            background:
              radial-gradient(circle at 18% 18%, rgba(93, 176, 255, 0.20), transparent 34%),
              radial-gradient(circle at 82% 22%, rgba(41, 192, 138, 0.16), transparent 28%),
              linear-gradient(140deg, #1a2940 0%, #213754 46%, #17273d 100%);
          }
          .grid {
            position: absolute;
            inset: 0;
            background-image:
              linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
            background-size: 28px 28px;
            mask-image: linear-gradient(180deg, rgba(0,0,0,0.9), rgba(0,0,0,0.18));
          }
          .orb {
            position: absolute;
            left: ${orbLeft}px;
            top: ${orbTop}px;
            width: ${orbSize}px;
            height: ${orbSize}px;
            border-radius: 50%;
            background: radial-gradient(circle at 35% 35%, rgba(103, 189, 255, 0.25), rgba(103, 189, 255, 0.03) 54%, transparent 72%);
            filter: blur(${variant === "promo" ? 2 : 6}px);
          }
          .icon-wrap {
            position: absolute;
            left: ${iconLeft}px;
            top: ${iconTop}px;
            width: ${iconSize}px;
            height: ${iconSize}px;
            display: grid;
            place-items: center;
            border-radius: ${variant === "promo" ? 44 : 56}px;
            background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
            box-shadow:
              0 28px 60px rgba(6, 14, 28, 0.34),
              inset 0 1px 0 rgba(255,255,255,0.06);
            backdrop-filter: blur(10px);
          }
          .icon-wrap svg {
            width: ${Math.round(iconSize * 0.78)}px;
            height: ${Math.round(iconSize * 0.78)}px;
            display: block;
          }
          .deck-cluster {
            position: absolute;
            left: 0;
            top: 0;
          }
          .deck-card {
            position: absolute;
            padding: ${variant === "promo" ? 12 : 18}px;
            border-radius: ${variant === "promo" ? 16 : 22}px;
            background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.055));
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 18px 32px rgba(9, 18, 34, 0.22);
            backdrop-filter: blur(8px);
          }
          .deck-card-top {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
          }
          .deck-card-dot {
            width: ${variant === "promo" ? 10 : 13}px;
            height: ${variant === "promo" ? 10 : 13}px;
            border-radius: 50%;
            flex: none;
          }
          .deck-card-line {
            display: block;
            height: ${variant === "promo" ? 8 : 11}px;
            border-radius: 999px;
            background: rgba(240, 246, 255, 0.88);
            margin-top: 8px;
            width: 100%;
          }
          .deck-card-line--soft {
            width: 84%;
            opacity: 0.55;
          }
          .deck-card-line--short {
            width: 48%;
            opacity: 0.72;
          }
          .edge-glow {
            position: absolute;
            inset: auto 0 0 0;
            height: 42%;
            background: linear-gradient(180deg, transparent, rgba(7, 13, 25, 0.24));
          }
        </style>
      </head>
      <body>
        <div class="frame">
          <div class="grid"></div>
          <div class="orb"></div>
          <div class="icon-wrap">${escapeForTemplate(iconSvg)}</div>
          <div class="deck-cluster">${cards}</div>
          <div class="edge-glow"></div>
        </div>
      </body>
    </html>
  `;
}

await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

for (const size of sizes) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.setContent(buildMarkup(size));
  await page.screenshot({
    path: path.join(outputDir, size.name),
    type: "png",
  });
}

await browser.close();

console.log(`Generated store assets in ${outputDir}`);
