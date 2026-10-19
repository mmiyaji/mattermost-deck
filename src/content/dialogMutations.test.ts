import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DialogMutationTracker } from "./dialogMutations";

class FakeElement {
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  role = "";
  ariaModal = "";
  ariaHidden = "";
  hidden = false;
  style = "";

  constructor(public className = "") {}

  get childElementCount(): number { return this.children.length; }

  get isConnected(): boolean {
    let current: FakeElement | null = this;
    while (current?.parentElement) current = current.parentElement;
    return Boolean(current?.isBody);
  }

  private get isBody(): boolean { return this.className === "fixture-body"; }

  append(child: FakeElement): void {
    child.parentElement = this;
    this.children.push(child);
  }

  matches(selector: string): boolean {
    return (selector.includes("[role='dialog']") && this.role === "dialog") ||
      (selector.includes(".modal-dialog") && this.className.split(/\s+/).includes("modal-dialog")) ||
      (selector.includes(".Modal_dialog") && this.className.split(/\s+/).includes("Modal_dialog")) ||
      (selector.includes(".modal") && this.className.split(/\s+/).includes("modal"));
  }

  querySelectorAll<T extends HTMLElement>(selector: string): T[] {
    const matches: FakeElement[] = [];
    const visit = (node: FakeElement) => {
      for (const child of node.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches as unknown as T[];
  }

  contains(candidate: FakeElement): boolean {
    return this.children.some(child => child === candidate || child.contains(candidate));
  }
}

function mutation(
  type: "attributes" | "childList",
  target: FakeElement,
  attributeName?: string,
  addedNodes: FakeElement[] = [],
  removedNodes: FakeElement[] = [],
): MutationRecord {
  return { type, target, attributeName, addedNodes, removedNodes } as unknown as MutationRecord;
}

beforeEach(() => vi.stubGlobal("HTMLElement", FakeElement));
afterEach(() => vi.unstubAllGlobals());

it("ignores ordinary row churn and detects inserted dialogs under wrappers", () => {
  const body = new FakeElement("fixture-body");
  const tracker = new DialogMutationTracker(body as unknown as HTMLElement);
  const post = new FakeElement("post-row");
  const scanPost = vi.spyOn(post, "querySelectorAll");
  body.append(post);
  expect(tracker.isRelevant([mutation("childList", body, undefined, [post])])).toBe(false);
  expect(scanPost).not.toHaveBeenCalled();
  expect(tracker.isRelevant([mutation("attributes", post, "class")])).toBe(false);

  const wrapper = new FakeElement("portal-wrapper");
  const dialog = new FakeElement("modal-dialog");
  wrapper.append(dialog);
  body.append(wrapper);
  expect(tracker.isRelevant([mutation("childList", body, undefined, [wrapper])])).toBe(true);
});

it("detects dialog removal, role/class upgrades, and wrapper visibility changes", () => {
  const body = new FakeElement("fixture-body");
  const wrapper = new FakeElement("portal-wrapper");
  const dialog = new FakeElement("modal-dialog");
  wrapper.append(dialog);
  body.append(wrapper);
  const tracker = new DialogMutationTracker(body as unknown as HTMLElement);

  expect(tracker.isRelevant([mutation("attributes", wrapper, "aria-hidden")])).toBe(true);
  expect(tracker.isRelevant([mutation("attributes", wrapper, "class")])).toBe(true);
  expect(tracker.isRelevant([mutation("attributes", body, "style")])).toBe(true);
  expect(tracker.isRelevant([mutation("attributes", dialog, "style")])).toBe(true);
  expect(tracker.isRelevant([mutation("childList", body, undefined, [], [wrapper])])).toBe(true);
  expect(tracker.isRelevant([mutation("attributes", wrapper, "style")])).toBe(false);

  const promoted = new FakeElement("ordinary");
  body.append(promoted);
  promoted.role = "dialog";
  expect(tracker.isRelevant([mutation("attributes", promoted, "role")])).toBe(true);
  const upgraded = new FakeElement("ordinary");
  body.append(upgraded);
  upgraded.className = "modal";
  expect(tracker.isRelevant([mutation("attributes", upgraded, "class")])).toBe(true);
});
