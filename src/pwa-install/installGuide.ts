import { normaliseDeckLanguage, DEFAULT_DECK_LANGUAGE, type DeckLanguage } from "../ui/language";

export type InstallLocale = DeckLanguage;

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
      edge: "Microsoft Edge: open the … menu, then select More tools → Apps → Install this site as an app.",
      firefox: "Firefox on Windows: select the install button in the address bar (Firefox 143 or later; Microsoft Store builds require Firefox 150 or later). Firefox web apps are not available on macOS or Linux; use Chrome, Edge, or the Mattermost Desktop app there.",
      safari: "Safari on macOS Sonoma 14 or later: open File → Add to Dock. Earlier macOS versions do not support this feature.",
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
      edge: "Microsoft Edge: … メニューを開き、［その他のツール］→［アプリ］→［このサイトをアプリとしてインストール］を選びます。",
      firefox: "Windows 版 Firefox: アドレスバーのインストールボタンを選びます（Firefox 143 以降。Microsoft Store 版は Firefox 150 以降）。macOS と Linux では Firefox のウェブアプリを利用できないため、Chrome、Edge、または Mattermost デスクトップアプリを使用してください。",
      safari: "macOS Sonoma 14 以降の Safari: ［ファイル］→［Dock に追加］を選びます。それより前の macOS では利用できません。",
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
      edge: "Microsoft Edge: Das Menü … öffnen und Weitere Tools → Apps → Diese Website als App installieren wählen.",
      firefox: "Firefox unter Windows: Die Installationsschaltfläche in der Adressleiste wählen (Firefox 143 oder neuer; die Microsoft-Store-Version erfordert Firefox 150 oder neuer). Unter macOS und Linux sind Firefox-Web-Apps nicht verfügbar; dort Chrome, Edge oder die Mattermost-Desktop-App verwenden.",
      safari: "Safari unter macOS Sonoma 14 oder neuer: Ablage → Zum Dock hinzufügen wählen. Ältere macOS-Versionen unterstützen diese Funktion nicht.",
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
      edge: "Microsoft Edge : ouvrez le menu …, puis sélectionnez Autres outils → Applications → Installer ce site en tant qu’application.",
      firefox: "Firefox sous Windows : sélectionnez le bouton d’installation dans la barre d’adresse (Firefox 143 ou version ultérieure ; la version Microsoft Store nécessite Firefox 150 ou version ultérieure). Les applications web Firefox ne sont pas disponibles sous macOS ou Linux ; utilisez-y Chrome, Edge ou l’application de bureau Mattermost.",
      safari: "Safari sous macOS Sonoma 14 ou version ultérieure : sélectionnez Fichier → Ajouter au Dock. Les versions antérieures de macOS ne prennent pas en charge cette fonction.",
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
      edge: "Microsoft Edge：打开 … 菜单，然后选择“更多工具”→“应用”→“将此站点作为应用安装”。",
      firefox: "Windows 版 Firefox：选择地址栏中的安装按钮（Firefox 143 或更高版本；Microsoft Store 版需要 Firefox 150 或更高版本）。macOS 和 Linux 不支持 Firefox Web 应用；请改用 Chrome、Edge 或 Mattermost 桌面应用。",
      safari: "macOS Sonoma 14 或更高版本的 Safari：选择“文件”→“添加到程序坞”。更早的 macOS 版本不支持此功能。",
      chromium: "打开浏览器菜单，然后选择“安装 Mattermost”或“将网页安装为应用”。如果没有该选项，请在 Chrome 或 Edge 中打开此页面。",
      other: "请在 Chrome 或 Edge 中打开此页面，并从浏览器菜单中选择“将网页安装为应用”，或使用 Mattermost 桌面应用。",
    },
    insecureContext: "Mattermost 必须通过 HTTPS 打开，才能安装为应用。",
    alreadyInstalled: "Mattermost 已作为安装的应用打开。",
    installed: "Mattermost 已成功安装。",
  },
  ru: {
    promptTitle: "Установить Mattermost",
    promptDescription: "Установите его как приложение, чтобы запускать прямо с панели задач или из меню приложений.",
    installButton: "Установить",
    cancelButton: "Отмена",
    closeLabel: "Закрыть",
    manualTitle: "Установить Mattermost вручную",
    manualIntro: "Автоматическое окно установки недоступно для этой страницы. Используйте меню браузера:",
    manualInstructions: {
      chrome: "Chrome: откройте меню ⋮ и выберите «Трансляция, сохранение и доступ» (или «Сохранение и доступ») → «Установить страницу как приложение». В более старых версиях выберите «Создать ярлык» и включите «Открывать в отдельном окне».",
      edge: "Microsoft Edge: откройте меню … и выберите «Дополнительные инструменты» → «Приложения» → «Установить этот сайт как приложение».",
      firefox: "Firefox в Windows: нажмите кнопку установки в адресной строке (Firefox 143 или новее; сборки из Microsoft Store требуют Firefox 150 или новее). Веб-приложения Firefox недоступны в macOS и Linux; там используйте Chrome, Edge или настольное приложение Mattermost.",
      safari: "Safari в macOS Sonoma 14 или новее: откройте «Файл» → «Добавить в Dock». Более ранние версии macOS не поддерживают эту функцию.",
      chromium: "Откройте меню браузера и выберите «Установить Mattermost» или «Установить страницу как приложение». Если такого пункта нет, откройте эту страницу в Chrome или Edge.",
      other: "Откройте эту страницу в Chrome или Edge и выберите в меню браузера «Установить страницу как приложение» либо используйте настольное приложение Mattermost.",
    },
    insecureContext: "Mattermost нужно открыть по HTTPS, прежде чем его можно будет установить как приложение.",
    alreadyInstalled: "Mattermost уже открыт как установленное приложение.",
    installed: "Mattermost успешно установлен.",
  },
  uk: {
    promptTitle: "Установити Mattermost",
    promptDescription: "Установіть його як застосунок, щоб запускати прямо з панелі завдань або з меню застосунків.",
    installButton: "Установити",
    cancelButton: "Скасувати",
    closeLabel: "Закрити",
    manualTitle: "Установити Mattermost вручну",
    manualIntro: "Автоматичне вікно встановлення недоступне для цієї сторінки. Скористайтеся меню браузера:",
    manualInstructions: {
      chrome: "Chrome: відкрийте меню ⋮ і виберіть «Трансляція, збереження та доступ» (або «Збереження та доступ») → «Установити сторінку як застосунок». У старіших версіях виберіть «Створити ярлик» і ввімкніть «Відкривати у вікні».",
      edge: "Microsoft Edge: відкрийте меню … і виберіть «Додаткові інструменти» → «Застосунки» → «Установити цей сайт як застосунок».",
      firefox: "Firefox у Windows: натисніть кнопку встановлення в адресному рядку (Firefox 143 або новіший; збірки з Microsoft Store потребують Firefox 150 або новішого). Вебзастосунки Firefox недоступні в macOS і Linux; там використовуйте Chrome, Edge або настільний застосунок Mattermost.",
      safari: "Safari в macOS Sonoma 14 або новішій: відкрийте «Файл» → «Додати до Dock». Раніші версії macOS не підтримують цю функцію.",
      chromium: "Відкрийте меню браузера та виберіть «Установити Mattermost» або «Установити сторінку як застосунок». Якщо такого пункту немає, відкрийте цю сторінку в Chrome або Edge.",
      other: "Відкрийте цю сторінку в Chrome або Edge і виберіть у меню браузера «Установити сторінку як застосунок» або скористайтеся настільним застосунком Mattermost.",
    },
    insecureContext: "Mattermost потрібно відкрити через HTTPS, перш ніж його можна буде встановити як застосунок.",
    alreadyInstalled: "Mattermost уже відкрито як встановлений застосунок.",
    installed: "Mattermost успішно встановлено.",
  },
  es: {
    promptTitle: "Instalar Mattermost",
    promptDescription: "Instálalo como aplicación para abrirlo directamente desde la barra de tareas o el menú de aplicaciones.",
    installButton: "Instalar",
    cancelButton: "Cancelar",
    closeLabel: "Cerrar",
    manualTitle: "Instalar Mattermost manualmente",
    manualIntro: "El aviso de instalación automática no está disponible en esta página. Usa el menú de tu navegador:",
    manualInstructions: {
      chrome: "Chrome: abre el menú ⋮ y selecciona Enviar, guardar y compartir (o Guardar y compartir) → Instalar página como aplicación. En versiones anteriores, selecciona Crear acceso directo y activa Abrir como ventana.",
      edge: "Microsoft Edge: abre el menú … y selecciona Más herramientas → Aplicaciones → Instalar este sitio como una aplicación.",
      firefox: "Firefox en Windows: selecciona el botón de instalación de la barra de direcciones (Firefox 143 o posterior; las versiones de Microsoft Store requieren Firefox 150 o posterior). Las aplicaciones web de Firefox no están disponibles en macOS ni en Linux; usa allí Chrome, Edge o la aplicación de escritorio de Mattermost.",
      safari: "Safari en macOS Sonoma 14 o posterior: abre Archivo → Añadir al Dock. Las versiones anteriores de macOS no admiten esta función.",
      chromium: "Abre el menú del navegador y selecciona Instalar Mattermost o Instalar página como aplicación. Si esa opción no está disponible, abre esta página en Chrome o Edge.",
      other: "Abre esta página en Chrome o Edge y selecciona Instalar página como aplicación en el menú del navegador, o usa la aplicación de escritorio de Mattermost.",
    },
    insecureContext: "Mattermost debe abrirse por HTTPS antes de poder instalarse como aplicación.",
    alreadyInstalled: "Mattermost ya está abierto como aplicación instalada.",
    installed: "Mattermost se ha instalado correctamente.",
  },
  ko: {
    promptTitle: "Mattermost 설치",
    promptDescription: "앱으로 설치하면 작업 표시줄이나 앱 메뉴에서 바로 실행할 수 있습니다.",
    installButton: "설치",
    cancelButton: "취소",
    closeLabel: "닫기",
    manualTitle: "Mattermost 수동 설치",
    manualIntro: "이 페이지에서는 자동 설치 안내를 표시할 수 없습니다. 브라우저 메뉴를 사용하세요:",
    manualInstructions: {
      chrome: "Chrome: ⋮ 메뉴를 열고 [전송, 저장 및 공유](또는 [저장 및 공유]) → [페이지를 앱으로 설치]를 선택하세요. 이전 버전에서는 [바로가기 만들기]를 선택하고 [창으로 열기]를 켜세요.",
      edge: "Microsoft Edge: … 메뉴를 열고 [기타 도구] → [앱] → [이 사이트를 앱으로 설치]를 선택하세요.",
      firefox: "Windows용 Firefox: 주소 표시줄의 설치 버튼을 선택하세요(Firefox 143 이상, Microsoft Store 버전은 Firefox 150 이상 필요). macOS와 Linux에서는 Firefox 웹 앱을 사용할 수 없으므로 Chrome, Edge 또는 Mattermost 데스크톱 앱을 사용하세요.",
      safari: "macOS Sonoma 14 이상의 Safari: [파일] → [Dock에 추가]를 선택하세요. 이전 macOS 버전은 이 기능을 지원하지 않습니다.",
      chromium: "브라우저 메뉴를 열고 [Mattermost 설치] 또는 [페이지를 앱으로 설치]를 선택하세요. 해당 항목이 없으면 이 페이지를 Chrome이나 Edge에서 여세요.",
      other: "이 페이지를 Chrome이나 Edge에서 열고 브라우저 메뉴에서 [페이지를 앱으로 설치]를 선택하거나, Mattermost 데스크톱 앱을 사용하세요.",
    },
    insecureContext: "Mattermost를 앱으로 설치하려면 먼저 HTTPS로 열어야 합니다.",
    alreadyInstalled: "Mattermost가 이미 설치된 앱으로 열려 있습니다.",
    installed: "Mattermost를 설치했습니다.",
  },
};

export function resolveInstallLocale(languages: readonly string[]): InstallLocale {
  for (const language of languages) {
    const locale = normaliseDeckLanguage(language);
    if (locale) return locale;
  }
  return DEFAULT_DECK_LANGUAGE;
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
