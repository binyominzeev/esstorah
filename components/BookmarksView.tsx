"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { frameStyles } from "@/lib/frameStyles";
import SourceDialog from "./SourceDialog";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

export default function BookmarksView({ parashot }: { parashot: { slug: string; name: string }[] }) {
  const { ready, authenticated, bookmarks, login, toggleBookmark, error: authError } = useAuth();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [source, setSource] = useState<{ mapRef: string; ref: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const previewFrames = useRef(new Map<number, HTMLIFrameElement>());

  useEffect(() => {
    const slug = new URLSearchParams(location.search).get("parasha");
    if (slug) setSelected(slug);
  }, []);

  const slugs = Array.from(new Set(bookmarks.map((item) => item.parasha)));
  const visible = selected ? slugs.filter((slug) => slug === selected) : slugs;
  const label = (slug: string) => parashot.find((item) => item.slug === slug)?.name ?? slug;
  const visibleCount = selected ? bookmarks.filter((item) => item.parasha === selected).length : bookmarks.length;

  const sendPreviewState = useCallback((frame: HTMLIFrameElement, parasha: string, ref: string) => {
    frame.contentWindow?.postMessage({ type: "esstorah-source-dialog-ready" }, "*");
    frame.contentWindow?.postMessage({
      type: "esstorah-bookmark-state",
      authenticated,
      items: bookmarks.filter((item) => item.parasha === parasha && item.ref === ref),
    }, "*");
  }, [authenticated, bookmarks]);

  useEffect(() => {
    for (const [id, frame] of previewFrames.current) {
      const item = bookmarks.find((bookmark) => bookmark.id === id);
      if (item) sendPreviewState(frame, item.parasha, item.ref);
    }
  }, [sendPreviewState]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== "null") return;
      for (const [id, frame] of previewFrames.current) {
        if (event.source !== frame.contentWindow) continue;
        const item = bookmarks.find((bookmark) => bookmark.id === id);
        if (item && event.data?.type === "esstorah-source-open" && typeof event.data.ref === "string" && event.data.ref.trim()) {
          setSource({ mapRef: item.ref, ref: event.data.ref });
          return;
        }
        if (event.data?.type !== "esstorah-bookmark-toggle") return;
        const { kind, text } = event.data;
        if (!item || (kind !== "question" && kind !== "answer") || typeof text !== "string" || !text.trim()) return;
        if (!authenticated) {
          setError("A könyvjelzőzéshez jelentkezz be.");
          return;
        }
        setError("");
        void toggleBookmark({ parasha: item.parasha, ref: item.ref, kind, text })
          .catch((err: Error) => setError(err.message));
        return;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [authenticated, bookmarks, toggleBookmark]);

  function toggleExpanded(id: number) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main className="content bookmarks">
      <SourceDialog source={source} onClose={() => setSource(null)} />
      <div className="bookmarks-inner">
        <header className="bookmarks-header">
          <div>
            <p className="bookmarks-eyebrow">Saját gyűjtemény</p>
            <h1>Könyvjelzőim</h1>
          </div>
          {ready && authenticated && <span className="bookmarks-total">{visibleCount} mentés</span>}
        </header>
        {authError && <p className="bookmarks-error" role="alert">{authError}</p>}
        {!ready ? <p className="bookmarks-empty">Betöltés…</p> : !authenticated ? (
          <div className="bookmarks-empty">
            <p>Jelentkezz be a könyvjelzőid megtekintéséhez.</p>
            <button type="button" className="bookmarks-login" onClick={() => void login()}>Belépés / regisztráció</button>
          </div>
        ) : (
          <>
            <label className="bookmarks-filter">
              <span>Hetiszakasz</span>
              <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                <option value="">Összes hetiszakasz</option>
                {slugs.map((slug) => <option key={slug} value={slug}>{label(slug)}</option>)}
                {selected && !slugs.includes(selected) && <option value={selected}>{label(selected)}</option>}
              </select>
            </label>
            {error && <p className="bookmarks-error" role="alert">{error}</p>}
            {visible.length === 0 && <p className="bookmarks-empty">Ehhez a választáshoz még nincs könyvjelződ.</p>}
            {visible.map((slug) => {
              const items = bookmarks.filter((item) => item.parasha === slug);
              return (
                <section key={slug} className="bookmark-group">
                  <div className="bookmark-group-heading">
                    <h2>{label(slug)}</h2>
                    <span>{items.length} mentés</span>
                  </div>
                  <ul>
                    {items.map((item) => {
                      const [, chapter, verse] = item.ref.split(".");
                      const previewOpen = expanded.has(item.id);
                      const targetHash = new URLSearchParams({
                        bookmarkRef: item.ref,
                        bookmarkKind: item.kind,
                        bookmarkText: item.text,
                      }).toString();
                      return (
                        <li key={item.id} className="bookmark-item">
                          <div className="bookmark-body">
                            <div className="bookmark-meta">
                              <span className={`bookmark-kind ${item.kind}`}>{item.kind === "question" ? "Kérdés" : "Válasz"}</span>
                              <a href={`/${encodeURIComponent(slug)}/${chapter}/${verse}#${targetHash}`}>{item.ref} <span aria-hidden="true">→</span></a>
                            </div>
                            <p>{item.text}</p>
                          </div>
                          <div className="bookmark-actions">
                            <button
                              type="button"
                              className="bookmark-expand"
                              aria-expanded={previewOpen}
                              aria-controls={`bookmark-preview-${item.id}`}
                              onClick={() => toggleExpanded(item.id)}
                            >
                              {previewOpen ? "Összecsukás" : "Kibontás"}
                            </button>
                            <button type="button" className="bookmark-remove" aria-label={`${item.kind === "question" ? "Kérdés" : "Válasz"} eltávolítása: ${item.text.slice(0, 100)}`} onClick={() => {
                              setError("");
                              void toggleBookmark(item).catch((err: Error) => setError(err.message));
                            }}>Eltávolítás</button>
                          </div>
                          {previewOpen && (
                            <div id={`bookmark-preview-${item.id}`} className="bookmark-preview">
                              <iframe
                                ref={(frame) => {
                                  if (frame) previewFrames.current.set(item.id, frame);
                                  else previewFrames.current.delete(item.id);
                                }}
                                className="bookmark-preview-frame"
                                src={`${API}/map/${item.ref}/html`}
                                sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                                title={`${item.ref} – ${item.kind === "question" ? "kérdés" : "válasz"} előnézete`}
                                onLoad={(event) => {
                                  const frame = event.currentTarget;
                                  sendPreviewState(frame, item.parasha, item.ref);
                                  void frameStyles().then((styles) => {
                                    frame.contentWindow?.postMessage({ type: "esstorah-bookmark-fonts", styles }, "*");
                                  }).catch((err: Error) => console.error("Could not load question-map fonts:", err));
                                  frame.contentWindow?.postMessage({
                                    type: "esstorah-bookmark-open",
                                    kind: item.kind,
                                    text: item.text,
                                    focus: true,
                                  }, "*");
                                }}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </div>
    </main>
  );
}
