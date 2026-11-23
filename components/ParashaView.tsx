"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommentaryEntry, RowData } from "@/lib/types";
import { safeMarkdownToHtml } from "@/lib/safeMarkdown";
import BilingualTable from "./BilingualTable";
import CommentaryPanel from "./CommentaryPanel";

interface ActiveInfo {
  chapter: number;
  verse: number;
  book?: string;
}

interface BookmarkTarget {
  ref: string;
  kind: "question" | "answer";
  text: string;
}

/** One static page serves every /slug, /slug/chapter and /slug/chapter/verse URL (nginx maps them all here); this parses which one it is on mount. */
function parseLocation(slug: string): { chapter: number; verse: number | null } | null {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] !== slug) return null;
  const chapter = Number(parts[1]);
  if (!parts[1] || Number.isNaN(chapter)) return null;
  const verse = parts[2] !== undefined ? Number(parts[2]) : null;
  return { chapter, verse: verse !== null && !Number.isNaN(verse) ? verse : null };
}

export default function ParashaView({
  slug,
  rows,
  commentaries,
  chapters,
}: {
  slug: string;
  chapters: number[];
  rows: RowData[];
  commentaries: CommentaryEntry[];
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeInfo, setActiveInfo] = useState<ActiveInfo | undefined>();
  const [currentChapter, setCurrentChapter] = useState<number | null>(null);
  const [aiDone, setAiDone] = useState<Set<string>>(new Set());
  const [bookmarkTarget, setBookmarkTarget] = useState<BookmarkTarget | undefined>();
  const [panelTab, setPanelTab] = useState<"questions" | "commentaries" | "rashi">("questions");
  const [selectedCommentary, setSelectedCommentary] = useState<string>();
  const [liveCommentaries, setLiveCommentaries] = useState<CommentaryEntry[]>([]);
  const [liveError, setLiveError] = useState("");
  const allCommentaries = useMemo(
    () => [...commentaries.filter((c) => !liveCommentaries.some((live) => live.id === c.id)), ...liveCommentaries],
    [commentaries, liveCommentaries],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const commentaryScrollRef = useRef<{ href: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const api = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
        const response = await fetch(`${api}/commentaries/${encodeURIComponent(slug)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: { commentaries: { id: string; markdown: string; verses: CommentaryEntry["verses"] }[] } = await response.json();
        if (active) {
          setLiveCommentaries(data.commentaries.map((c) => ({ id: c.id, html: safeMarkdownToHtml(c.markdown), verses: c.verses })));
          setLiveError("");
        }
      } catch {
        if (active) setLiveError("A frissen feltöltött kommentárok nem tölthetők be.");
      }
    }
    void load();
    window.addEventListener("commentaries-uploaded", load);
    return () => { active = false; window.removeEventListener("commentaries-uploaded", load); };
  }, [slug]);

  // Verses that already have an AI summary: loaded once, then extended whenever a map finishes.
  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
    fetch(`${api}/maps`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { done: string[] } | null) => {
        if (d) setAiDone((prev) => new Set([...prev, ...d.done]));
      })
      .catch(() => {});
  }, []);

  const markAiDone = useCallback((ref: string) => {
    setAiDone((prev) => (prev.has(ref) ? prev : new Set(prev).add(ref)));
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll<HTMLElement>("a.verse-link[data-book]").forEach((a) => {
      const { book, chapter, verse } = a.dataset;
      const key = `${book}.${chapter}.${verse}`;
      const on = aiDone.has(key);
      const cls = `vrs-ch${chapter}-vrs${verse}`;
      a.classList.toggle("has-ai", on);
      container.querySelectorAll(`.${cls}`).forEach((n) => n.classList.toggle("has-ai", on));
    });
  }, [aiDone, rows]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const refs = new Set(allCommentaries.flatMap((c) => c.verses.map((v) => `${v.chapter}:${v.verse}`)));
    container.querySelectorAll<HTMLElement>("[data-href][data-chapter][data-verse]").forEach((el) => {
      const hasCommentary = refs.has(`${el.dataset.chapter}:${el.dataset.verse}`);
      el.classList.toggle("has-commentary", hasCommentary);
      if (hasCommentary) el.title = "Ehhez a pászukhoz kommentár tartozik";
    });
  }, [commentaries, liveCommentaries, rows]);

  function goToChapter(chapter: number) {
    containerRef.current
      ?.querySelector<HTMLElement>(`#chapter-${chapter}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearActive() {
    containerRef.current?.querySelectorAll(".active-verse").forEach((el) => el.classList.remove("active-verse"));
    containerRef.current?.querySelectorAll("tr.active-row").forEach((el) => el.classList.remove("active-row"));
  }

  function activateVerse(chapter: number, verse: number, scroll: boolean) {
    const container = containerRef.current;
    if (!container) return;
    clearActive();
    const anchor = container.querySelector<HTMLElement>(`#ch${chapter}-vrs${verse}`);
    const huNumber = container.querySelector<HTMLElement>(`strong.vrs-ch${chapter}-vrs${verse}`);
    anchor?.classList.add("active-verse");
    huNumber?.classList.add("active-verse");
    anchor?.closest("tr")?.classList.add("active-row");
    const book = anchor?.dataset.book;
    setActiveInfo({ chapter, verse, book });
    setPanelOpen(true);
    if (scroll) anchor?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Initial load: highlight/scroll to whatever the URL (set by nginx's chapter/verse rewrite) asked for.
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const ref = params.get("bookmarkRef");
    const kind = params.get("bookmarkKind");
    const text = params.get("bookmarkText");
    if (ref && (kind === "question" || kind === "answer") && text?.trim()) {
      setBookmarkTarget({ ref, kind, text });
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    }

    const target = parseLocation(slug);
    if (!target) return;
    if (target.verse !== null) {
      activateVerse(target.chapter, target.verse, true);
    } else {
      containerRef.current
        ?.querySelector<HTMLElement>(`#chapter-${target.chapter}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Keep the URL in sync with whichever verse is currently in view while scrolling,
  // without pushing new history entries or touching the active-verse highlight.
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    let ticking = false;
    let skipUrlUpdate = false;
    function updateFromScroll() {
      ticking = false;
      const skipUrl = skipUrlUpdate;
      skipUrlUpdate = false;
      let headingChapter: number | null = null;
      container!.querySelectorAll<HTMLElement>('h1[id^="chapter-"]').forEach((h) => {
        if (h.getBoundingClientRect().top - 140 <= 0) headingChapter = Number(h.id.slice(8));
      });
      if (headingChapter !== null) setCurrentChapter(headingChapter);
      const anchors = container!.querySelectorAll<HTMLAnchorElement>("a.verse-link[data-chapter]");
      if (!anchors.length) return;
      const threshold = 140;
      let current: HTMLAnchorElement = anchors[0];
      anchors.forEach((a) => {
        if (a.getBoundingClientRect().top - threshold <= 0) current = a;
      });
      const { chapter, verse } = current.dataset;
      if (headingChapter === null && chapter) setCurrentChapter(Number(chapter));
      if (!chapter || !verse) return;
      if (skipUrl || commentaryScrollRef.current) return;
      const href = `/${encodeURIComponent(slug)}/${chapter}/${verse}`;
      if (window.location.pathname !== href) {
        window.history.replaceState(window.history.state, "", href);
      }
    }
    function onScroll() {
      if (commentaryScrollRef.current) skipUrlUpdate = true;
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(updateFromScroll);
    }
    function cancelCommentaryScroll() {
      if (!commentaryScrollRef.current) return;
      clearTimeout(commentaryScrollRef.current.timer);
      commentaryScrollRef.current = null;
    }
    function finishCommentaryScroll() {
      const target = commentaryScrollRef.current;
      if (!target) return;
      cancelCommentaryScroll();
      window.history.replaceState(window.history.state, "", target.href);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    content.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scrollend", finishCommentaryScroll);
    content.addEventListener("scrollend", finishCommentaryScroll);
    window.addEventListener("wheel", cancelCommentaryScroll, { passive: true });
    window.addEventListener("touchstart", cancelCommentaryScroll, { passive: true });
    window.addEventListener("keydown", cancelCommentaryScroll);
    window.addEventListener("popstate", cancelCommentaryScroll);
    return () => {
      cancelCommentaryScroll();
      window.removeEventListener("scroll", onScroll);
      content.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", finishCommentaryScroll);
      content.removeEventListener("scrollend", finishCommentaryScroll);
      window.removeEventListener("wheel", cancelCommentaryScroll);
      window.removeEventListener("touchstart", cancelCommentaryScroll);
      window.removeEventListener("keydown", cancelCommentaryScroll);
      window.removeEventListener("popstate", cancelCommentaryScroll);
    };
  }, [slug, rows]);

  function extractVerseKey(el: Element): string | null {
    const id = el.getAttribute("id");
    if (id && /^ch\d+-vrs\d+$/.test(id)) return id;
    const cls = Array.from(el.classList).find((c) => /^vrs-ch\d+-vrs\d+$/.test(c));
    return cls ? cls.slice(4) : null;
  }

  function setHover(target: EventTarget | null, on: boolean) {
    const el = (target as HTMLElement | null)?.closest('[id^="ch"], [class*="vrs-ch"]');
    if (!el) return;
    const key = extractVerseKey(el);
    if (!key) return;
    containerRef.current?.querySelectorAll(`[id="${key}"], .vrs-${key}`).forEach((node) => {
      node.classList.toggle("verse-hover", on);
    });
  }

  function handleClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;

    const commentaryEl = target.closest("[data-commentary-id]") as HTMLElement | null;
    if (commentaryEl) {
      e.preventDefault();
      const id = commentaryEl.getAttribute("data-commentary-id")!;
      const verseText = commentaryEl.closest('[class*="vrs-ch"]');
      const key = verseText && extractVerseKey(verseText);
      const match = key?.match(/^ch(\d+)-vrs(\d+)$/);
      if (match) {
        window.history.pushState(null, "", `/${encodeURIComponent(slug)}/${match[1]}/${match[2]}`);
        activateVerse(Number(match[1]), Number(match[2]), false);
      }
      else setPanelOpen(true);
      setSelectedCommentary(id);
      setPanelTab("commentaries");
      return;
    }

    const verseEl = target.closest("[data-href][data-chapter][data-verse]") as HTMLElement | null;
    if (verseEl) {
      e.preventDefault();
      const chapter = Number(verseEl.dataset.chapter);
      const verse = Number(verseEl.dataset.verse);
      window.history.pushState(null, "", verseEl.dataset.href!);
      setSelectedCommentary(undefined);
      activateVerse(chapter, verse, false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") return;
    handleClick(e as unknown as React.MouseEvent);
  }

  const sefariaHref =
    activeInfo && activeInfo.book
      ? `https://www.sefaria.org/${activeInfo.book}.${activeInfo.chapter}.${activeInfo.verse}`
      : undefined;
  const sefariaLabel = activeInfo ? `${activeInfo.book ?? ""} ${activeInfo.chapter}:${activeInfo.verse}` : undefined;

  const mapRef = activeInfo && activeInfo.book ? `${activeInfo.book}.${activeInfo.chapter}.${activeInfo.verse}` : undefined;

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseOver={(e) => setHover(e.target, true)}
      onMouseOut={(e) => setHover(e.target, false)}
    >
      {chapters.length > 1 && (
        <nav id="chapter-bar" aria-label="Fejezetek">
          {chapters.map((c) => (
            <button
              key={c}
              type="button"
              className={c === currentChapter ? "current" : ""}
              aria-current={c === currentChapter ? "true" : undefined}
              onClick={() => goToChapter(c)}
            >
              {c}
            </button>
          ))}
        </nav>
      )}
      <div ref={contentRef} className="content reader-content" role="region" aria-label="Tóraszöveg" tabIndex={0}>
        <BilingualTable rows={rows} />
      </div>
      <CommentaryPanel
        parasha={slug}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        sefariaHref={sefariaHref}
        sefariaLabel={sefariaLabel}
        mapRef={mapRef}
        onMapDone={markAiDone}
        bookmarkTarget={bookmarkTarget}
        commentaries={allCommentaries}
        liveError={liveError}
        activeInfo={activeInfo}
        tab={panelTab}
        onTabChange={setPanelTab}
        selectedCommentary={selectedCommentary}
        onSelectVerse={(chapter, verse) => {
          setSelectedCommentary(undefined);
          const href = `/${encodeURIComponent(slug)}/${chapter}/${verse}`;
          if (commentaryScrollRef.current) clearTimeout(commentaryScrollRef.current.timer);
          const timer = setTimeout(() => {
            if (commentaryScrollRef.current?.href !== href) return;
            commentaryScrollRef.current = null;
            window.history.replaceState(window.history.state, "", href);
          }, 8000);
          commentaryScrollRef.current = { href, timer };
          window.history.pushState(null, "", href);
          activateVerse(chapter, verse, true);
        }}
      />
    </div>
  );
}
