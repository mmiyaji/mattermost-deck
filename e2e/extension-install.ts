import { expect, type BrowserContext, type Page, type Worker } from "@playwright/test";

/** onInstalled opens Options asynchronously; finish that navigation before tests navigate it. */
export async function waitForInstalledOptions(context: BrowserContext, worker: Worker): Promise<Page> {
  const url = `chrome-extension://${new URL(worker.url()).host}/options.html`;
  await expect.poll(() => context.pages().some(page => page.url() === url), { timeout: 15_000 }).toBe(true);
  const page = context.pages().find(page => page.url() === url)!;
  await page.waitForLoadState("load");
  await expect(page.locator("html")).toHaveAttribute("lang", /.+/);
  return page;
}
