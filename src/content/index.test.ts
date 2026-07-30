import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const contentMocks = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  disposeTraceLogRuntime: vi.fn(),
  loadDeckSettings: vi.fn(
    () => new Promise<Record<string, never>>(() => undefined),
  ),
}));

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(),
}));
vi.mock("../ui/App", () => ({
  App: () => null,
}));
vi.mock("../ui/settings", () => ({
  DEFAULT_SETTINGS: {},
  loadDeckSettings: contentMocks.loadDeckSettings,
  subscribeDeckSettings: vi.fn(() => contentMocks.unsubscribe),
}));
vi.mock("../ui/styles", () => ({
  railCssText: "",
}));
vi.mock("../traceLog", () => ({
  addTraceEntry: vi.fn(),
  disposeTraceLogRuntime:
    contentMocks.disposeTraceLogRuntime,
}));
vi.mock("../mattermost/api", () => ({
  configureMattermostBaseUrl: vi.fn(),
}));

type RuntimeHost = typeof globalThis & {
  __mattermostDeckContentRuntimeV1?: {
    dispose: () => void;
  };
};

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = [];
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(_callback: MutationCallback) {
    FakeMutationObserver.instances.push(this);
  }
}

describe("content runtime lifecycle", () => {
  let originalPushState: History["pushState"];
  let originalReplaceState: History["replaceState"];
  let fakeWindow: Window;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    FakeMutationObserver.instances = [];
    delete (globalThis as RuntimeHost).__mattermostDeckContentRuntimeV1;

    originalPushState = vi.fn() as unknown as History["pushState"];
    originalReplaceState = vi.fn() as unknown as History["replaceState"];
    const history = {
      pushState: originalPushState,
      replaceState: originalReplaceState,
    } as History;
    const classList = { add: vi.fn(), remove: vi.fn() };
    const body = { classList } as unknown as HTMLBodyElement;
    const documentElement = { append: vi.fn() };
    const fakeDocument = {
      readyState: "complete",
      body,
      documentElement,
      cookie: "",
      getElementById: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      querySelectorAll: vi.fn(() => []),
    } as unknown as Document;
    fakeWindow = {
      location: {
        origin: "https://mattermost.example.test",
        pathname: "/team/channels/town-square",
        hash: "",
      },
      history,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval: vi.fn(() => 41),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => 42),
      clearTimeout: vi.fn(),
      requestAnimationFrame: vi.fn(() => 43),
      cancelAnimationFrame: vi.fn(),
    } as unknown as Window;

    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    vi.stubGlobal("__MATTERMOST_DECK_E2E_DEBUG__", false);
    vi.stubGlobal("chrome", {
      runtime: {
        getManifest: () => ({ version: "1.0.4" }),
      },
    });
  });

  afterEach(() => {
    (globalThis as RuntimeHost).__mattermostDeckContentRuntimeV1?.dispose();
    delete (globalThis as RuntimeHost).__mattermostDeckContentRuntimeV1;
    vi.unstubAllGlobals();
  });

  it("disposes listeners, observers, timers, and history wrappers before reinjection", async () => {
    await import("./index.js");
    const firstPatchedPushState = fakeWindow.history.pushState;
    const firstObserver = FakeMutationObserver.instances[0];

    expect(firstPatchedPushState).not.toBe(originalPushState);
    expect(firstObserver?.observe).toHaveBeenCalled();
    expect(fakeWindow.setInterval).toHaveBeenCalledTimes(1);

    vi.resetModules();
    await import("./index.js");

    expect(contentMocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(
      contentMocks.disposeTraceLogRuntime,
    ).toHaveBeenCalledTimes(1);
    expect(firstObserver?.disconnect).toHaveBeenCalledTimes(1);
    expect(fakeWindow.clearInterval).toHaveBeenCalledWith(41);
    expect(fakeWindow.removeEventListener).toHaveBeenCalledWith(
      "popstate",
      expect.any(Function),
    );
    expect(fakeWindow.removeEventListener).toHaveBeenCalledWith(
      "hashchange",
      expect.any(Function),
    );

    const secondObserver = FakeMutationObserver.instances[1];
    (globalThis as RuntimeHost).__mattermostDeckContentRuntimeV1?.dispose();

    expect(secondObserver?.disconnect).toHaveBeenCalledTimes(1);
    expect(fakeWindow.history.pushState).toBe(originalPushState);
    expect(fakeWindow.history.replaceState).toBe(originalReplaceState);
    expect(
      (globalThis as RuntimeHost).__mattermostDeckContentRuntimeV1,
    ).toBeUndefined();
  });

  it("matches a terminal Threads route by route-kind position", async () => {
    const content = await import("./index.js");

    expect(
      content.routeMatchesAllowedKinds(
        "/test-team/threads",
        ["channels", "threads"],
      ),
    ).toBe(true);
    expect(
      content.routeMatchesAllowedKinds(
        "/test-team/threads/all",
        ["channels", "threads"],
      ),
    ).toBe(true);
    expect(
      content.routeMatchesAllowedKinds(
        "/test-team/channels/threads",
        ["threads"],
      ),
    ).toBe(false);
    expect(
      content.routeMatchesAllowedKinds(
        "/test-team/channels/threads",
        ["channels"],
      ),
    ).toBe(true);
    expect(
      content.routeMatchesAllowedKinds(
        "/#/test-team/threads",
        ["threads"],
      ),
    ).toBe(true);
    expect(
      content.routeMatchesAllowedKinds(
        "/#/test-team/channels/town-square",
        ["channels"],
      ),
    ).toBe(true);
    expect(
      content.routeMatchesAllowedKinds(
        "/#/test-team/channels/threads",
        ["threads"],
      ),
    ).toBe(false);
  });
});
