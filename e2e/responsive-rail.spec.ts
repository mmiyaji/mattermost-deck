import { test, expect, chromium, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.MATTERMOST_BASE_URL ?? "http://127.0.0.1:8066";
const stateFile = process.env.MM95_STATE_FILE ?? path.resolve("e2e/mm95-state.json");
const RAIL_WIDTH_STORAGE_KEY = "mattermostDeck.railWidth.v1";
const DRAWER_OPEN_STORAGE_KEY = "mattermostDeck.drawerOpen.v1";
const PREFERRED_RAIL_WIDTH_STORAGE_KEY = "mattermostDeck.preferredRailWidth.v1";

interface E2EState {
  memberUser: { username: string; password: string };
}

interface LayoutWidths {
  viewport: number;
  mattermost: number;
  deck: number;
  overlap: number;
}

interface ResizeFrame extends LayoutWidths {
  gap: number;
}

async function readState(): Promise<E2EState> {
  return JSON.parse(await fs.readFile(stateFile, "utf8")) as E2EState;
}

async function login(page: Page, username: string, password: string): Promise<void> {
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
  await loginId.fill(username);
  await page.locator('input[name="password-input"]').fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/channels|messages/, { timeout: 30_000 });
}

async function getLayoutWidths(page: Page): Promise<LayoutWidths> {
  return await page.evaluate(() => {
    const mattermost = document.querySelector<HTMLElement>("#root");
    const deck = document.querySelector<HTMLElement>("#mattermost-deck-root");
    if (!mattermost || !deck) {
      return { viewport: window.innerWidth, mattermost: -1, deck: -1, overlap: -1 };
    }

    const mattermostRect = mattermost.getBoundingClientRect();
    const deckRect = deck.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      mattermost: Math.round(mattermostRect.width),
      deck: Math.round(deckRect.width),
      overlap: Math.round(Math.max(0, mattermostRect.right - deckRect.left)),
    };
  });
}

async function prepareResizeFrameCapture(page: Page, targetViewportWidth: number, frameCount = 30): Promise<void> {
  await page.evaluate(({ framesToCapture, targetWidth }) => {
    const targetWindow = window as typeof window & {
      __mattermostDeckResizeFrames?: ResizeFrame[];
    };
    targetWindow.__mattermostDeckResizeFrames = [];

    const handleResize = () => {
      if (window.innerWidth !== targetWidth) {
        return;
      }
      window.removeEventListener("resize", handleResize);
      let remaining = framesToCapture;
      const capture = () => {
        const mattermost = document.querySelector<HTMLElement>("#root");
        const deck = document.querySelector<HTMLElement>("#mattermost-deck-root");
        if (mattermost && deck) {
          const mattermostRect = mattermost.getBoundingClientRect();
          const deckRect = deck.getBoundingClientRect();
          targetWindow.__mattermostDeckResizeFrames?.push({
            viewport: window.innerWidth,
            mattermost: mattermostRect.width,
            deck: deckRect.width,
            overlap: Math.max(0, mattermostRect.right - deckRect.left),
            gap: Math.max(0, deckRect.left - mattermostRect.right),
          });
        }

        remaining -= 1;
        if (remaining > 0) {
          window.requestAnimationFrame(capture);
        }
      };
      capture();
    };
    window.addEventListener("resize", handleResize);
  }, { framesToCapture: frameCount, targetWidth: targetViewportWidth });
}

async function getResizeFrameCapture(page: Page): Promise<ResizeFrame[]> {
  return await page.evaluate(() => (
    (window as typeof window & { __mattermostDeckResizeFrames?: ResizeFrame[] })
      .__mattermostDeckResizeFrames ?? []
  ));
}

test("preserves the Mattermost area and restores the requested Deck width after resizing", async () => {
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-responsive-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1_800, height: 900 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const state = await readState();
    const [existingSw] = context.serviceWorkers();
    const sw = existingSw ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    await sw.evaluate(({ serverUrl, railKey, drawerKey }) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.set({
          "mattermostDeck.serverUrl.v1": serverUrl,
          [railKey]: 900,
          [drawerKey]: 1,
        }, () => resolve());
      });
    }, { serverUrl: baseUrl, railKey: RAIL_WIDTH_STORAGE_KEY, drawerKey: DRAWER_OPEN_STORAGE_KEY });

    const page = await context.newPage();
    await login(page, state.memberUser.username, state.memberUser.password);
    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });

    await expect.poll(() => getLayoutWidths(page), { timeout: 20_000 }).toEqual({
      viewport: 1_800,
      mattermost: 900,
      deck: 900,
      overlap: 0,
    });

    await prepareResizeFrameCapture(page, 1_000);
    await page.setViewportSize({ width: 1_000, height: 900 });
    await expect.poll(async () => (await getResizeFrameCapture(page)).length, { timeout: 10_000 }).toBe(30);
    const resizeFrames = await getResizeFrameCapture(page);
    expect(resizeFrames.every((frame) => frame.viewport === 1_000)).toBe(true);
    expect(Math.max(...resizeFrames.map((frame) => frame.overlap))).toBeLessThanOrEqual(0.5);
    expect(Math.max(...resizeFrames.map((frame) => frame.gap))).toBeLessThanOrEqual(0.5);
    await expect.poll(() => getLayoutWidths(page), { timeout: 10_000 }).toEqual({
      viewport: 1_000,
      mattermost: 720,
      deck: 280,
      overlap: 0,
    });

    await page.setViewportSize({ width: 1_200, height: 900 });
    await expect.poll(() => getLayoutWidths(page), { timeout: 10_000 }).toEqual({
      viewport: 1_200,
      mattermost: 720,
      deck: 480,
      overlap: 0,
    });

    await page.setViewportSize({ width: 1_800, height: 900 });
    await expect.poll(() => getLayoutWidths(page), { timeout: 10_000 }).toEqual({
      viewport: 1_800,
      mattermost: 900,
      deck: 900,
      overlap: 0,
    });

    const storedRailWidth = await sw.evaluate(async (railKey) => {
      const stored = await chrome.storage.local.get(railKey);
      return stored[railKey];
    }, RAIL_WIDTH_STORAGE_KEY);
    expect(storedRailWidth).toBe(900);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test("applies preferred width changes until the user creates a manual override", async () => {
  const extensionPath = path.resolve("./dist");
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mattermost-deck-preferred-width-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1_800, height: 900 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const state = await readState();
    const [existingSw] = context.serviceWorkers();
    const sw = existingSw ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    await sw.evaluate(({ serverUrl, preferredKey, drawerKey, railKey }) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.remove(railKey, () => {
          chrome.storage.local.set({
            "mattermostDeck.serverUrl.v1": serverUrl,
            [preferredKey]: "840",
            [drawerKey]: 1,
          }, () => resolve());
        });
      });
    }, {
      serverUrl: baseUrl,
      preferredKey: PREFERRED_RAIL_WIDTH_STORAGE_KEY,
      drawerKey: DRAWER_OPEN_STORAGE_KEY,
      railKey: RAIL_WIDTH_STORAGE_KEY,
    });

    const page = await context.newPage();
    await login(page, state.memberUser.username, state.memberUser.password);
    await expect(page.locator("#mattermost-deck-root")).toBeAttached({ timeout: 20_000 });
    await expect.poll(() => getLayoutWidths(page), { timeout: 20_000 }).toEqual({
      viewport: 1_800,
      mattermost: 960,
      deck: 840,
      overlap: 0,
    });

    await sw.evaluate((preferredKey) => new Promise<void>((resolve) => {
      chrome.storage.local.set({ [preferredKey]: "640" }, () => resolve());
    }), PREFERRED_RAIL_WIDTH_STORAGE_KEY);
    await expect.poll(() => getLayoutWidths(page), { timeout: 20_000 }).toEqual({
      viewport: 1_800,
      mattermost: 1_160,
      deck: 640,
      overlap: 0,
    });

    const storedRailWidth = await sw.evaluate(async (railKey) => {
      const stored = await chrome.storage.local.get(railKey);
      return stored[railKey];
    }, RAIL_WIDTH_STORAGE_KEY);
    expect(storedRailWidth).toBeUndefined();

    const deckBox = await page.locator("#mattermost-deck-root").boundingBox();
    expect(deckBox).not.toBeNull();
    await page.mouse.move((deckBox?.x ?? 0) + 7, 450);
    await page.mouse.down();
    await page.mouse.move(1_060, 450, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => getLayoutWidths(page), { timeout: 10_000 }).toEqual({
      viewport: 1_800,
      mattermost: 1_060,
      deck: 740,
      overlap: 0,
    });
    await expect.poll(async () => await sw.evaluate(async (railKey) => {
      const stored = await chrome.storage.local.get(railKey);
      return stored[railKey];
    }, RAIL_WIDTH_STORAGE_KEY), { timeout: 10_000 }).toBe(740);

    await sw.evaluate((preferredKey) => new Promise<void>((resolve) => {
      chrome.storage.local.set({ [preferredKey]: "560" }, () => resolve());
    }), PREFERRED_RAIL_WIDTH_STORAGE_KEY);
    await expect.poll(() => getLayoutWidths(page), { timeout: 10_000 }).toEqual({
      viewport: 1_800,
      mattermost: 1_060,
      deck: 740,
      overlap: 0,
    });
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
