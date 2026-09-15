import React, { useEffect, useState } from "react";
import i18n from "./i18n";
import { loadStoredJson, saveStoredJson } from "./storage";

const STORAGE_KEY = "mattermostDeck.twoRowHintDismissed.v1";

/** A one-time shortcut; learning the layout or closing the hint retires it. */
export function TwoRowHint({ mode, onTry }: { mode: "row" | "twoRows"; onTry: () => void }): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadStoredJson(STORAGE_KEY, false).then(value => { if (!cancelled) setDismissed(value === true); });
    return () => { cancelled = true; };
  }, []);
  const dismiss = () => {
    setDismissed(true);
    // A cosmetic hint must not interrupt layout changes if storage is unavailable.
    void saveStoredJson(STORAGE_KEY, true).catch(() => {});
  };
  useEffect(() => { if (mode === "twoRows" && dismissed === false) dismiss(); }, [mode, dismissed]);
  if (dismissed !== false || mode === "twoRows") return null;
  return <aside className="deck-layout-tip" aria-label={i18n.t("deck.tryTwoRows")}>
    <span className="deck-layout-tip-preview" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="3" width="20" height="18" rx="3"/><path d="M2 12h20M11 3v9M15 12v9"/></svg></span>
    <span className="deck-layout-tip-copy"><strong>{i18n.t("deck.layoutTwoRows")}</strong><small>{i18n.t("deck.tryTwoRowsHelp")}</small></span>
    <button type="button" className="deck-layout-tip-try" title={i18n.t("deck.tryTwoRowsHelp")}
      onClick={() => { dismiss(); onTry(); }}>
      <span>{i18n.t("deck.tryTwoRows")}</span><span aria-hidden="true">→</span>
    </button>
    <button type="button" className="deck-layout-tip-dismiss" aria-label={i18n.t("deck.dismissTwoRowsHint")}
      title={i18n.t("deck.dismissTwoRowsHint")} onClick={dismiss}>×</button>
  </aside>;
}
