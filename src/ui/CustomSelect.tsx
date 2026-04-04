import React, { useEffect, useMemo, useRef, useState } from "react";

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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) {
      return options;
    }
    const lower = search.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(lower));
  }, [options, search]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }

    window.setTimeout(() => searchRef.current?.focus(), 0);

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) {
        return;
      }

      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (!path.includes(root)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

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
              placeholder="絞り込み..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
            />
          </div>
          {filteredOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`mm-custom-select-option${option.value === value ? " mm-custom-select-option--selected" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
          {filteredOptions.length === 0 ? (
            <div className="mm-custom-select-empty">一致なし</div>
          ) : null}
          {allowClear && value !== "" ? (
            <>
              <div className="mm-custom-select-divider" aria-hidden="true" />
              <button
                type="button"
                className="mm-custom-select-option mm-custom-select-option--placeholder"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
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
