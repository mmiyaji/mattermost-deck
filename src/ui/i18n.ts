import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import ru from "./locales/ru.json";
import uk from "./locales/uk.json";
import zhCN from "./locales/zh-CN.json";
import type { ResourceKey } from "i18next";
import { DEFAULT_DECK_LANGUAGE, resolveDeckLanguage, type DeckLanguage } from "./language";

const translations: Record<DeckLanguage, ResourceKey> = {
  ja,
  en,
  de,
  "zh-CN": zhCN,
  fr,
  ru,
  uk,
  es,
  ko,
};

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(
    Object.entries(translations).map(([code, translation]) => [code, { translation }]),
  ),
  lng: resolveDeckLanguage(),
  fallbackLng: DEFAULT_DECK_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
