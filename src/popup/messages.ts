import { resolveDeckLanguage, type DeckLanguage } from "../ui/language";

export type PopupLocale = DeckLanguage;

export interface PopupMessages {
  installApp: string;
  openMattermost: string;
  settings: string;
  installFailed: string;
  openFailed: string;
}

const POPUP_MESSAGES: Record<PopupLocale, PopupMessages> = {
  en: {
    installApp: "Install Mattermost app",
    openMattermost: "Open Mattermost",
    settings: "Settings",
    installFailed: "Mattermost could not be opened for installation. Check the server URL and try again.",
    openFailed: "Mattermost could not be opened. Check the server URL and try again.",
  },
  ja: {
    installApp: "Mattermost アプリをインストール",
    openMattermost: "Mattermost を開く",
    settings: "設定",
    installFailed: "インストール用の Mattermost を開けませんでした。Server URL を確認して、もう一度お試しください。",
    openFailed: "Mattermost を開けませんでした。Server URL を確認して、もう一度お試しください。",
  },
  de: {
    installApp: "Mattermost-App installieren",
    openMattermost: "Mattermost öffnen",
    settings: "Einstellungen",
    installFailed: "Mattermost konnte nicht zur Installation geöffnet werden. Prüfen Sie die Server-URL und versuchen Sie es erneut.",
    openFailed: "Mattermost konnte nicht geöffnet werden. Prüfen Sie die Server-URL und versuchen Sie es erneut.",
  },
  fr: {
    installApp: "Installer l’application Mattermost",
    openMattermost: "Ouvrir Mattermost",
    settings: "Paramètres",
    installFailed: "Impossible d’ouvrir Mattermost pour l’installation. Vérifiez l’URL du serveur et réessayez.",
    openFailed: "Impossible d’ouvrir Mattermost. Vérifiez l’URL du serveur et réessayez.",
  },
  "zh-CN": {
    installApp: "安装 Mattermost 应用",
    openMattermost: "打开 Mattermost",
    settings: "设置",
    installFailed: "无法打开 Mattermost 进行安装。请检查服务器 URL 后重试。",
    openFailed: "无法打开 Mattermost。请检查服务器 URL 后重试。",
  },
  ru: {
    installApp: "Установить приложение Mattermost",
    openMattermost: "Открыть Mattermost",
    settings: "Настройки",
    installFailed: "Не удалось открыть Mattermost для установки. Проверьте URL сервера и повторите попытку.",
    openFailed: "Не удалось открыть Mattermost. Проверьте URL сервера и повторите попытку.",
  },
  uk: {
    installApp: "Установити застосунок Mattermost",
    openMattermost: "Відкрити Mattermost",
    settings: "Налаштування",
    installFailed: "Не вдалося відкрити Mattermost для встановлення. Перевірте URL сервера та повторіть спробу.",
    openFailed: "Не вдалося відкрити Mattermost. Перевірте URL сервера та повторіть спробу.",
  },
};

export function resolvePopupLocale(
  value: unknown,
  browserLanguages: readonly string[] = [],
  chromeUiLanguage?: unknown,
): PopupLocale {
  return resolveDeckLanguage(value, chromeUiLanguage, browserLanguages);
}

export function getPopupMessages(locale: PopupLocale): PopupMessages {
  return POPUP_MESSAGES[locale];
}
