import React from "react";

export function ChevronIcon({ expanded }: { expanded: boolean }): React.JSX.Element {
  return (
    <svg
      className={`deck-chevron${expanded ? " deck-chevron--expanded" : ""}`}
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path d="M4 2.5L7.5 6L4 9.5" />
    </svg>
  );
}

export function CloseIcon(): React.JSX.Element {
  return (
    <svg className="deck-close-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 3L9 9" />
      <path d="M9 3L3 9" />
    </svg>
  );
}

export function ArrowIcon({ direction }: { direction: "left" | "right" }): React.JSX.Element {
  return (
    <svg className={`deck-arrow-icon deck-arrow-icon--${direction}`} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4 2.5L7.5 6L4 9.5" />
    </svg>
  );
}

export function FocusIcon({ active }: { active: boolean }): React.JSX.Element {
  return active ? (
    <svg className="deck-focus-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1.8 4V1.8H4" />
      <path d="M8 1.8h2.2V4" />
      <path d="M10.2 8V10.2H8" />
      <path d="M4 10.2H1.8V8" />
      <path d="M4.2 4.2L7.8 7.8" />
      <path d="M7.8 4.2L4.2 7.8" />
    </svg>
  ) : (
    <svg className="deck-focus-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4.5 1.8H1.8V4.5" />
      <path d="M7.5 1.8h2.7V4.5" />
      <path d="M10.2 7.5v2.7H7.5" />
      <path d="M4.5 10.2H1.8V7.5" />
    </svg>
  );
}

export function DrawerToggleIcon({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg className={`deck-drawer-icon${open ? " deck-drawer-icon--open" : ""}`} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4 2.5L7.5 6L4 9.5" />
    </svg>
  );
}

export function SettingsIcon(): React.JSX.Element {
  return (
    <svg className="deck-settings-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.9 1.6h2.2l.4 1.6c.4.1.8.3 1.2.5l1.5-.8 1.5 1.5-.8 1.5c.2.4.4.8.5 1.2l1.6.4v2.2l-1.6.4c-.1.4-.3.8-.5 1.2l.8 1.5-1.5 1.5-1.5-.8c-.4.2-.8.4-1.2.5l-.4 1.6H6.9l-.4-1.6c-.4-.1-.8-.3-1.2-.5l-1.5.8-1.5-1.5.8-1.5c-.2-.4-.4-.8-.5-1.2L.9 9.1V6.9l1.6-.4c.1-.4.3-.8.5-1.2l-.8-1.5 1.5-1.5 1.5.8c.4-.2.8-.4 1.2-.5l.4-1.6Z" />
      <circle cx="8" cy="8" r="2.3" />
    </svg>
  );
}

export function StatusModeIcon({ realtimeEnabled }: { realtimeEnabled: boolean }): React.JSX.Element {
  return realtimeEnabled ? (
    <svg className="deck-status-mode-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1.8 5.6a6.2 6.2 0 0 1 8.4 0" />
      <path d="M3.5 7.4a3.8 3.8 0 0 1 5 0" />
      <path d="M5.1 9a1.8 1.8 0 0 1 1.8 0" />
      <circle cx="6" cy="10.1" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  ) : (
    <svg className="deck-status-mode-icon" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.2" />
      <path d="M6 3.5v2.8l1.8 1" />
    </svg>
  );
}

export function PlusIcon(): React.JSX.Element {
  return (
    <svg className="deck-plus-icon" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 2v8" />
      <path d="M2 6h8" />
    </svg>
  );
}

export function ViewsIcon(): React.JSX.Element {
  return (
    <svg className="deck-views-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.2" y="2.2" width="4.2" height="4.2" rx="1" />
      <rect x="9.6" y="2.2" width="4.2" height="4.2" rx="1" />
      <rect x="2.2" y="9.6" width="4.2" height="4.2" rx="1" />
      <rect x="9.6" y="9.6" width="4.2" height="4.2" rx="1" />
    </svg>
  );
}

export function HamburgerIcon(): React.JSX.Element {
  return (
    <svg className="deck-hamburger-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4h10" />
      <path d="M3 8h10" />
      <path d="M3 12h10" />
    </svg>
  );
}

export function RefreshIcon({ spinning = false }: { spinning?: boolean }): React.JSX.Element {
  return (
    <svg className={`deck-refresh-icon${spinning ? " deck-refresh-icon--spinning" : ""}`} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M12.5 6.5A4.8 4.8 0 0 0 4.3 4.9" />
      <path d="M4.3 4.9V2.8" />
      <path d="M4.3 4.9H6.5" />
      <path d="M3.5 9.5a4.8 4.8 0 0 0 8.2 1.6" />
      <path d="M11.7 11.1v2.1" />
      <path d="M11.7 11.1H9.5" />
    </svg>
  );
}

export function PauseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor" stroke="none" />
      <rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PlayIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="5,3 13,8 5,13" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function JumpToLatestIcon({ reversed = false }: { reversed?: boolean }): React.JSX.Element {
  return (
    <svg className={`deck-jump-latest-icon${reversed ? " deck-jump-latest-icon--reversed" : ""}`} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.5v9" />
      <path d="M4.8 6.7 8 3.5l3.2 3.2" />
    </svg>
  );
}

export function SearchIcon(): React.JSX.Element {
  return (
    <svg className="deck-search-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  );
}
