export type DeckColumnType = "mentions" | "channelWatch";

export interface DeckColumn {
  id: string;
  type: DeckColumnType;
  teamId?: string;
  channelId?: string;
}

export const STORAGE_KEY = "mattermostDeck.layout.v1";

export function createDefaultLayout(): DeckColumn[] {
  return [
    { id: "mentions", type: "mentions" },
    { id: "channel-watch", type: "channelWatch" },
  ];
}

export function createColumn(
  type: DeckColumnType,
  defaults: Partial<Pick<DeckColumn, "teamId" | "channelId">> = {},
): DeckColumn {
  return {
    id: `${type}-${crypto.randomUUID()}`,
    type,
    ...defaults,
  };
}

export function getColumnTitle(type: DeckColumnType): string {
  switch (type) {
    case "mentions":
      return "Mentions";
    case "channelWatch":
      return "Channel Watch";
  }
}
