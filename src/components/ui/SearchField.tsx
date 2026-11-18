"use client";

/**
 * SearchField.tsx — Campo de búsqueda al estilo de iOS: lupa, botón para
 * borrar y "Cancelar" que aparece mientras escribes.
 *
 * Texto de 17 px (iOS no hace zoom en campos de 16 px o más).
 */

import { forwardRef, useState } from "react";
import { Magnifier, XCircleFill } from "./symbols";

export const SearchField = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    label: string;
    onFocusChange?: (focused: boolean) => void;
  }
>(function SearchField({ value, onChange, placeholder, label, onFocusChange }, ref) {
  const [focused, setFocused] = useState(false);
  const setF = (v: boolean) => {
    setFocused(v);
    onFocusChange?.(v);
  };

  return (
    <div className="flex items-center gap-2" role="search">
      <label className="flex h-9 min-w-0 flex-1 items-center rounded-[10px] bg-[rgba(118,118,128,0.24)] transition-colors focus-within:bg-[rgba(118,118,128,0.3)]">
        <Magnifier className="ml-2 h-[17px] w-[17px] shrink-0 text-neutral-500" />
        <input
          ref={ref}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setF(true)}
          onBlur={() => setF(false)}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-label={label}
          className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-[17px] text-neutral-50 outline-none placeholder:text-neutral-500 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
        />
        {value && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange("")}
            className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center text-neutral-500"
            aria-label="Borrar búsqueda"
          >
            <XCircleFill className="h-[17px] w-[17px]" />
          </button>
        )}
      </label>
      <button
        type="button"
        tabIndex={focused || value ? 0 : -1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onChange("");
          (document.activeElement as HTMLElement | null)?.blur();
        }}
        className={`overflow-hidden whitespace-nowrap text-[17px] text-sky-500 transition-all duration-300 ease-ios ${
          focused || value ? "max-w-[6rem] opacity-100" : "pointer-events-none max-w-0 opacity-0"
        }`}
      >
        Cancelar
      </button>
    </div>
  );
});
