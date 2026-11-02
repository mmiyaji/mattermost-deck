import React from "react";
import { Virtuoso, type ListProps, type VirtuosoHandle } from "react-virtuoso";

// Keep these component identities stable: inline definitions remount the list.
const List = React.forwardRef<HTMLDivElement, ListProps>(function List(props, ref) {
  return <div {...props} ref={ref} role="list" />;
});
const components = { List };

interface Props<T extends { key: string }> {
  entries: T[];
  viewport: HTMLDivElement;
  compact: boolean;
  id?: string;
  reversed: boolean;
  renderEntry: (entry: T, index: number) => React.ReactNode;
}
type Anchor = Array<{ key: string; offset: number }> | null;

// Arbitrary confirmations can remove rows above the viewport. Preserve the
// visible post across that data change; Virtuoso owns all row measurement.
export class VirtualPostList<T extends { key: string }> extends React.Component<Props<T>> {
  private handle = React.createRef<VirtuosoHandle>();
  private frame = 0;
  private cancel = () => cancelAnimationFrame(this.frame);
  componentDidMount() {
    for (const event of ["wheel", "pointerdown", "keydown"]) this.props.viewport.addEventListener(event, this.cancel, { passive: true });
  }
  componentWillUnmount() {
    this.cancel();
    for (const event of ["wheel", "pointerdown", "keydown"]) this.props.viewport.removeEventListener(event, this.cancel);
  }
  getSnapshotBeforeUpdate(previous: Props<T>): Anchor {
    if (previous.entries === this.props.entries) return null;
    const { viewport, reversed } = previous;
    if ((!reversed && viewport.scrollTop < 24) || (reversed && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 24)) return null;
    const bounds = viewport.getBoundingClientRect();
    const rows = Array.from(viewport.querySelectorAll<HTMLElement>("[data-deck-entry-key]"));
    const visible = rows.filter(row => { const r = row.getBoundingClientRect(); return r.top >= bounds.top && r.bottom <= bounds.bottom; });
    const candidates = visible.length ? visible : rows.filter(row => { const r = row.getBoundingClientRect(); return r.bottom > bounds.top && r.top < bounds.bottom; });
    return candidates.map(row => ({ key: row.dataset.deckEntryKey!, offset: row.getBoundingClientRect().top - bounds.top }));
  }
  componentDidUpdate(previous: Props<T>, _state: unknown, anchors: Anchor) {
    if (previous.entries !== this.props.entries) this.cancel();
    const anchor = anchors?.find(a => this.props.entries.some(e => e.key === a.key));
    if (!anchor) return;
    this.frame = requestAnimationFrame(() => {
      const index = this.props.entries.findIndex(e => e.key === anchor.key);
      if (index < 0) return;
      this.handle.current?.scrollToIndex({ index, align: "start", offset: -anchor.offset, behavior: "auto" });
      // Variable-height rows settle after Virtuoso's ResizeObserver pass.
      let remaining = 4;
      const correct = () => {
        const { viewport } = this.props;
        const row = Array.from(viewport.querySelectorAll<HTMLElement>("[data-deck-entry-key]")).find(row => row.dataset.deckEntryKey === anchor.key);
        if (row) viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset;
        if (--remaining > 0) this.frame = requestAnimationFrame(correct);
      };
      this.frame = requestAnimationFrame(correct);
    });
  }
  render() {
    const { entries, viewport, compact, id, reversed, renderEntry } = this.props;
    return <Virtuoso
    ref={this.handle}
    id={id}
    className={`deck-virtual-list${compact ? " deck-virtual-list--compact" : ""}`}
    customScrollParent={viewport}
    data={entries}
    computeItemKey={(_index, entry) => entry.key}
    defaultItemHeight={compact ? 36 : 128}
    initialTopMostItemIndex={reversed ? { index: "LAST", align: "end" } : 0}
    increaseViewportBy={320}
    components={components}
    itemContent={(index, entry) => renderEntry(entry, index)}
  />;
  }
}
