import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const LAYOUT_KEY = "mattermostDeck.layout.v1";
const FAULT_KEY = "test.layoutStorageFailure.injected";
const WRITE_KEY = "test.layoutStorageFailure.layoutWrites";

test("a failed layout read cannot overwrite saved panes before a successful reload", async () => {
  const user = { id: "u".repeat(26), username: "layoutuser", notify_props: {} };
  const team = { id: "t".repeat(26), name: "testteam", display_name: "Test team" };
  const channel = { id: "c".repeat(26), team_id: team.id, name: "town-square", display_name: "Town Square", type: "O" };
  const savedLayout = [{ id: "saved-layout-sentinel", type: "favorites", customTitle: "Existing saved favorites" }];
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (!pathname.startsWith("/api/v4/")) {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><html><body class="app__body"><main id="root" class="app__content">Layout storage fixture</main></body></html>');
      return;
    }
    const route = pathname.slice("/api/v4".length);
    let value: unknown = [];
    if (route === "/users/me") value = user;
    else if (route === "/users/ids") value = [user];
    else if (route === "/users/me/teams") value = [team];
    else if (route.startsWith("/config/client")) value = { CollapsedThreads: "disabled" };
    else if (route === "/system/ping") value = { status: "OK" };
    else if (route.endsWith("/channels/members")) value = [{ user_id: user.id, channel_id: channel.id, last_viewed_at: 0 }];
    else if (route.endsWith("/channels")) value = [channel];
    else if (route.includes("/channels/name/") || route === `/channels/${channel.id}`) value = channel;
    else if (route.includes("/teams/name/")) value = team;
    else if (route.includes("/threads")) value = { total: 0, threads: [] };
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(value));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deck-layout-storage-failure-"));
  const extension = path.join(directory, "extension");
  let context: BrowserContext | undefined;
  try {
    await fs.cp(path.resolve("dist"), extension, { recursive: true });
    const manifestPath = path.join(extension, "manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    // Run in the same isolated extension world before production content.js.
    // The marker survives navigation, so only the first layout read fails.
    manifest.content_scripts.unshift({ matches: ["http://127.0.0.1/*"], js: ["layout-read-fault.js"], run_at: "document_start" });
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await fs.writeFile(path.join(extension, "layout-read-fault.js"), `
      (() => {
        const layoutKey = ${JSON.stringify(LAYOUT_KEY)}, faultKey = ${JSON.stringify(FAULT_KEY)}, writeKey = ${JSON.stringify(WRITE_KEY)};
        const get = chrome.storage.local.get.bind(chrome.storage.local);
        const set = chrome.storage.local.set.bind(chrome.storage.local);
        chrome.storage.local.get = async (keys) => {
          if (keys === layoutKey || (Array.isArray(keys) && keys.includes(layoutKey))) {
            if (!(await get(faultKey))[faultKey]) {
              await set({ [faultKey]: true });
              throw new Error('Injected one-time layout read failure');
            }
          }
          return await get(keys);
        };
        chrome.storage.local.set = async (values) => {
          if (Object.prototype.hasOwnProperty.call(values, layoutKey)) {
            const count = (await get(writeKey))[writeKey] || 0;
            await set({ [writeKey]: count + 1 });
          }
          return await set(values);
        };
      })();
    `);
    context = await chromium.launchPersistentContext(path.join(directory, "profile"), {
      channel: "chromium", headless: true, viewport: { width: 1600, height: 1000 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await worker.evaluate(({ origin, layoutKey, savedLayout }) => chrome.storage.local.set({
      "mattermostDeck.serverUrl.v1": origin, "mattermostDeck.language.v1": "en", "mattermostDeck.theme.v1": "light",
      [layoutKey]: savedLayout,
    }), { origin, layoutKey: LAYOUT_KEY, savedLayout });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/testteam/channels/town-square`);
    const inspect = (action: "state" | "add" | "reload" = "state") => worker.evaluate(async ({ origin, action }) => {
      const tab = (await chrome.tabs.query({})).find(value => value.url?.startsWith(origin));
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, args: [action], func: action => {
        const host = document.getElementById("mattermost-deck-root");
        const root = host && (chrome as any).dom.openOrClosedShadowRoot(host) as ShadowRoot | null;
        if (action === "add") {
          const opener = root?.querySelector<HTMLButtonElement>('button[aria-controls="mattermost-deck-add-menu"]');
          if (!opener || opener.disabled) return { attempted: false };
          opener.click();
          return { attempted: true };
        }
        if (action === "reload") {
          const button = Array.from(root?.querySelectorAll<HTMLButtonElement>('[role="alert"] button') ?? []).find(value => value.textContent === "Reload");
          button?.click(); return { reloaded: Boolean(button) };
        }
        const add = Array.from(root?.querySelectorAll<HTMLButtonElement>("#mattermost-deck-add-menu button") ?? []).find(value => value.textContent?.trim() === "Favorites");
        const alerts = Array.from(root?.querySelectorAll('[role="alert"]') ?? []).map(value => value.textContent).join(" ");
        const paneIds = Array.from(root?.querySelectorAll<HTMLElement>("[data-pane-id]") ?? []).map(value => value.dataset.paneId);
        return { alerts, paneIds, addReady: Boolean(add) };
      } });
      return result.result;
    }, { origin, action });
    await expect.poll(async () => (await inspect())?.alerts).toContain("Settings could not be loaded or saved");
    await expect.poll(async () => (await inspect("add"))?.attempted).toBe(true);
    await expect.poll(async () => (await inspect())?.addReady).toBe(true);
    const attempted = await worker.evaluate(async origin => {
      const tab = (await chrome.tabs.query({})).find(value => value.url?.startsWith(origin));
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab!.id! }, func: () => {
        const host = document.getElementById("mattermost-deck-root");
        const root = host && (chrome as any).dom.openOrClosedShadowRoot(host) as ShadowRoot | null;
        const add = Array.from(root?.querySelectorAll<HTMLButtonElement>("#mattermost-deck-add-menu button") ?? []).find(value => value.textContent?.trim() === "Favorites");
        add?.click(); return Boolean(add);
      } }); return result.result;
    }, origin);
    expect(attempted).toBe(true);
    const stored = await worker.evaluate(async ({ layoutKey, faultKey, writeKey }) => chrome.storage.local.get([layoutKey, faultKey, writeKey]), { layoutKey: LAYOUT_KEY, faultKey: FAULT_KEY, writeKey: WRITE_KEY });
    expect(stored[FAULT_KEY]).toBe(true);
    expect(stored[LAYOUT_KEY]).toEqual(savedLayout);
    expect(stored[WRITE_KEY] ?? 0).toBe(0);
    expect((await inspect())?.paneIds).toEqual([]);
    const reloaded = page.waitForEvent("load");
    expect((await inspect("reload"))?.reloaded).toBe(true);
    await reloaded;
    await expect.poll(async () => (await inspect())?.paneIds, { timeout: 20_000 }).toEqual(["saved-layout-sentinel"]);
    expect((await inspect())?.alerts).toBe("");
    expect((await worker.evaluate(async key => (await chrome.storage.local.get(key))[key], LAYOUT_KEY))).toEqual(savedLayout);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (path.resolve(directory).startsWith(path.join(os.tmpdir(), "deck-layout-storage-failure-"))) await fs.rm(directory, { recursive: true, force: true });
  }
});
