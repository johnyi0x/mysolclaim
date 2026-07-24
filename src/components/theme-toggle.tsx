"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";

const OPTIONS = [
  { value: "system", label: "SYS" },
  { value: "light", label: "DAY" },
  { value: "dark", label: "NITE" },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = mounted ? (theme ?? "system") : "system";
  const label =
    OPTIONS.find((o) => o.value === current)?.label ?? "SYS";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Change theme"
        onClick={() => setOpen((v) => !v)}
        className="pixel-btn pixel-btn-secondary h-10 px-3 text-[10px]"
      >
        {label}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-28 overflow-hidden pixel-panel">
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setTheme(opt.value);
                setOpen(false);
              }}
              className={`flex w-full items-center px-3 py-2 text-left text-base uppercase transition-colors hover:bg-[var(--accent)] hover:text-[#04140c] ${
                current === opt.value
                  ? "bg-[var(--accent)]/25 font-semibold text-[var(--accent)]"
                  : "text-[var(--foreground)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
