import { afterEach, describe, expect, it, vi } from "vitest";
import { persistUiSetting, STORAGE_ERROR_EVENT } from "./storageFailure";

afterEach(() => vi.unstubAllGlobals());

describe("UI storage failure notifications", () => {
  it("does not notify when persistence succeeds", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    await expect(persistUiSetting(Promise.resolve("saved"))).resolves.toBeUndefined();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("consumes rejection and sends one notification without storage contents", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    await expect(persistUiSetting(Promise.reject(new Error("secret-value")))).resolves.toBeUndefined();
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent<{ message: string }>;
    expect(event.type).toBe(STORAGE_ERROR_EVENT);
    expect(event.detail).toEqual({ message: "Settings could not be saved. Please try again." });
    expect(JSON.stringify(event.detail)).not.toContain("secret-value");
  });

  it("still consumes storage failure if the page can no longer receive events", async () => {
    vi.stubGlobal("window", { dispatchEvent: vi.fn(() => { throw new Error("page closed"); }) });
    await expect(persistUiSetting(Promise.reject("failed"))).resolves.toBeUndefined();
  });
});
