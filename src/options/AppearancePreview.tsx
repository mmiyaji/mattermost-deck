import { ColumnTypeIcon } from "../ui/ColumnTypeIcon";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveTheme, type ColumnColorKey, type DeckSettings } from "../ui/settings";

export function WidthDiagram({ settings }: { settings: DeckSettings }) {
  const { t } = useTranslation();
  return <figure className="options-width-diagram">
    <div className="options-width-track" aria-hidden="true">
      <div className="options-width-deck" style={{ width: `${settings.preferredRailWidth / 1400 * 100}%` }}>
        <div className="options-width-pane" style={{ width: `${Math.min(100, settings.preferredColumnWidth / settings.preferredRailWidth * 100)}%` }} />
      </div>
    </div>
    <figcaption>
      <span>{t("options.paneWidthLabel")}: <strong>{settings.preferredRailWidth}px</strong></span>
      <span>{t("options.columnWidthLabel")}: <strong>{settings.preferredColumnWidth}px</strong></span>
      <small>{t("options.widthDiagramHint")}</small>
    </figcaption>
  </figure>;
}

/** A local sample: it never reads posts or writes the user's Deck settings. */
export function AppearancePreview({ settings, columnType }: { settings: DeckSettings; columnType: ColumnColorKey }) {
  const { t } = useTranslation();
  const [, refreshTheme] = useState(0);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => refreshTheme((revision) => revision + 1);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const light = resolveTheme(settings.theme) === "light";
  const typeLabels = {
    mentions: "options.paneTypeMentions", channelWatch: "options.paneTypeChannelWatch",
    dmWatch: "options.paneTypeDmWatch", keywordWatch: "options.paneTypeKeywordWatch",
    search: "options.paneTypeSearch", saved: "options.paneTypeSaved", diagnostics: "options.paneTypeDiagnostics",
  } as const;
  const types: ColumnColorKey[] = [columnType, columnType === "channelWatch" ? "mentions" : "channelWatch"];
  return <section className="options-appearance-preview" aria-labelledby="appearance-preview-title">
    <h3 id="appearance-preview-title">{t("options.appearancePreviewTitle")}</h3>
    <p className="options-hint">{t("options.appearancePreviewHint")}</p>
    {settings.theme === "mattermost" && <p className="options-hint">{t("options.previewThemeHint")}</p>}
    <div className="options-preview-scroll" tabIndex={0} role="region" aria-label={t("options.appearancePreviewTitle")}>
      <div className="options-preview-deck" data-theme={light ? "light" : "dark"}
        data-testid="appearance-preview-deck"
        style={{ width: settings.preferredRailWidth, fontSize: 14 * settings.fontScalePercent / 100 }}>
        {types.map((type) => (
          <article key={type} className="options-preview-pane" data-testid="appearance-preview-pane"
            style={{ width: settings.preferredColumnWidth }}>
            <h4><span className="options-preview-type-icon" data-testid="appearance-preview-type-icon"
              style={{ color: settings.columnColorEnabled ? settings.columnColors[type] : "inherit" }}><ColumnTypeIcon type={type} /></span>{t(typeLabels[type])}</h4>
            {[0, 1].map((post) => <div key={post} className={`options-preview-post${settings.compactMode ? " options-preview-post--compact" : ""}`}>
              <div className="options-preview-post-meta"><strong>{post === 0 ? "10:30" : "10:15"}</strong><span>@sample</span></div>
              <p>{t(post === 0 ? "options.previewMessage" : "options.previewReply")}</p>
              {!settings.compactMode && post === 0 && (settings.showImagePreviews
                ? <img src="assets/icons/icon-48.png" width="48" height="48" alt="Mattermost Deck" />
                : <span className="options-preview-file">icon-48.png</span>)}
            </div>)}
          </article>
        ))}
      </div>
    </div>
  </section>;
}
