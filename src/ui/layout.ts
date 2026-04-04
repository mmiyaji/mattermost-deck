export type DeckColumnType =
  | "mentions"
  | "channelWatch"
  | "dmWatch"
  | "keywordWatch"
  | "search"
  | "saved"
  | "diagnostics";

export interface DeckColumn {
  id: string;
  type: DeckColumnType;
  teamId?: string;
  channelId?: string;
  query?: string;
  unreadOnly?: boolean;
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
  defaults: Partial<Pick<DeckColumn, "teamId" | "channelId" | "query" | "unreadOnly">> = {},
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
    case "dmWatch":
      return "DM / Group";
    case "keywordWatch":
      return "Search";
    case "search":
      return "Search";
    case "saved":
      return "Saved";
    case "diagnostics":
      return "Diagnostics";
  }
}
