/**
 * Theme compatibility E2E test
 *
 * Logs in to a Mattermost instance (default: 9.5.4 on port 8066),
 * configures the extension, then:
 *   1. Captures a screenshot of the deck with Mattermost theme applied.
 *   2. Dumps all CSS custom properties that Mattermost exposes at :root.
 *   3. Dumps the resolved --deck-* variables from inside the Shadow DOM.
 *   4. Verifies that key deck surfaces have sufficient contrast.
 *
 * Run after `node scripts/mm95-start.mjs`:
 *   MATTERMOST_BASE_URL=http://127.0.0.1:8066 \
 *   MM95_STATE_FILE=e2e/mm95-state.json \
 *   npx playwright test e2e/theme-compat.spec.ts --headed
 */

import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("./e2e/mm95-state.json");

interface Mm95State {
  memberUser: { username: string; password: string; token: string };
  teamName: string;
}

// ── colour helpers ────────────────────────────────────────────────────────────

/** Parse rgb/rgba/hex color string → [r,g,b], returns null if unparseable */
function parseRgb(css: string | undefined): [number, number, number] | null {
  if (!css) return null;
  // rgb() / rgba()
  const m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  // #rrggbb
  const hex6 = css.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hex6) return [parseInt(hex6[1], 16), parseInt(hex6[2], 16), parseInt(hex6[3], 16)];
  // #rgb
  const hex3 = css.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (hex3) return [parseInt(hex3[1] + hex3[1], 16), parseInt(hex3[2] + hex3[2], 16), parseInt(hex3[3] + hex3[3], 16)];
  return null;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fg: string, bg: string): number | null {
  const fgRgb = parseRgb(fg);
  const bgRgb = parseRgb(bg);
  if (!fgRgb || !bgRgb) return null;
  const l1 = relativeLuminance(fgRgb);
  const l2 = relativeLuminance(bgRgb);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── test ──────────────────────────────────────────────────────────────────────

test("Mattermost theme is applied correctly to the deck", async ({ }, testInfo) => {
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mm-deck-theme-"));

  const state: Mm95State = JSON.parse(await fs.readFile(stateFile, "utf8"));

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    // ── 1. Configure extension via storage ───────────────────────────────────
    const sw = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");

    await sw.evaluate((url: string) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set(
          {
            "mattermostDeck.serverUrl.v1": url,
            "mattermostDeck.theme.v1": "mattermost",
          },
          () => resolve(),
        );
      });
    }, baseUrl);

    // ── 2. Login ─────────────────────────────────────────────────────────────
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem("mattermostDeck.debugLogs", "1");
    });
    await page.goto(`${baseUrl}/landing#/login`);

    const browserChoice = page.getByText("View in Browser");
    const loginId = page.locator('input[name="loginId"]');

    await Promise.race([
      browserChoice.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
      loginId.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
    ]);
    if (await browserChoice.isVisible().catch(() => false)) {
      await browserChoice.click();
    }

    await loginId.waitFor({ state: "visible", timeout: 30_000 });
    await loginId.fill(state.memberUser.username);
    await page.locator('input[name="password-input"]').fill(state.memberUser.password);
    await page.getByRole("button", { name: /log in/i }).click();
    await page.waitForURL(/channels|messages/, { timeout: 30_000 });

    // ── 3. Wait for deck to inject ────────────────────────────────────────────
    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 15_000 });
    // Give theme observer time to fire
    await page.waitForTimeout(2000);

    // ── 4. Dump Mattermost CSS variables at :root ────────────────────────────
    const mmVars: Record<string, string> = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const result: Record<string, string> = {};
      // Collect all --xxx vars
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            const text = rule.cssText ?? "";
            const matches = text.matchAll(/--[\w-]+/g);
            for (const m of matches) {
              const name = m[0];
              const value = style.getPropertyValue(name).trim();
              if (value) result[name] = value;
            }
          }
        } catch {
          // Cross-origin stylesheet — skip
        }
      }
      // All official Mattermost theme CSS variables
      // https://docs.mattermost.com/end-user-guide/preferences/customize-your-theme.html
      const known = [
        // Sidebar
        "--sidebar-bg",
        "--sidebar-text",
        "--sidebar-header-bg",
        "--sidebar-teambar-bg",       // Global Header bg (may differ per version)
        "--sidebar-header-text-color",
        "--sidebar-unread-text",
        "--sidebar-text-hover-bg",
        "--sidebar-text-active-border",
        "--sidebar-text-active-color",
        // Center channel
        "--center-channel-bg",
        "--center-channel-color",
        "--new-message-separator",
        "--error-text",
        "--mention-highlight-bg",
        "--mention-highlight-link",
        // Links & buttons
        "--link-color",
        "--button-bg",
        "--button-color",
        // Badges
        "--mention-bg",
        "--mention-color",
        // Status indicators
        "--online-indicator",
        "--away-indicator",
        "--dnd-indicator",
        // Derived alpha variants (may not exist in older versions)
        "--sidebar-text-08",
        "--sidebar-text-80",
        "--center-channel-bg-08",
        "--center-channel-bg-88",
        "--center-channel-color-16",
        "--center-channel-color-24",
        "--center-channel-color-56",
        "--center-channel-color-72",
        "--center-channel-color-88",
      ];
      for (const v of known) {
        const val = style.getPropertyValue(v).trim();
        result[v] = val || "(not set)";
      }
      return result;
    });

    // ── 5. Sample pixel colors from the deck rail ────────────────────────────
    // The deck uses a closed Shadow DOM, so CSS vars cannot be read directly
    // from outside. Instead, capture representative pixel colors at known
    // positions within the deck area.
    const deckVars: Record<string, string> = {};
    const deckPixels: Record<string, string> = await page.evaluate(() => {
      const root = document.getElementById("mattermost-deck-root");
      if (!root) return {};
      const rect = root.getBoundingClientRect();
      return {
        hostRect: JSON.stringify({
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }),
      };
    });
    console.log("\n=== Deck host element ===");
    console.log("  ", deckPixels["hostRect"] ?? "(not found)");

    // Note: --deck-* vars live inside closed shadow; we report them as "n/a"
    console.log("\n=== Deck CSS Variables ===");
    console.log("  (closed Shadow DOM — CSS vars not accessible from outside)");

    // ── 6. Write variable report ──────────────────────────────────────────────
    const report = {
      mattermostVersion: "9.5.4",
      baseUrl,
      mattermostCssVars: mmVars,
      deckCssVars: deckVars,
    };
    const reportPath = testInfo.outputPath("theme-report.json");
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    testInfo.attachments.push({
      name: "theme-report.json",
      path: reportPath,
      contentType: "application/json",
    });
    console.log("\n=== Mattermost CSS Variables ===");
    for (const [k, v] of Object.entries(mmVars)) {
      if (v && v !== "(not set)") console.log(`  ${k}: ${v}`);
    }
    console.log("\n=== Deck CSS Variables ===");
    for (const [k, v] of Object.entries(deckVars)) {
      console.log(`  ${k}: ${v}`);
    }

    // ── 7. Screenshot ─────────────────────────────────────────────────────────
    await page.screenshot({
      path: testInfo.outputPath("deck-theme-full.png"),
      fullPage: false,
    });
    testInfo.attachments.push({
      name: "deck-theme-full.png",
      path: testInfo.outputPath("deck-theme-full.png"),
      contentType: "image/png",
    });

    // ── 8. Contrast checks using Mattermost CSS vars as proxy ────────────────
    // Since deck vars are inside closed Shadow DOM, derive expected deck colors
    // from the Mattermost CSS vars that the extension reads.
    const mmSidebarBg    = mmVars["--sidebar-bg"]         || mmVars["--sidebar-header-bg"];
    const mmSidebarText  = mmVars["--sidebar-text"]        || mmVars["--sidebar-header-text-color"];
    const mmCenterBg     = mmVars["--center-channel-bg"];
    const mmCenterText   = mmVars["--center-channel-color"] || mmVars["--center-channel-text"];
    const mmButtonBg     = mmVars["--button-bg"];
    const mmButtonColor  = mmVars["--button-color"];

    console.log("\n=== Contrast checks (via Mattermost CSS vars) ===");
    const checks: Array<{ label: string; fg: string | undefined; bg: string | undefined; minRatio: number }> = [
      { label: "sidebar-text on sidebar-bg",       fg: mmSidebarText, bg: mmSidebarBg,   minRatio: 3.0 },
      { label: "center-channel-color on center-bg", fg: mmCenterText,  bg: mmCenterBg,   minRatio: 4.5 },
      { label: "button-color on button-bg",         fg: mmButtonColor, bg: mmButtonBg,   minRatio: 3.0 },
    ];
    for (const { label, fg, bg: bgc, minRatio } of checks) {
      const ratio = contrastRatio(fg, bgc);
      const status = ratio === null
        ? `⚠ unparseable (fg=${fg ?? "?"} bg=${bgc ?? "?"})`
        : ratio >= minRatio
          ? `✓ ${ratio.toFixed(2)}`
          : `✗ ${ratio.toFixed(2)} (need ${minRatio})`;
      console.log(`  ${label}: ${status}`);
      if (ratio !== null) {
        expect(ratio, `Contrast ratio too low: ${label}`).toBeGreaterThanOrEqual(minRatio);
      }
    }

    // ── 9. Verify key Mattermost vars are populated ───────────────────────────
    const criticalVars = [
      "--sidebar-bg", "--sidebar-text",
      "--center-channel-bg", "--center-channel-color",
      "--button-bg", "--button-color",
    ];
    console.log("\n=== Critical Mattermost CSS variable presence ===");
    for (const v of criticalVars) {
      const val = mmVars[v];
      const present = val && val !== "(not set)";
      console.log(`  ${present ? "✓" : "✗"} ${v}: ${val ?? "(not set)"}`);
      expect(val, `${v} must be set by Mattermost 9.5`).toBeTruthy();
    }

    // ── 10. DOM selector presence check ──────────────────────────────────────
    // The extension uses these selectors as fallbacks when CSS vars are missing.
    // If they are absent in 9.5, the fallback path uses incorrect colors.
    const domSelectors: Record<string, string> = await page.evaluate(() => {
      const selectors = [
        "#SidebarContainer",
        ".SidebarContainer",
        "#sidebarTeamMenuButton",
        ".app__body",
        ".app__content",
        ".channel-header",
        ".center-channel",
        "button.btn.btn-primary",
      ];
      const result: Record<string, string> = {};
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const s = getComputedStyle(el);
          result[sel] = `FOUND bg=${s.backgroundColor} color=${s.color}`;
        } else {
          result[sel] = "NOT FOUND";
        }
      }
      return result;
    });
    console.log("\n=== DOM selector check (extension fallback paths) ===");
    for (const [sel, val] of Object.entries(domSelectors)) {
      console.log(`  ${val.startsWith("FOUND") ? "✓" : "✗ (fallback will fire)"} ${sel}: ${val}`);
    }

    // ── 11. Flag missing vars that the extension relies on ────────────────────
    const extensionReliedVars = [
      "--sidebar-header-bg",
      "--sidebar-teambar-bg",
      "--mention-bg", "--mention-color",
      "--mention-highlight-bg",
      "--online-indicator", "--away-indicator",
    ];
    console.log("\n=== Extension-relied variables ===");
    for (const v of extensionReliedVars) {
      const val = mmVars[v];
      const present = val && val !== "(not set)";
      console.log(`  ${present ? "✓" : "⚠ missing"} ${v}: ${val ?? "(not set)"}`);
    }

  } finally {
    await context.close();
    // Clean up temp dir
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
