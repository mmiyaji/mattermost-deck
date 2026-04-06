import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import de from "./locales/de.json";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import zhCN from "./locales/zh-CN.json";

void i18n.use(initReactI18next).init({
  resources: {
    ja:    { translation: ja },
    en:    { translation: en },
    de:    { translation: de },
    "zh-CN": { translation: zhCN },
    fr:    { translation: fr },
  },
  lng: "ja",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
