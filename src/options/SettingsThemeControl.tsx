import React, { useEffect, useLayoutEffect, useState } from "react";

export const OPTIONS_THEME_KEY = "mattermostDeck.optionsTheme.v1";
type Theme = "light" | "dark" | "system";
const normalize = (value: unknown): Theme => value === "light" || value === "dark" ? value : "system";

/** Settings chrome has its own preference; the Deck theme remains a draft setting. */
export function SettingsThemeControl({ language }: { language: string }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const ja = language === "ja";
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      document.body.dataset.theme = theme === "system" ? (media.matches ? "light" : "dark") : theme;
      document.documentElement.style.colorScheme = document.body.dataset.theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[OPTIONS_THEME_KEY]) {
        revision++;
        setTheme(normalize(changes[OPTIONS_THEME_KEY].newValue));
        setReady(true); setError(false);
      }
    };
    chrome.storage.onChanged.addListener(changed);
    const readRevision = revision;
    void chrome.storage.local.get(OPTIONS_THEME_KEY).then(values => {
      if (active && revision === readRevision) { setTheme(normalize(values[OPTIONS_THEME_KEY])); setReady(true); }
    }).catch(() => { if (active) { setReady(true); setError(true); } });
    return () => { active = false; chrome.storage.onChanged.removeListener(changed); };
  }, []);
  return <div className="options-theme-control" data-testid="settings-theme-control">
    <span id="settings-theme-label">{ja ? "設定画面のテーマ" : "Settings theme"}</span>
    <div className="options-theme-buttons" role="group" aria-labelledby="settings-theme-label">
      {(["light", "dark", "system"] as const).map(value => {
        const label = value === "light" ? (ja ? "ライト" : "Light") : value === "dark" ? (ja ? "ダーク" : "Dark") : (ja ? "システムに合わせる" : "System");
        return <button key={value} type="button" data-testid={`settings-theme-${value}`} title={label} aria-label={label}
          aria-pressed={theme === value} disabled={!ready || saving} onClick={async () => {
            if (theme === value) return;
            const previous = theme;
            setTheme(value); setSaving(true); setError(false);
            try { await chrome.storage.local.set({ [OPTIONS_THEME_KEY]: value }); }
            catch { setTheme(previous); setError(true); }
            finally { setSaving(false); }
          }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {value === "light" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4L19 5" /></>
              : value === "dark" ? <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />
                : <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M12 17v4m-4 0h8" /></>}
          </svg>
        </button>;
      })}
    </div>
    {error && <span className="options-theme-error" role="alert">{ja ? "テーマを読み込み・保存できませんでした。もう一度選択してください。" : "Theme could not be loaded or saved. Select it again to retry."}</span>}
  </div>;
}
