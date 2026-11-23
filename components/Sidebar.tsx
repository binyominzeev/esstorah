"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NavBook } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import CommentaryUpload from "./CommentaryUpload";

export default function Sidebar({ nav }: { nav: NavBook[] }) {
  const pathname = usePathname();
  const activeSlug = pathname.split("/").filter(Boolean)[0] ?? "";
  const currentParasha = nav.some((book) => book.parashot.some((p) => p.slug === activeSlug));
  const [open, setOpen] = useState(false);
  const [openBooks, setOpenBooks] = useState<Set<string>>(new Set());
  const isFirstRender = useRef(true);
  const { ready, authenticated, isAdmin, name, error, login, logout } = useAuth();

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      // on mobile, show the menu open by default so it can be used without an extra tap
      if (window.matchMedia("(max-width: 980px)").matches) setOpen(true);
    } else {
      setOpen(false);
    }
    const owner = nav.find((book) => book.parashot.some((p) => p.slug === activeSlug));
    if (owner) {
      setOpenBooks((prev) => (prev.has(owner.name) ? prev : new Set(prev).add(owner.name)));
    }
  }, [activeSlug, nav]);

  function toggleBook(name: string) {
    setOpenBooks((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <>
      <button id="menu-toggle" onClick={() => setOpen((o) => !o)} aria-label="Menü">
        ☰
      </button>
      <div
        id="sidebar-overlay"
        className={open ? "open" : ""}
        onClick={() => setOpen(false)}
      />
      <div id="sidebar" className={open ? "open" : ""}>
        <h2>
          <Link href="/">EssTorah</Link>
        </h2>
        <div className="auth-controls">
          {authenticated && <span>Üdv, {name}!</span>}
          <div className="auth-actions">
            <button type="button" disabled={!ready} onClick={() => authenticated ? logout() : void login()}>
              {authenticated ? "Kilépés" : "Belépés / regisztráció"}
            </button>
            <Link href={currentParasha ? `/bookmarks?parasha=${encodeURIComponent(activeSlug)}` : "/bookmarks"} onClick={() => setOpen(false)}>Könyvjelzőim</Link>
            {isAdmin && <CommentaryUpload />}
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
        <ul>
          {nav.map((book) => (
            <li key={book.name} className={openBooks.has(book.name) ? "open" : ""}>
              <span className="book-toggle" onClick={() => toggleBook(book.name)}>
                {book.name}
              </span>
              <ul>
                {book.parashot.map((parasha) => (
                  <li key={parasha.slug}>
                    {parasha.available ? (
                      <Link
                        href={`/${parasha.slug}`}
                        className={parasha.slug === activeSlug ? "active" : ""}
                      >
                        {parasha.name}
                      </Link>
                    ) : (
                      <span className="nav-unavailable" title="Tartalom hamarosan érkezik">
                        {parasha.name}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
