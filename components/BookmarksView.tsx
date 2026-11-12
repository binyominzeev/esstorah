"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

export default function BookmarksView({ parashot }: { parashot: { slug: string; name: string }[] }) {
  const { ready, authenticated, bookmarks, login, toggleBookmark, error: authError } = useAuth();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const slug = new URLSearchParams(location.search).get("parasha");
    if (slug) setSelected(slug);
  }, []);

  const slugs = Array.from(new Set(bookmarks.map((item) => item.parasha)));
  const visible = selected ? slugs.filter((slug) => slug === selected) : slugs;
  const label = (slug: string) => parashot.find((item) => item.slug === slug)?.name ?? slug;
  const visibleCount = selected ? bookmarks.filter((item) => item.parasha === selected).length : bookmarks.length;

  return (
    <main className="content bookmarks">
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
                      return (
                        <li key={item.id} className="bookmark-item">
                          <div className="bookmark-body">
                            <div className="bookmark-meta">
                              <span className={`bookmark-kind ${item.kind}`}>{item.kind === "question" ? "Kérdés" : "Válasz"}</span>
                              <a href={`/${encodeURIComponent(slug)}/${chapter}/${verse}`}>{item.ref} <span aria-hidden="true">→</span></a>
                            </div>
                            <p>{item.text}</p>
                          </div>
                          <button type="button" className="bookmark-remove" aria-label={`${item.kind === "question" ? "Kérdés" : "Válasz"} eltávolítása: ${item.text.slice(0, 100)}`} onClick={() => {
                            setError("");
                            void toggleBookmark(item).catch((err: Error) => setError(err.message));
                          }}>Eltávolítás</button>
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
