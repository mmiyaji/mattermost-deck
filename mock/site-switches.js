// テーマ（アイコン1つでライト／ダークを切り替え、初期状態は OS 設定に追従）と
// 言語（🌐 + プルダウン）の切り替え。
// 言語の属性名は既存サイト docs/assets/site.js と同じ data-i18n-* / data-lang-panel を使う。
(() => {
  const LANGUAGE_KEY = "mattermost-deck-site-language";
  const THEME_KEY = "mattermost-deck-site-theme";
  const LANGUAGES = ["ja", "en"];
  const DARK_BG = "#15181c";
  const LIGHT_BG = "#ffffff";

  const read = (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const write = (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // 保存できなくても、そのページ内での切り替えは動く。
    }
  };

  // --- テーマ ---------------------------------------------------------------

  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const toggle = document.querySelector("[data-theme-toggle]");

  // 明示的に選ぶまでは属性を付けず、OS 設定に追従させる。
  let theme = read(THEME_KEY) === "light" || read(THEME_KEY) === "dark" ? read(THEME_KEY) : "auto";

  const isDark = () => (theme === "auto" ? systemDark.matches : theme === "dark");

  const applyTheme = () => {
    const root = document.documentElement;
    if (theme === "auto") {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = theme;
    }

    const dark = isDark();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? DARK_BG : LIGHT_BG);

    if (toggle) {
      // ボタンは「押すとどうなるか」を読み上げる。
      const label = dark ? toggle.dataset.labelToLight : toggle.dataset.labelToDark;
      if (label) {
        toggle.setAttribute("aria-label", label);
        toggle.setAttribute("title", label);
      }
    }
  };

  toggle?.addEventListener("click", () => {
    theme = isDark() ? "light" : "dark";
    write(THEME_KEY, theme);
    applyTheme();
  });

  systemDark.addEventListener("change", () => {
    if (theme === "auto") {
      applyTheme();
    }
  });

  applyTheme();

  // --- 言語 -----------------------------------------------------------------

  const requested = new URLSearchParams(window.location.search).get("lang");
  const saved = read(LANGUAGE_KEY);
  const initial = LANGUAGES.includes(requested)
    ? requested
    : LANGUAGES.includes(saved)
      ? saved
      : window.navigator.language.toLowerCase().startsWith("ja")
        ? "ja"
        : "en";

  let language = initial;

  const swap = (selector, japaneseKey, englishKey, apply) => {
    document.querySelectorAll(selector).forEach((element) => {
      const value = language === "ja" ? element.dataset[japaneseKey] : element.dataset[englishKey];
      if (value) {
        apply(element, value);
      }
    });
  };

  const applyLanguage = (next) => {
    language = next;
    document.documentElement.lang = next;

    swap("[data-i18n-ja]", "i18nJa", "i18nEn", (element, value) => {
      element.textContent = value;
    });
    swap("[data-i18n-alt-ja]", "i18nAltJa", "i18nAltEn", (element, value) => {
      element.setAttribute("alt", value);
    });
    swap("[data-i18n-aria-ja]", "i18nAriaJa", "i18nAriaEn", (element, value) => {
      element.setAttribute("aria-label", value);
    });
    // ライトボックスのキャプションは data-description を読むので、ここで入れ替える。
    swap("[data-i18n-caption-ja]", "i18nCaptionJa", "i18nCaptionEn", (element, value) => {
      element.setAttribute("data-description", value);
    });
    // テーマボタンの読み上げ文は applyTheme がこの2つから選ぶ。
    swap("[data-i18n-to-dark-ja]", "i18nToDarkJa", "i18nToDarkEn", (element, value) => {
      element.dataset.labelToDark = value;
    });
    swap("[data-i18n-to-light-ja]", "i18nToLightJa", "i18nToLightEn", (element, value) => {
      element.dataset.labelToLight = value;
    });

    document.querySelectorAll("[data-lang-panel]").forEach((element) => {
      element.hidden = element.dataset.langPanel !== next;
    });

    const select = document.querySelector("[data-lang-select]");
    if (select) {
      if (select.value !== next) {
        select.value = next;
      }
      // 見出し表示は自前の要素なので、選択中の option 名をそのまま写す。
      const current = document.querySelector("[data-lang-current]");
      if (current) {
        current.textContent = select.selectedOptions[0]?.textContent ?? next;
      }
    }

    // テーマボタンの説明文も言語に合わせて付け替える。
    applyTheme();

    const url = new URL(window.location.href);
    url.searchParams.set("lang", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);

    document.dispatchEvent(new CustomEvent("site:languagechange", { detail: { language: next } }));
  };

  document.querySelector("[data-lang-select]")?.addEventListener("change", (event) => {
    const next = event.target.value;
    if (!LANGUAGES.includes(next)) {
      return;
    }
    write(LANGUAGE_KEY, next);
    applyLanguage(next);
  });

  applyLanguage(initial);
})();
