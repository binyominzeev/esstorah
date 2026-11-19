"use client";

import { useEffect, useRef } from "react";
import type { CommentaryEntry } from "@/lib/types";
import QuestionMap from "./QuestionMap";
import RashiText from "./RashiText";

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
  activeInfo,
  tab,
  onTabChange,
  selectedCommentary,
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
  activeInfo?: { chapter: number; verse: number; book?: string };
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  selectedCommentary?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number; moved: boolean } | null>(null);
  const ignoreNextClickRef = useRef(false);
  const relevantCommentaries = commentaries.filter((c) =>
    c.verses.some((v) => v.chapter === activeInfo?.chapter && v.verse === activeInfo?.verse)
  );

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

  return (
    <div ref={panelRef} className={open ? "commentary-container open" : "commentary-container"}>
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
      <div className="panel-tabs" role="tablist" aria-label="Pászukhoz kapcsolódó tartalom">
        {tabs.map((item, index) => (
          <button key={item.id} id={`tab-${item.id}`} type="button" role="tab"
            aria-selected={tab === item.id} aria-controls={`panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => onTabChange(item.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
              onTabChange(next.id);
              document.getElementById(`tab-${next.id}`)?.focus();
            }}>
            {item.label}{item.id === "commentaries" && relevantCommentaries.length > 0 && <span className="tab-count">{relevantCommentaries.length}</span>}
          </button>
        ))}
      </div>
      {!activeInfo && <div className="panel-empty"><div className="seal">א</div>Kattints egy pászukra a kapcsolódó tartalomhoz.</div>}
      <div id="panel-questions" role="tabpanel" aria-labelledby="tab-questions" hidden={tab !== "questions" || !activeInfo}>
        {mapRef && <QuestionMap parasha={parasha} mapRef={mapRef} onDone={onMapDone} bookmarkTarget={bookmarkTarget} />}
      </div>
      <div id="panel-commentaries" role="tabpanel" aria-labelledby="tab-commentaries" hidden={tab !== "commentaries" || !activeInfo}>
        {relevantCommentaries.length ? relevantCommentaries.map((c) => (
          <article key={c.id} id={`commentary-${c.id}`} className="commentary commentary-note" dangerouslySetInnerHTML={{ __html: c.html }} />
        )) : <p className="panel-message">Ehhez a pászukhoz még nincs kommentár.</p>}
      </div>
      <div id="panel-rashi" role="tabpanel" aria-labelledby="tab-rashi" hidden={tab !== "rashi" || !activeInfo}>
        {tab === "rashi" && activeInfo?.book && <RashiText book={activeInfo.book} chapter={activeInfo.chapter} verse={activeInfo.verse} />}
        {tab === "rashi" && activeInfo && !activeInfo.book && <p className="panel-message">Ehhez a könyvhöz nem érhető el Sefaria-hivatkozás.</p>}
      </div>
    </div>
  );
}
