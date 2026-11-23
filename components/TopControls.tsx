"use client";

import { useEffect, useState } from "react";

/** Collapses both side panels (desktop) and tracks the currently visible Hungarian chapter heading. */
export default function TopControls() {
  const [collapsed, setCollapsed] = useState(false);
  const [chapterLabel, setChapterLabel] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.toggle("panels-collapsed", collapsed);
  }, [collapsed]);

  function togglePanels() {
    const reader = document.querySelector<HTMLElement>(".reader-content");
    const verse = reader?.querySelector<HTMLElement>("a.verse-link.active-verse");

    if (reader && verse) {
      const readerRect = reader.getBoundingClientRect();
      const top = verse.getBoundingClientRect().top;
      const targetTop = top >= readerRect.top + 60 && top <= readerRect.bottom - 40
        ? top
        : readerRect.top + readerRect.height / 2;

      // Reflow once before restoring the verse; animating the reader width would move it repeatedly.
      document.body.classList.add("anchoring-verse");
      document.body.classList.toggle("panels-collapsed", !collapsed);
      reader.scrollTo({
        top: reader.scrollTop + verse.getBoundingClientRect().top - targetTop,
        behavior: "instant",
      });
      document.body.classList.remove("anchoring-verse");
    }

    setCollapsed((c) => !c);
  }

  useEffect(() => {
    function isMobile() {
      return window.innerWidth <= 980;
    }
    function update() {
      const headings = document.querySelectorAll(".bilingual-table td.hu h1");
      if (!headings.length) {
        setChapterLabel(null);
        return;
      }
      let best: Element | null = null;
      headings.forEach((h) => {
        if (h.getBoundingClientRect().top <= 120) best = h;
      });
      setChapterLabel(best ? (best as HTMLElement).textContent : null);
    }
    function onResize() {
      if (isMobile() && collapsed) setCollapsed(false);
      update();
    }
    window.addEventListener("scroll", update, { passive: true });
    function onElementScroll(event: Event) {
      if (event.target instanceof Element && event.target.classList.contains("reader-content")) update();
    }
    document.addEventListener("scroll", onElementScroll, { capture: true, passive: true });
    window.addEventListener("resize", onResize);
    update();
    return () => {
      window.removeEventListener("scroll", update);
      document.removeEventListener("scroll", onElementScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [collapsed]);

  return (
    <>
      <button
        id="panels-toggle"
        type="button"
        aria-pressed={collapsed}
        aria-label={collapsed ? "Oldalsávok megnyitása" : "Oldalsávok becsukása"}
        title={collapsed ? "Oldalsávok megnyitása" : "Oldalsávok becsukása"}
        onClick={togglePanels}
      >
        {collapsed ? "›‹" : "‹›"}
      </button>
      <div id="chapter-indicator" className={chapterLabel ? "visible" : ""}>
        {chapterLabel}
      </div>
    </>
  );
}
