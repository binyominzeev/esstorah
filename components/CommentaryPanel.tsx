"use client";

import { useEffect, useRef, useState } from "react";
import type { CommentaryEntry } from "@/lib/types";
import QuestionMap from "./QuestionMap";
import RashiText from "./RashiText";
import InlineEditor from "./InlineEditor";
import { useAuth } from "./AuthProvider";

type PanelTab = "questions" | "commentaries" | "rashi";
const tabs: { id: PanelTab; label: string }[] = [
  { id: "questions", label: "Kérdések" },
  { id: "commentaries", label: "Kommentárok" },
  { id: "rashi", label: "Rási" },
];

export default function CommentaryPanel({
  parasha,
  open,
  onClose,
  sefariaHref,
  sefariaLabel,
  mapRef,
  onMapDone,
  bookmarkTarget,
  commentaries,
  liveError,
  activeInfo,
  tab,
  onTabChange,
  selectedCommentary,
  onSelectVerse,
}: {
  parasha: string;
  open: boolean;
  onClose: () => void;
  sefariaHref?: string;
  sefariaLabel?: string;
  mapRef?: string;
  onMapDone?: (ref: string) => void;
  bookmarkTarget?: { ref: string; kind: "question" | "answer"; text: string };
  commentaries: CommentaryEntry[];
  liveError?: string;
  activeInfo?: { chapter: number; verse: number; book?: string };
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  selectedCommentary?: string;
  onSelectVerse: (chapter: number, verse: number) => void;
}) {
  const { isAdmin } = useAuth();
  const [editing, setEditing] = useState<string>();
  const [editFocus, setEditFocus] = useState<"title" | "body">("body");
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number; moved: boolean } | null>(null);
  const ignoreNextClickRef = useRef(false);
  const [showAll, setShowAll] = useState(false);
  const [wideCommentaries, setWideCommentaries] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const relevantCommentaries = commentaries.filter((c) =>
    c.verses.some((v) => v.chapter === activeInfo?.chapter && v.verse === activeInfo?.verse)
  );
  const allCommentaries = [...commentaries].sort((a, b) => {
    const first = (entry: CommentaryEntry) =>
      [...entry.verses].sort((x, y) => x.chapter - y.chapter || x.verse - y.verse)[0];
    const aFirst = first(a), bFirst = first(b);
    if (!aFirst) return bFirst ? 1 : 0;
    if (!bFirst) return -1;
    return aFirst.chapter - bFirst.chapter || aFirst.verse - bFirst.verse;
  });

  useEffect(() => {
    const parser = new DOMParser();
    setTitles(Object.fromEntries(commentaries.map((c) => {
      const doc = parser.parseFromString(c.html, "text/html");
      const title = doc.querySelector("h1, h2, h3, h4, h5, h6")?.textContent?.trim();
      return [c.id, title || c.id.replace(/[-_]+/g, " ")];
    })));
  }, [commentaries]);

  useEffect(() => {
    if (open && tab === "commentaries" && selectedCommentary) {
      document.getElementById(`commentary-${selectedCommentary}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [open, tab, selectedCommentary, activeInfo]);

  useEffect(() => {
    if (!open && panelRef.current) {
      panelRef.current.style.height = "";
      panelRef.current.classList.remove("resized", "dragging");
    }
  }, [open]);

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0 || !panelRef.current) return;

    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: panelRef.current.getBoundingClientRect().height,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !panel) return;

    const deltaY = drag.startY - event.clientY;
    if (Math.abs(deltaY) > 4) drag.moved = true;
    if (!drag.moved) return;

    const maxHeight = window.innerHeight * 0.9;
    const minHeight = Math.min(140, maxHeight);
    panel.classList.add("resized", "dragging");
    panel.style.height = `${Math.max(minHeight, Math.min(maxHeight, drag.startHeight + deltaY))}px`;
  }

  function handlePointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !panel) return;

    dragRef.current = null;
    panel.classList.remove("dragging");
    if (!drag.moved) return;

    ignoreNextClickRef.current = true;
    window.setTimeout(() => {
      ignoreNextClickRef.current = false;
    }, 0);

    const deltaY = drag.startY - event.clientY;
    const height = drag.startHeight + deltaY;
    if (deltaY < 0 && height < 150) {
      panel.style.height = "";
      panel.classList.remove("resized");
      onClose();
      return;
    }

    const maxHeight = window.innerHeight * 0.9;
    const minHeight = Math.min(140, maxHeight);
    panel.classList.add("resized");
    panel.style.height = `${Math.max(minHeight, Math.min(maxHeight, height))}px`;
  }

  function handlePointerCancel(event: React.PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    panelRef.current?.classList.remove("dragging");
  }

  function handleHandleClick() {
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false;
      return;
    }
    onClose();
  }

  function handleTabChange(nextTab: PanelTab) {
    if (nextTab !== "commentaries") setWideCommentaries(false);
    onTabChange(nextTab);
  }

  return (
    <div ref={panelRef} className={`commentary-container${open ? " open" : ""}${wideCommentaries && tab === "commentaries" ? " commentary-wide" : ""}`}>
      <button
        type="button"
        className="panel-close"
        aria-label="Alsó panel bezárása"
        aria-expanded={open}
        tabIndex={open ? 0 : -1}
        onClick={handleHandleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      />
      {sefariaHref && (
        <div id="sefaria-box" className="panel-heading">
          <span className="vrs-label">{sefariaLabel}</span>
          <a id="sefaria-link" href={sefariaHref} target="_blank" rel="noreferrer">Sefaria ↗</a>
        </div>
      )}
      <div className="panel-tabs">
        <div role="tablist" aria-label="Pászukhoz kapcsolódó tartalom">
          {tabs.map((item, index) => (
            <button key={item.id} id={`tab-${item.id}`} type="button" role="tab"
              aria-selected={tab === item.id} aria-controls={`panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => handleTabChange(item.id)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
                handleTabChange(next.id);
                document.getElementById(`tab-${next.id}`)?.focus();
              }}>
              {item.label}{item.id === "commentaries" && relevantCommentaries.length > 0 && <span className="tab-count">{relevantCommentaries.length}</span>}
            </button>
          ))}
        </div>
        {tab === "commentaries" && (
          <button
            type="button"
            className="commentary-wide-toggle"
            aria-label={wideCommentaries ? "Kommentárok teljes szélességének visszaállítása" : "Kommentárok teljes képernyőre"}
            aria-pressed={wideCommentaries}
            title={wideCommentaries ? "Teljes szélesség visszaállítása" : "Teljes képernyő"}
            onClick={() => setWideCommentaries((wide) => !wide)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {wideCommentaries ? (
                <path d="M8 3v5H3m18 0h-5V3M3 16h5v5m8 0v-5h5" />
              ) : (
                <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
              )}
            </svg>
          </button>
        )}
      </div>
      {!activeInfo && tab !== "commentaries" && <div className="panel-empty"><div className="seal">א</div>Kattints egy pászukra a kapcsolódó tartalomhoz.</div>}
      <div id="panel-questions" role="tabpanel" aria-labelledby="tab-questions" hidden={tab !== "questions" || !activeInfo}>
        {mapRef && <QuestionMap parasha={parasha} mapRef={mapRef} onDone={onMapDone} bookmarkTarget={bookmarkTarget} />}
      </div>
      <div id="panel-commentaries" role="tabpanel" aria-labelledby="tab-commentaries" hidden={tab !== "commentaries"}>
        {liveError && <p className="qmap-error" role="alert">{liveError}</p>}
        <button type="button" className="commentary-toggle" aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? "Csak a kiválasztott pászuk kommentárjai" : "Összes kommentár mutatása"}
        </button>
        {showAll && allCommentaries.length > 0 && (
          <nav className="commentary-toc" aria-label="Kommentárok tartalomjegyzéke">
            <h2>Tartalom</h2>
            <ol>
              {allCommentaries.map((c) => (
                <li key={c.id}>
                  <a href={`#${encodeURIComponent(`commentary-${c.id}`)}`} onClick={(event) => {
                    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    const panel = panelRef.current;
                    const target = document.getElementById(`commentary-${c.id}`);
                    if (!panel || !target) return;
                    target.focus({ preventScroll: true });
                    panel.scrollTo({
                      top: panel.scrollTop + target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 12,
                      behavior: "smooth",
                    });
                  }}>
                    {titles[c.id] || c.id.replace(/[-_]+/g, " ")}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}
        {!showAll && !activeInfo ? <p className="panel-message">Kattints egy pászukra, vagy mutasd az összes kommentárt.</p> :
          (showAll ? allCommentaries : relevantCommentaries).length ?
            (showAll ? allCommentaries : relevantCommentaries).map((c) => (
              <article key={c.id} id={`commentary-${c.id}`} className="commentary commentary-note" tabIndex={-1}>
                {showAll && c.verses.length > 0 && (
                  <div className="commentary-verse-links" aria-label="Ugrás a kommentár pászukához">
                    <span>Ugrás:</span>
                    {[...c.verses].sort((a, b) => a.chapter - b.chapter || a.verse - b.verse).map((v) => (
                      <button key={`${v.chapter}:${v.verse}`} type="button" onClick={() => onSelectVerse(v.chapter, v.verse)}
                        aria-label={`Ugrás a(z) ${v.chapter}:${v.verse} pászukhoz`}>
                        {v.chapter}:{v.verse}
                      </button>
                    ))}
                  </div>
                )}
                {isAdmin && editing === c.id ? (
                  <InlineEditor slug={parasha} kind="commentary" item={c.id}
                    focus={editFocus}
                    onClose={() => setEditing(undefined)}
                    onSaved={() => window.dispatchEvent(new Event("content-edited"))} />
                ) : (
                  <>
                    {isAdmin && <button type="button" className="screen-reader-only" onClick={() => {
                      if (!editing) { setEditFocus("title"); setEditing(c.id); }
                    }}>Kommentár szerkesztése: {titles[c.id] || c.id}</button>}
                    <div className={isAdmin ? "editable-commentary" : undefined}
                      title={isAdmin ? "Kattints a kommentár szerkesztéséhez" : undefined}
                      onClick={(event) => {
                        const target = event.target as HTMLElement;
                        if (!isAdmin || editing || target.closest("a, button, input, textarea")
                          || (window.getSelection() && !window.getSelection()?.isCollapsed)) return;
                        setEditFocus(target.closest("h1, h2, h3, h4, h5, h6") ? "title" : "body");
                        setEditing(c.id);
                      }}
                      dangerouslySetInnerHTML={{ __html: c.html }} />
                  </>
                )}
              </article>
            )) : <p className="panel-message">{showAll ? "Ehhez a hetiszakaszhoz még nincs kommentár." : "Ehhez a pászukhoz még nincs kommentár."}</p>}
      </div>
      <div id="panel-rashi" role="tabpanel" aria-labelledby="tab-rashi" hidden={tab !== "rashi" || !activeInfo}>
        {tab === "rashi" && activeInfo?.book && <RashiText book={activeInfo.book} chapter={activeInfo.chapter} verse={activeInfo.verse} />}
        {tab === "rashi" && activeInfo && !activeInfo.book && <p className="panel-message">Ehhez a könyvhöz nem érhető el Sefaria-hivatkozás.</p>}
      </div>
    </div>
  );
}
