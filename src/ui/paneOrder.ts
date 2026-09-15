import type { DeckColumn } from "./layout";

export function paneRow(column: DeckColumn, index: number, count: number): 0 | 1 {
  return column.row ?? (index < Math.ceil(count / 2) ? 0 : 1);
}
export function initialisePaneRows(columns: DeckColumn[]): DeckColumn[] {
  return columns.map((column, index) => column.row === undefined ? { ...column, row: paneRow(column, index, columns.length) } : column);
}
export function balancePaneRows(columns: DeckColumn[]): DeckColumn[] {
  return columns.map((column, index) => ({ ...column, row: index < Math.ceil(columns.length / 2) ? 0 : 1 }));
}
export function movePaneRelative(columns: DeckColumn[], source: string, target: string | null, after: boolean, row?: 0 | 1): DeckColumn[] {
  const moving = columns.find(column => column.id === source);
  if (!moving || source === target || (target !== null && !columns.some(column => column.id === target))) return columns;
  if (target === null && row === undefined) return columns;
  const base = row === undefined ? columns : initialisePaneRows(columns);
  const next = base.filter(column => column.id !== source);
  const item = row === undefined || moving.row === row ? moving : { ...moving, row };
  next.splice(target === null ? next.length : next.findIndex(column => column.id === target) + Number(after), 0, item);
  if (row !== undefined) next.sort((a, b) => a.row! - b.row!);
  return next.every((column, index) => column === columns[index]) ? columns : next;
}
