"use client";

import { useState } from "react";
import { FAQ_ITEMS } from "@/lib/faq-data";

export function Faq({ limit }: { limit?: number }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const items = limit ? FAQ_ITEMS.slice(0, limit) : FAQ_ITEMS;

  return (
    <div className="mx-auto max-w-3xl divide-y-[3px] divide-[var(--panel-border)] pixel-panel">
      {items.map((item, i) => {
        const open = openIndex === i;
        return (
          <div key={item.question}>
            <button
              type="button"
              onClick={() => setOpenIndex(open ? null : i)}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-xl hover:bg-[var(--accent)]/10"
            >
              <span>{item.question}</span>
              <span className="font-pixel text-[10px] text-[var(--accent)]">
                {open ? "[-]" : "[+]"}
              </span>
            </button>
            {open && (
              <p className="px-5 pb-5 text-lg leading-snug text-[var(--muted)]">
                {item.answer}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function FaqSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <h2 className="text-center font-pixel text-sm sm:text-base">
        &gt; faq
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-xl text-[var(--muted)]">
        Every fear, answered honestly.
      </p>
      <div className="mt-10">
        <Faq />
      </div>
    </section>
  );
}
