import { describe, expect, it } from "vitest";
import { hasSelectedTextWithin, shouldSuppressPostActivation } from "./postActivation";

const target = {} as Node;

function selection(options: {
  text?: string;
  collapsed?: boolean;
  intersections?: Array<boolean | Error>;
}) {
  const intersections = options.intersections ?? [];
  return {
    isCollapsed: options.collapsed ?? false,
    rangeCount: intersections.length,
    toString: () => options.text ?? "selected text",
    getRangeAt: (index: number) => ({
      intersectsNode: () => {
        const result = intersections[index];
        if (result instanceof Error) {
          throw result;
        }
        return Boolean(result);
      },
    }),
  };
}

describe("post card activation", () => {
  it("does not let a stale selection elsewhere disable post cards", () => {
    const staleSelection = selection({ intersections: [false] });

    expect(hasSelectedTextWithin(staleSelection, target)).toBe(false);
    expect(shouldSuppressPostActivation(false, staleSelection, target)).toBe(false);
  });

  it("suppresses activation for a text selection inside the clicked card", () => {
    const localSelection = selection({ intersections: [true] });

    expect(hasSelectedTextWithin(localSelection, target)).toBe(true);
    expect(shouldSuppressPostActivation(false, localSelection, target)).toBe(true);
  });

  it("suppresses pointer drags and ignores collapsed or stale ranges", () => {
    expect(shouldSuppressPostActivation(true, null, target)).toBe(true);
    expect(hasSelectedTextWithin(selection({ collapsed: true, intersections: [true] }), target)).toBe(false);
    expect(hasSelectedTextWithin(selection({ text: "   ", intersections: [true] }), target)).toBe(false);
    expect(hasSelectedTextWithin(selection({ intersections: [new Error("detached range")] }), target)).toBe(false);
  });
});
