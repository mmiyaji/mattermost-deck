import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  onChange,
}: {
  options: CustomSelectOption[];
  value: string;
  placeholder: string;
  disabled?: boolean;
  allowClear?: boolean;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const shadowRoot = useContext(ShadowRootContext);
  const selected = options.find((option) => option.value === value);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) {
      return options;
    }
    const lower = search.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(lower));
  }, [options, search]);

  // フォーカスが当たった項目を表示領域にスクロール
  useEffect(() => {
    if (focusedIndex >= 0) {
      optionRefs.current[focusedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  // 検索テキストが変わったらフォーカスをリセット
  useEffect(() => {
    setFocusedIndex(-1);
  }, [search]);

  // メニューを開いたとき選択中の項目にフォーカスを合わせる
  useEffect(() => {
    if (!open) {
      setSearch("");
      setFocusedIndex(-1);
      return;
    }

    const idx = filteredOptions.findIndex((o) => o.value === value);
    setFocusedIndex(idx);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 全ナビゲーション対象項目（filteredOptions + クリア項目）
  const allItems = useMemo(() => {
    const items: Array<{ value: string; label: string }> = [...filteredOptions];
    if (allowClear && value !== "") {
      items.push({ value: "", label: placeholder });
    }
    return items;
  }, [filteredOptions, allowClear, value, placeholder]);

  const selectItem = useCallback((itemValue: string) => {
    onChange(itemValue);
    setOpen(false);
  }, [onChange]);

  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent | KeyboardEvent) => {
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => Math.min(prev + 1, allItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      if (focusedIndex >= 0 && focusedIndex < allItems.length) {
        e.preventDefault();
        selectItem(allItems[focusedIndex].value);
      }
    }
  }, [open, allItems, focusedIndex, selectItem]);

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

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      handleMenuKeyDown(event);
    };

    const target: EventTarget = shadowRoot ?? document;
    target.addEventListener("pointerdown", handlePointerDown as EventListener, true);
    target.addEventListener("keydown", handleKeyDown as EventListener);

    return () => {
      target.removeEventListener("pointerdown", handlePointerDown as EventListener, true);
      target.removeEventListener("keydown", handleKeyDown as EventListener);
    };
  }, [open, shadowRoot, handleMenuKeyDown]);

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
        type="button"
        className="mm-custom-select-button"
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current);
          }
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`mm-custom-select-label${selected ? "" : " mm-custom-select-label--placeholder"}`}>
          {selected?.label ?? placeholder}
        </span>
        <svg className={`mm-custom-select-chevron${open ? " mm-custom-select-chevron--expanded" : ""}`} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4 2.5L7.5 6L4 9.5" />
        </svg>
      </button>
      {open ? (
        <div className="mm-custom-select-menu" role="listbox">
          <div className="mm-custom-select-current">
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
              placeholder={t("select.filterPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  setOpen(false);
                  return;
                }
                handleMenuKeyDown(e);
              }}
            />
          </div>
          {filteredOptions.map((option, index) => (
            <button
              key={option.value}
              ref={(el) => { optionRefs.current[index] = el; }}
              type="button"
              className={[
                "mm-custom-select-option",
                option.value === value ? "mm-custom-select-option--selected" : "",
                focusedIndex === index ? "mm-custom-select-option--focused" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => selectItem(option.value)}
            >
              {option.label}
            </button>
          ))}
          {filteredOptions.length === 0 ? (
            <div className="mm-custom-select-empty">{t("select.noMatch")}</div>
          ) : null}
          {allowClear && value !== "" ? (
            <>
              <div className="mm-custom-select-divider" aria-hidden="true" />
              <button
                ref={(el) => { optionRefs.current[filteredOptions.length] = el; }}
                type="button"
                className={[
                  "mm-custom-select-option",
                  "mm-custom-select-option--placeholder",
                  focusedIndex === filteredOptions.length ? "mm-custom-select-option--focused" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => selectItem("")}
              >
                {placeholder}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
