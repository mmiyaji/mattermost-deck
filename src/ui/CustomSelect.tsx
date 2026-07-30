import React, { useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShadowRootContext } from "./ShadowRootContext";

export interface CustomSelectOption {
  value: string;
  label: string;
}

export function CustomSelect({
  options,
  value,
  placeholder,
  disabled = false,
  allowClear = true,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  onChange,
}: {
  options: CustomSelectOption[];
  value: string;
  placeholder: string;
  disabled?: boolean;
  allowClear?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const shadowRoot = useContext(ShadowRootContext);
  const selected = options.find((option) => option.value === value);
  const reactId = useId().replace(/:/g, "");
  const listboxId = `mm-custom-select-${reactId}-listbox`;

  const filteredOptions = useMemo(() => {
    if (!search.trim()) {
      return options;
    }
    const lower = search.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(lower));
  }, [options, search]);

  const allItems = useMemo(() => {
    const items = filteredOptions.map((option, index) => ({
      ...option,
      id: `${listboxId}-option-${index}`,
    }));
    if (allowClear && value !== "") {
      items.push({
        value: "",
        label: placeholder,
        id: `${listboxId}-option-clear`,
      });
    }
    return items;
  }, [allowClear, filteredOptions, listboxId, placeholder, value]);

  const activeItem = focusedIndex >= 0 ? allItems[focusedIndex] : undefined;

  // フォーカスが当たった項目を表示領域にスクロール
  useEffect(() => {
    if (focusedIndex >= 0) {
      optionRefs.current[focusedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  // 絞り込みが変わったときだけ、選択中または先頭の候補へ移動する
  useEffect(() => {
    if (!open) {
      return;
    }
    const selectedIndex = allItems.findIndex((item) => item.value === value);
    setFocusedIndex(selectedIndex >= 0 ? selectedIndex : (allItems.length > 0 ? 0 : -1));
  // allItems と value はこの検索入力に対応する最新レンダーの値を参照する。
  // 親の定期更新だけでアクティブ項目を巻き戻さないため search のみをトリガーにする。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // 候補が非同期更新された場合は、現在位置を有効な範囲に収める
  useEffect(() => {
    if (!open) {
      return;
    }
    setFocusedIndex((current) => {
      if (allItems.length === 0) return -1;
      if (current < 0) return 0;
      return Math.min(current, allItems.length - 1);
    });
  }, [allItems.length, open]);

  // メニューを開いたとき検索欄へフォーカスを移し、閉じたとき絞り込みを解除する
  useEffect(() => {
    if (!open) {
      setSearch("");
      setFocusedIndex(-1);
      return;
    }
    const selectedIndex = allItems.findIndex((item) => item.value === value);
    setFocusedIndex(selectedIndex >= 0 ? selectedIndex : (allItems.length > 0 ? 0 : -1));
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  // allItems と value はメニューを開いたレンダー時点の値で初期位置を決める。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const selectItem = useCallback((itemValue: string) => {
    onChange(itemValue);
    closeMenu(true);
  }, [closeMenu, onChange]);

  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent | KeyboardEvent) => {
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((previous) => {
        if (allItems.length === 0) return -1;
        return previous < 0 || previous >= allItems.length - 1 ? 0 : previous + 1;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((previous) => {
        if (allItems.length === 0) return -1;
        return previous <= 0 ? allItems.length - 1 : previous - 1;
      });
    } else if (e.key === "Home") {
      e.preventDefault();
      setFocusedIndex(allItems.length > 0 ? 0 : -1);
    } else if (e.key === "End") {
      e.preventDefault();
      setFocusedIndex(allItems.length - 1);
    } else if (e.key === "Enter") {
      if (focusedIndex >= 0 && focusedIndex < allItems.length) {
        e.preventDefault();
        selectItem(allItems[focusedIndex].value);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }, [allItems, closeMenu, focusedIndex, open, selectItem]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (!path.includes(root)) {
        setOpen(false);
      }
    };

    const target: EventTarget = shadowRoot ?? document;
    target.addEventListener("pointerdown", handlePointerDown as EventListener, true);

    return () => {
      target.removeEventListener("pointerdown", handlePointerDown as EventListener, true);
    };
  }, [open, shadowRoot]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  return (
    <div
      ref={rootRef}
      className={`mm-custom-select${open ? " mm-custom-select--open" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        className="mm-custom-select-button"
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current);
          }
        }}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? activeItem?.id : undefined}
        aria-label={ariaLabelledBy ? undefined : (ariaLabel ?? placeholder)}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        onKeyDown={(event) => {
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !open && !disabled) {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu(false);
          }
        }}
      >
        <span className={`mm-custom-select-label${selected ? "" : " mm-custom-select-label--placeholder"}`}>
          {selected?.label ?? placeholder}
        </span>
        <svg className={`mm-custom-select-chevron${open ? " mm-custom-select-chevron--expanded" : ""}`} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4 2.5L7.5 6L4 9.5" />
        </svg>
      </button>
      {open ? (
        <div className="mm-custom-select-menu">
          <div className="mm-custom-select-current" aria-hidden="true">
            <span className={`mm-custom-select-current-label${selected ? "" : " mm-custom-select-current-label--placeholder"}`}>
              {selected?.label ?? placeholder}
            </span>
          </div>
          <div className="mm-custom-select-divider" aria-hidden="true" />
          <div className="mm-custom-select-search">
            <input
              ref={searchRef}
              type="text"
              className="mm-custom-select-search-input"
              role="searchbox"
              placeholder={t("select.filterPlaceholder")}
              value={search}
              aria-controls={listboxId}
              aria-activedescendant={activeItem?.id}
              aria-label={`${t("select.filterPlaceholder")}: ${ariaLabel ?? placeholder}`}
              aria-describedby={ariaDescribedBy}
              onChange={(e) => setSearch(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                handleMenuKeyDown(e);
              }}
            />
          </div>
          <div
            id={listboxId}
            role="listbox"
            aria-label={ariaLabelledBy ? undefined : (ariaLabel ?? placeholder)}
            aria-labelledby={ariaLabelledBy}
          >
            {filteredOptions.map((option, index) => {
              const item = allItems[index];
              return (
                <div
                  key={option.value}
                  id={item.id}
                  ref={(element) => { optionRefs.current[index] = element; }}
                  role="option"
                  aria-selected={option.value === value}
                  className={[
                    "mm-custom-select-option",
                    option.value === value ? "mm-custom-select-option--selected" : "",
                    focusedIndex === index ? "mm-custom-select-option--focused" : "",
                  ].filter(Boolean).join(" ")}
                  onPointerMove={() => setFocusedIndex(index)}
                  onClick={() => selectItem(option.value)}
                >
                  {option.label}
                </div>
              );
            })}
            {allowClear && value !== "" ? (
              <>
                <div className="mm-custom-select-divider" role="presentation" />
                <div
                  id={`${listboxId}-option-clear`}
                  ref={(element) => { optionRefs.current[filteredOptions.length] = element; }}
                  role="option"
                  aria-selected={value === ""}
                  className={[
                    "mm-custom-select-option",
                    "mm-custom-select-option--placeholder",
                    focusedIndex === filteredOptions.length ? "mm-custom-select-option--focused" : "",
                  ].filter(Boolean).join(" ")}
                  onPointerMove={() => setFocusedIndex(filteredOptions.length)}
                  onClick={() => selectItem("")}
                >
                  {placeholder}
                </div>
              </>
            ) : null}
          </div>
          {filteredOptions.length === 0 ? (
            <div className="mm-custom-select-empty" role="status">{t("select.noMatch")}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
