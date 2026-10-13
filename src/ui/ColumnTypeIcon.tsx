import React from "react";
import type { DeckColumnType } from "./layout";

export function ColumnTypeIcon({ type }: { type: DeckColumnType }): React.JSX.Element {
  switch (type) {
    case "mentions":
      return (
        <span className="deck-type-glyph" aria-hidden="true">
          @
        </span>
      );
    case "channelWatch":
      return (
        <svg className="deck-type-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5.1 2.5L3.9 13.5" />
          <path d="M10.5 2.5L9.3 13.5" />
          <path d="M2.3 6.1H12.9" />
          <path d="M1.7 9.9H12.3" />
        </svg>
      );
    case "dmWatch":
      return (
        <svg className="deck-type-icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="6" cy="5.2" r="2.1" />
          <path d="M2.9 11.9C3.4 9.9 5 8.8 6 8.8s2.6 1.1 3.1 3.1" />
          <circle cx="11.2" cy="6.3" r="1.5" />
          <path d="M9.5 11.4C9.8 10.2 10.8 9.4 11.5 9.4c.7 0 1.7.8 2 2" />
        </svg>
      );
    case "keywordWatch":
    case "search":
      return (
        <svg className="deck-type-icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.2" />
          <path d="M10.2 10.2L13.4 13.4" />
        </svg>
      );
    case "favorites":
      return <svg className="deck-type-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m8 1.5 2 4.2 4.5.6-3.2 3.2.8 4.5L8 11.9 3.9 14l.8-4.5L1.5 6.3l4.5-.6Z" /></svg>;
    case "saved":
      return (
        <svg className="deck-type-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 2.7h8a1 1 0 0 1 1 1v9.6l-5-2.6-5 2.6V3.7a1 1 0 0 1 1-1Z" />
        </svg>
      );
    case "diagnostics":
      return (
        <svg className="deck-type-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.7 11.8h10.6" />
          <path d="M4.2 10.3V7.8" />
          <path d="M7.1 10.3V5.7" />
          <path d="M10 10.3V3.8" />
          <path d="M12.9 10.3V6.6" />
        </svg>
      );
  }
}
