export const BLOCKING_DIALOG_SELECTOR = [
  "[role='dialog'][aria-modal='true']",
  "[role='dialog']",
  ".modal-dialog",
  ".Modal_dialog",
  ".modal",
].join(", ");

/** Tracks dialogs and their ancestors so unrelated DOM mutations can be ignored. */
export class DialogMutationTracker {
  private readonly candidates = new Set<HTMLElement>();
  private ancestors = new Set<HTMLElement>();

  constructor(private readonly body: HTMLElement) {
    this.collect(body);
    this.rebuildAncestors();
  }

  /** Returns true only when a dialog or one of its visibility ancestors changed. */
  isRelevant(records: readonly MutationRecord[]): boolean {
    let relevant = false;
    const addedRoots: HTMLElement[] = [];
    let childListChanged = false;

    for (const record of records) {
      if (record.type === "attributes") {
        const target = record.target;
        if (!(target instanceof HTMLElement)) continue;

        const knownDialog = this.candidates.has(target);
        const knownAncestor = this.ancestors.has(target);
        const canBecomeDialog = record.attributeName === "class" ||
          record.attributeName === "role" ||
          record.attributeName === "aria-modal";
        if (knownDialog || knownAncestor) {
          relevant = true;
          if (knownDialog && canBecomeDialog) this.rebuildAncestors();
        } else if (canBecomeDialog && this.matches(target)) {
          this.candidates.add(target);
          this.rebuildAncestors();
          relevant = true;
        }
        continue;
      }
      childListChanged = true;

      for (const node of record.removedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (this.containsTrackedDialog(node)) relevant = true;
        this.removeSubtree(node);
      }

      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement) addedRoots.push(node);
      }
    }

    // Batch and deduplicate added subtrees so nested records in one delivery
    // never cause the same newly inserted branch to be searched more than once.
    const addedSet = new Set(addedRoots);
    const seen = new Set<HTMLElement>();
    const roots = addedRoots.filter((node) => {
      if (seen.has(node)) return false;
      seen.add(node);
      let ancestor = node.parentElement;
      while (ancestor) {
        if (addedSet.has(ancestor)) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    });
    for (const root of roots) {
      if (this.collect(root)) relevant = true;
    }
    if (childListChanged) this.rebuildAncestors();
    return relevant;
  }

  private matches(element: HTMLElement): boolean {
    return element.matches(BLOCKING_DIALOG_SELECTOR);
  }

  private collect(root: HTMLElement): boolean {
    let found = false;
    if (this.matches(root)) {
      this.candidates.add(root);
      found = true;
    }
    if (root.childElementCount === 0) return found;
    for (const candidate of root.querySelectorAll<HTMLElement>(BLOCKING_DIALOG_SELECTOR)) {
      this.candidates.add(candidate);
      found = true;
    }
    return found;
  }

  private containsTrackedDialog(root: HTMLElement): boolean {
    if (this.candidates.has(root)) return true;
    for (const candidate of this.candidates) {
      if (root.contains(candidate)) return true;
    }
    return false;
  }

  private removeSubtree(root: HTMLElement): void {
    for (const candidate of this.candidates) {
      if (candidate === root || root.contains(candidate)) this.candidates.delete(candidate);
    }
  }

  private rebuildAncestors(): void {
    const next = new Set<HTMLElement>();
    for (const candidate of this.candidates) {
      if (!candidate.isConnected || !this.matches(candidate)) {
        this.candidates.delete(candidate);
        continue;
      }
      let ancestor = candidate.parentElement;
      while (ancestor) {
        next.add(ancestor);
        ancestor = ancestor.parentElement;
      }
    }
    this.ancestors = next;
  }
}
