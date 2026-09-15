/** DOM reparenting may reset nested scrollers even when React state is retained. */
export function preservePaneScroll(root: HTMLElement): () => void {
  const positions = [...root.querySelectorAll<HTMLElement>(".deck-row-scroll, .deck-column-body, .deck-list-viewport, .deck-stack, .deck-favorites-unavailable")]
    .map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }));
  return () => positions.forEach(({element, top, left}) => {
    element.scrollTop = top;
    element.scrollLeft = left;
  });
}
