export type InstallLocale = "de" | "en" | "fr" | "ja" | "zh-CN";

export type BrowserKind = "chrome" | "edge" | "firefox" | "safari" | "chromium" | "other";

export interface InstallMessages {
  promptTitle: string;
  promptDescription: string;
  installButton: string;
  cancelButton: string;
  closeLabel: string;
  manualTitle: string;
  manualIntro: string;
  manualInstructions: Record<BrowserKind, string>;
  insecureContext: string;
  alreadyInstalled: string;
  installed: string;
}

const MESSAGES: Record<InstallLocale, InstallMessages> = {
  en: {
    promptTitle: "Install Mattermost",
    promptDescription: "Install it as an app to launch it directly from your taskbar or app menu.",
    installButton: "Install",
    cancelButton: "Cancel",
    closeLabel: "Close",
    manualTitle: "Install Mattermost manually",
    manualIntro: "The automatic install prompt is not available for this page. Use your browser menu:",
    manualInstructions: {
      chrome: "Chrome: open the ⋮ menu, then select Cast, save, and share (or Save and share) → Install page as app. In older versions, select Create shortcut and enable Open as window.",
      edge: "Microsoft Edge: open the … menu, then select Apps → Install Mattermost.",
      firefox: "Firefox for desktop does not support installing sites as PWAs. Open this page in Chrome or Edge, or use the Mattermost Desktop app.",
      safari: "Safari on macOS: open File → Add to Dock.",
      chromium: "Open the browser menu and select Install Mattermost or Install page as app. If that option is unavailable, open this page in Chrome or Edge.",
      other: "Open this page in Chrome or Edge and use the browser menu to select Install page as app, or use the Mattermost Desktop app.",
    },
    insecureContext: "Mattermost must be opened over HTTPS before it can be installed as an app.",
    alreadyInstalled: "Mattermost is already open as an installed app.",
    installed: "Mattermost was installed successfully.",
  },
  ja: {
    promptTitle: "Mattermost をインストール",
    promptDescription: "アプリとしてインストールすると、タスクバーやアプリメニューから直接起動できます。",
    installButton: "インストール",
    cancelButton: "キャンセル",
    closeLabel: "閉じる",
    manualTitle: "Mattermost を手動でインストール",
    manualIntro: "このページでは自動インストール画面を表示できません。ブラウザメニューから次の操作を行ってください。",
    manualInstructions: {
      chrome: "Chrome: ⋮ メニューを開き、［キャスト、保存、共有］（または［保存して共有］）→［ページをアプリとしてインストール］を選びます。古いバージョンでは［ショートカットを作成］を選び、［ウィンドウとして開く］を有効にします。",
      edge: "Microsoft Edge: … メニューを開き、［アプリ］→［Mattermost のインストール］を選びます。",
      firefox: "デスクトップ版 Firefox は PWA のインストールに対応していません。Chrome または Edge でこのページを開くか、Mattermost デスクトップアプリを使用してください。",
      safari: "macOS 版 Safari: ［ファイル］→［Dock に追加］を選びます。",
      chromium: "ブラウザメニューを開き、［Mattermost をインストール］または［ページをアプリとしてインストール］を選びます。項目がない場合は Chrome または Edge で開いてください。",
      other: "Chrome または Edge でこのページを開き、ブラウザメニューから［ページをアプリとしてインストール］を選ぶか、Mattermost デスクトップアプリを使用してください。",
    },
    insecureContext: "Mattermost をアプリとしてインストールするには、HTTPS で開く必要があります。",
    alreadyInstalled: "Mattermost はインストール済みのアプリとして開かれています。",
    installed: "Mattermost をインストールしました。",
  },
  de: {
    promptTitle: "Mattermost installieren",
    promptDescription: "Als App installieren, um Mattermost direkt über die Taskleiste oder das App-Menü zu starten.",
    installButton: "Installieren",
    cancelButton: "Abbrechen",
    closeLabel: "Schließen",
    manualTitle: "Mattermost manuell installieren",
    manualIntro: "Die automatische Installationsaufforderung ist für diese Seite nicht verfügbar. Verwenden Sie das Browsermenü:",
    manualInstructions: {
      chrome: "Chrome: Das Menü ⋮ öffnen und Streamen, speichern und teilen (oder Speichern und teilen) → Seite als App installieren wählen. In älteren Versionen Verknüpfung erstellen wählen und Als Fenster öffnen aktivieren.",
      edge: "Microsoft Edge: Das Menü … öffnen und Apps → Mattermost installieren wählen.",
      firefox: "Firefox für Desktop unterstützt die Installation von Websites als PWA nicht. Diese Seite in Chrome oder Edge öffnen oder die Mattermost-Desktop-App verwenden.",
      safari: "Safari unter macOS: Ablage → Zum Dock hinzufügen wählen.",
      chromium: "Das Browsermenü öffnen und Mattermost installieren oder Seite als App installieren wählen. Falls die Option fehlt, diese Seite in Chrome oder Edge öffnen.",
      other: "Diese Seite in Chrome oder Edge öffnen und im Browsermenü Seite als App installieren wählen oder die Mattermost-Desktop-App verwenden.",
    },
    insecureContext: "Mattermost muss über HTTPS geöffnet werden, bevor es als App installiert werden kann.",
    alreadyInstalled: "Mattermost ist bereits als installierte App geöffnet.",
    installed: "Mattermost wurde erfolgreich installiert.",
  },
  fr: {
    promptTitle: "Installer Mattermost",
    promptDescription: "Installez Mattermost comme application pour le lancer directement depuis la barre des tâches ou le menu des applications.",
    installButton: "Installer",
    cancelButton: "Annuler",
    closeLabel: "Fermer",
    manualTitle: "Installer Mattermost manuellement",
    manualIntro: "L'invite d'installation automatique n'est pas disponible pour cette page. Utilisez le menu de votre navigateur :",
    manualInstructions: {
      chrome: "Chrome : ouvrez le menu ⋮, puis sélectionnez Caster, enregistrer et partager (ou Enregistrer et partager) → Installer la page en tant qu'application. Dans les anciennes versions, sélectionnez Créer un raccourci et activez Ouvrir dans une fenêtre.",
      edge: "Microsoft Edge : ouvrez le menu …, puis sélectionnez Applications → Installer Mattermost.",
      firefox: "Firefox pour ordinateur ne permet pas d'installer les sites comme PWA. Ouvrez cette page dans Chrome ou Edge, ou utilisez l'application de bureau Mattermost.",
      safari: "Safari sur macOS : sélectionnez Fichier → Ajouter au Dock.",
      chromium: "Ouvrez le menu du navigateur et sélectionnez Installer Mattermost ou Installer la page en tant qu'application. Si l'option n'est pas disponible, ouvrez cette page dans Chrome ou Edge.",
      other: "Ouvrez cette page dans Chrome ou Edge et sélectionnez Installer la page en tant qu'application dans le menu du navigateur, ou utilisez l'application de bureau Mattermost.",
    },
    insecureContext: "Mattermost doit être ouvert via HTTPS avant de pouvoir être installé comme application.",
    alreadyInstalled: "Mattermost est déjà ouvert comme application installée.",
    installed: "Mattermost a été installé avec succès.",
  },
  "zh-CN": {
    promptTitle: "安装 Mattermost",
    promptDescription: "将 Mattermost 安装为应用后，可以直接从任务栏或应用菜单启动。",
    installButton: "安装",
    cancelButton: "取消",
    closeLabel: "关闭",
    manualTitle: "手动安装 Mattermost",
    manualIntro: "此页面无法显示自动安装提示。请使用浏览器菜单：",
    manualInstructions: {
      chrome: "Chrome：打开 ⋮ 菜单，然后选择“投放、保存和分享”（或“保存和分享”）→“将网页安装为应用”。旧版本请选择“创建快捷方式”，并启用“在窗口中打开”。",
      edge: "Microsoft Edge：打开 … 菜单，然后选择“应用”→“安装 Mattermost”。",
      firefox: "Firefox 桌面版不支持将网站安装为 PWA。请在 Chrome 或 Edge 中打开此页面，或使用 Mattermost 桌面应用。",
      safari: "macOS 版 Safari：选择“文件”→“添加到 Dock”。",
      chromium: "打开浏览器菜单，然后选择“安装 Mattermost”或“将网页安装为应用”。如果没有该选项，请在 Chrome 或 Edge 中打开此页面。",
      other: "请在 Chrome 或 Edge 中打开此页面，并从浏览器菜单中选择“将网页安装为应用”，或使用 Mattermost 桌面应用。",
    },
    insecureContext: "Mattermost 必须通过 HTTPS 打开，才能安装为应用。",
    alreadyInstalled: "Mattermost 已作为安装的应用打开。",
    installed: "Mattermost 已成功安装。",
  },
};

export function resolveInstallLocale(languages: readonly string[]): InstallLocale {
  for (const language of languages) {
    const normalized = language.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
    if (normalized === "de" || normalized.startsWith("de-")) return "de";
    if (normalized === "fr" || normalized.startsWith("fr-")) return "fr";
    if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-sg" || normalized.startsWith("zh-hans")) return "zh-CN";
    if (normalized === "en" || normalized.startsWith("en-")) return "en";
  }
  return "en";
}

export function detectBrowser(userAgent: string, brands: readonly string[] = []): BrowserKind {
  const signature = `${brands.join(" ")} ${userAgent}`;
  if (/Microsoft Edge|Edg(?:A|iOS)?\//i.test(signature)) return "edge";
  if (/Firefox|FxiOS/i.test(signature)) return "firefox";
  if (/Opera|OPR\/|Vivaldi|Brave/i.test(signature)) return "chromium";
  if (/Google Chrome|Chrome\/|CriOS\//i.test(signature)) return "chrome";
  if (/Chromium/i.test(signature)) return "chromium";
  if (/Safari\//i.test(signature)) return "safari";
  return "other";
}

export function getInstallMessages(locale: InstallLocale): InstallMessages {
  return MESSAGES[locale];
}
