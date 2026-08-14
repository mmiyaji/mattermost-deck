interface SelectionRangeLike {
  intersectsNode(node: Node): boolean;
}

interface TextSelectionLike {
  isCollapsed: boolean;
  rangeCount: number;
  toString(): string;
  getRangeAt(index: number): SelectionRangeLike;
}

export function hasSelectedTextWithin(selection: TextSelectionLike | null | undefined, target: Node): boolean {
  if (!selection || selection.isCollapsed || selection.toString().trim().length === 0) {
    return false;
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    try {
      if (selection.getRangeAt(index).intersectsNode(target)) {
        return true;
      }
    } catch {
      // Ignore stale or cross-tree ranges. They cannot represent a text drag
      // inside the current post card.
    }
  }

  return false;
}

export function shouldSuppressPostActivation(
  dragDetected: boolean,
  selection: TextSelectionLike | null | undefined,
  target: Node,
): boolean {
  return dragDetected || hasSelectedTextWithin(selection, target);
}
