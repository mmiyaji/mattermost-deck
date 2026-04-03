import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  DEFAULT_SETTINGS,
  loadDeckSettings,
  resolveTheme,
  saveDeckSettings,
  type DeckLanguage,
  type DeckSettings,
  type DeckTheme,
} from "../ui/settings";

type OptionsText = {
  title: string;
  subtitle: string;
  realtimeTitle: string;
  realtimeBody: string;
  patLabel: string;
  patPlaceholder: string;
  show: string;
  hide: string;
  appearanceTitle: string;
  themeLabel: string;
  languageLabel: string;
  themeSystem: string;
  themeMattermost: string;
  themeDark: string;
  themeLight: string;
  languageJa: string;
  languageEn: string;
  save: string;
  saving: string;
  saved: string;
  securityTitle: string;
  securityBody: string;
  securityBody2: string;
};

const TEXT: Record<DeckLanguage, OptionsText> = {
  ja: {
    title: "Mattermost Deck Settings",
    subtitle: "右側デッキの接続設定と表示設定を管理します。",
    realtimeTitle: "Realtime",
    realtimeBody: "サーバーURLは現在の Mattermost ページから自動判定します。PAT を保存したときだけ WebSocket を使います。",
    patLabel: "Mattermost PAT",
    patPlaceholder: "Personal Access Token を貼り付け",
    show: "表示",
    hide: "非表示",
    appearanceTitle: "Appearance",
    themeLabel: "Theme",
    languageLabel: "Language",
    themeSystem: "System",
    themeMattermost: "Mattermost",
    themeDark: "Dark",
    themeLight: "Light",
    languageJa: "日本語",
    languageEn: "English",
    save: "保存",
    saving: "保存中...",
    saved: "保存しました",
    securityTitle: "Security",
    securityBody: "PAT はこのブラウザの拡張ストレージにローカル保存されます。現在は暗号化していません。",
    securityBody2: "高権限トークンは避け、可能なら専用の低権限トークンを使ってください。",
  },
  en: {
    title: "Mattermost Deck Settings",
    subtitle: "Manage realtime access and appearance for the right-side deck.",
    realtimeTitle: "Realtime",
    realtimeBody: "The server URL is inferred from the current Mattermost page. WebSocket is enabled only when a PAT is saved.",
    patLabel: "Mattermost PAT",
    patPlaceholder: "Paste a personal access token",
    show: "Show",
    hide: "Hide",
    appearanceTitle: "Appearance",
    themeLabel: "Theme",
    languageLabel: "Language",
    themeSystem: "System",
    themeMattermost: "Mattermost",
    themeDark: "Dark",
    themeLight: "Light",
    languageJa: "Japanese",
    languageEn: "English",
    save: "Save",
    saving: "Saving...",
    saved: "Saved",
    securityTitle: "Security",
    securityBody: "The PAT is stored locally in this browser's extension storage. It is not encrypted in the current implementation.",
    securityBody2: "Avoid high-privilege tokens. Prefer a dedicated lower-privilege token when possible.",
  },
};

const pageCss = `
  :root {
    color-scheme: dark;
    font-family: "Segoe UI", sans-serif;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-height: 100vh;
    background: linear-gradient(180deg, #0f1824, #0b121d);
    color: #e5eefb;
  }

  body[data-theme="light"] {
    background: linear-gradient(180deg, #eef4fb, #dde8f5);
    color: #16263b;
  }

  .options-shell {
    max-width: 900px;
    margin: 0 auto;
    padding: 40px 24px 56px;
  }

  .options-header h1,
  .options-header p,
  .options-section h2,
  .options-section p {
    margin: 0;
  }

  .options-header p {
    margin-top: 8px;
    color: #8facd5;
  }

  body[data-theme="light"] .options-header p,
  body[data-theme="light"] .options-section p,
  body[data-theme="light"] .options-label {
    color: #496583;
  }

  .options-stack {
    display: flex;
    flex-direction: column;
    gap: 18px;
    margin-top: 28px;
  }

  .options-section {
    padding: 20px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(123, 178, 255, 0.16);
  }

  body[data-theme="light"] .options-section {
    background: rgba(255, 255, 255, 0.7);
    border-color: rgba(84, 120, 168, 0.14);
  }

  .options-section p {
    margin-top: 6px;
    color: #8facd5;
    line-height: 1.5;
  }

  .options-grid {
    display: grid;
    grid-template-columns: 1fr 220px 220px;
    gap: 14px;
    margin-top: 18px;
  }

  .options-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .options-label {
    font-size: 13px;
    color: #a7c0e4;
  }

  .options-input,
  .options-select,
  .options-button {
    min-height: 42px;
    border-radius: 14px;
    border: 1px solid rgba(123, 178, 255, 0.18);
    padding: 0 14px;
    font: inherit;
  }

  .options-input,
  .options-select {
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
  }

  body[data-theme="light"] .options-input,
  body[data-theme="light"] .options-select {
    background: rgba(255, 255, 255, 0.88);
  }

  .options-inline {
    display: flex;
    gap: 10px;
  }

  .options-button {
    background: linear-gradient(180deg, #1f9dff, #0f71d7);
    color: #fff;
    cursor: pointer;
    border: 0;
    padding: 0 16px;
  }

  .options-button--ghost {
    background: rgba(123, 178, 255, 0.12);
    color: inherit;
    border: 1px solid rgba(123, 178, 255, 0.18);
  }

  .options-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 24px;
  }

  .options-status {
    font-size: 13px;
    color: #8facd5;
  }

  @media (max-width: 820px) {
    .options-grid {
      grid-template-columns: 1fr;
    }

    .options-footer {
      flex-direction: column;
      align-items: stretch;
    }
  }
`;

function OptionsApp(): React.JSX.Element {
  const [settings, setSettings] = useState<DeckSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [showPat, setShowPat] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = pageCss;
    document.head.append(style);
    return () => {
      style.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const next = await loadDeckSettings();
      if (!cancelled) {
        setSettings(next);
        setLoaded(true);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.body.dataset.theme = resolveTheme(settings.theme);
    document.documentElement.lang = settings.language;
  }, [settings.language, settings.theme]);

  const text = useMemo(() => TEXT[settings.language], [settings.language]);

  const handleThemeChange = (theme: DeckTheme) => {
    setSettings((current) => ({
      ...current,
      theme,
    }));
  };

  const handleLanguageChange = (language: DeckLanguage) => {
    setSettings((current) => ({
      ...current,
      language,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSavedNotice(false);
    try {
      await saveDeckSettings(settings);
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="options-shell">
      <header className="options-header">
        <h1>{text.title}</h1>
        <p>{text.subtitle}</p>
      </header>

      <div className="options-stack">
        <section className="options-section">
          <h2>{text.realtimeTitle}</h2>
          <p>{text.realtimeBody}</p>
          <div className="options-grid">
            <label className="options-field" style={{ gridColumn: "1 / -1" }}>
              <span className="options-label">{text.patLabel}</span>
              <div className="options-inline">
                <input
                  className="options-input"
                  type={showPat ? "text" : "password"}
                  placeholder={text.patPlaceholder}
                  value={settings.wsPat}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      wsPat: event.target.value,
                    }))
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="button" className="options-button options-button--ghost" onClick={() => setShowPat((current) => !current)}>
                  {showPat ? text.hide : text.show}
                </button>
              </div>
            </label>
          </div>
        </section>

        <section className="options-section">
          <h2>{text.appearanceTitle}</h2>
          <div className="options-grid">
            <label className="options-field">
              <span className="options-label">{text.themeLabel}</span>
              <select className="options-select" value={settings.theme} onChange={(event) => handleThemeChange(event.target.value as DeckTheme)}>
                <option value="system">{text.themeSystem}</option>
                <option value="mattermost">{text.themeMattermost}</option>
                <option value="dark">{text.themeDark}</option>
                <option value="light">{text.themeLight}</option>
              </select>
            </label>
            <label className="options-field">
              <span className="options-label">{text.languageLabel}</span>
              <select className="options-select" value={settings.language} onChange={(event) => handleLanguageChange(event.target.value as DeckLanguage)}>
                <option value="ja">{text.languageJa}</option>
                <option value="en">{text.languageEn}</option>
              </select>
            </label>
          </div>
        </section>

        <section className="options-section">
          <h2>{text.securityTitle}</h2>
          <p>{text.securityBody}</p>
          <p>{text.securityBody2}</p>
        </section>
      </div>

      <footer className="options-footer">
        <div className="options-status">
          {loaded ? (savedNotice ? text.saved : "") : text.saving}
        </div>
        <button type="button" className="options-button" onClick={handleSave} disabled={!loaded || saving}>
          {saving ? text.saving : text.save}
        </button>
      </footer>
    </div>
  );
}

const root = document.getElementById("options-root");
if (!(root instanceof HTMLDivElement)) {
  throw new Error("Missing options root.");
}

createRoot(root).render(<OptionsApp />);
