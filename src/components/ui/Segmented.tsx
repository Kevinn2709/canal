"use client";

/**
 * Segmented.tsx — Control segmentado de iOS con la pastilla que se desliza
 * hasta la opción elegida.
 */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const width = 100 / options.length;

  return (
    <div role="radiogroup" aria-label={label} className="relative flex h-8 rounded-[9px] bg-[rgba(118,118,128,0.24)] p-[2px]">
      <span
        aria-hidden="true"
        className="absolute bottom-[2px] left-[2px] top-[2px] rounded-[7px] bg-[#636366] shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] transition-transform duration-300 ease-ios"
        style={{ width: `calc(${width}% - ${4 / options.length}px)`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`relative z-10 min-w-0 flex-1 truncate px-1 text-[13px] transition-colors ${
              on ? "font-semibold text-white" : "font-medium text-neutral-300"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
