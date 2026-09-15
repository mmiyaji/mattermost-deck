import type { DeckColumn } from "./layout";

export function movePaneRelative(columns: DeckColumn[], source: string, target: string, after: boolean): DeckColumn[] {
  const moving = columns.find(column => column.id === source);
  if (!moving || source === target || !columns.some(column => column.id === target)) return columns;
  const next = columns.filter(column => column.id !== source);
  next.splice(next.findIndex(column => column.id === target) + Number(after), 0, moving);
  return next.every((column, index) => column === columns[index]) ? columns : next;
}
