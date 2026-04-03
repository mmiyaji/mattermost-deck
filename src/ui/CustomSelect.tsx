import React, { useEffect, useRef, useState } from "react";

export interface CustomSelectOption {
  value: string;
  label: string;
}

export function CustomSelect({
  options,
  value,
  placeholder,
  disabled = false,
  onChange,
}: {
  options: CustomSelectOption[];
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) {
      return;
    }

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
    <div ref={rootRef} className={`mm-custom-select${open ? " mm-custom-select--open" : ""}`}>
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
          <button
            type="button"
            className={`mm-custom-select-option${value === "" ? " mm-custom-select-option--selected" : ""}`}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            {placeholder}
          </button>
          {options.map((option) => (
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
        </div>
      ) : null}
    </div>
  );
}
