"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { frameStyles } from "@/lib/frameStyles";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

type Status = { state: "none" | "queued" | "running" | "done" | "error"; stage?: string; progress?: number; error?: string };

export default function QuestionMap({
  parasha,
  mapRef,
  onDone,
  bookmarkTarget,
}: {
  parasha: string;
  mapRef: string;
  onDone?: (ref: string) => void;
  bookmarkTarget?: { ref: string; kind: "question" | "answer"; text: string };
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [bookmarkError, setBookmarkError] = useState("");
  const { authenticated, bookmarks, toggleBookmark } = useAuth();
  const frame = useRef<HTMLIFrameElement>(null);
  const frameReady = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef(mapRef);
  current.current = mapRef;

  // Responses for a verse the user already left are ignored.
  const call = useCallback(async (ref: string, method: "GET" | "POST", suffix = ""): Promise<Status | null> => {
    let s: Status;
    try {
      const r = await fetch(`${API}/map/${ref}${suffix}`, { method });
      s = r.ok
        ? await r.json()
        : { state: "error", error: r.status === 429 ? "A napi keret elfogyott, próbáld holnap." : undefined };
    } catch {
      s = { state: "error", error: "A szerver nem elérhető." };
    }
    if (current.current !== ref) return null;
    setStatus(s);
    return s;
  }, [onDone]);

  const poll = useCallback(
    async (ref: string) => {
      const s = await call(ref, "GET");
      if (s && (s.state === "queued" || s.state === "running")) {
        timer.current = setTimeout(() => poll(ref), 2000);
      }
    },
    [call],
  );

  // On every verse change, check the server: show a finished map, resume a running job.
  useEffect(() => {
    frameReady.current = false;
    setStatus(null);
    poll(mapRef);
    return () => clearTimeout(timer.current);
  }, [mapRef, poll]);

  async function generate() {
    clearTimeout(timer.current);
    const s = await call(mapRef, "POST");
    if (s && (s.state === "queued" || s.state === "running")) {
      timer.current = setTimeout(() => poll(mapRef), 1500);
    }
  }

  async function refresh() {
    clearTimeout(timer.current);
    const s = await call(mapRef, "POST", "/refresh");
    if (s && (s.state === "queued" || s.state === "running")) {
      timer.current = setTimeout(() => poll(mapRef), 1500);
    }
  }

  const busy = status?.state === "queued" || status?.state === "running";
  const done = status?.state === "done";
  const htmlUrl = `${API}/map/${mapRef}/html`;
  const sendBookmarkState = useCallback(() => {
    frame.current?.contentWindow?.postMessage({
      type: "esstorah-bookmark-state",
      authenticated,
      items: bookmarks.filter((item) => item.parasha === parasha && item.ref === mapRef),
    }, "*");
  }, [authenticated, bookmarks, parasha, mapRef]);

  const sendBookmarkTarget = useCallback(() => {
    if (bookmarkTarget?.ref !== mapRef) return;
    frame.current?.contentWindow?.postMessage({
      type: "esstorah-bookmark-open",
      kind: bookmarkTarget.kind,
      text: bookmarkTarget.text,
    }, "*");
  }, [bookmarkTarget, mapRef]);

  useEffect(() => {
    if (frameReady.current) sendBookmarkTarget();
  }, [sendBookmarkTarget]);

  const sendFonts = useCallback(() => {
    void frameStyles().then((styles) => {
      frame.current?.contentWindow?.postMessage({ type: "esstorah-bookmark-fonts", styles }, "*");
    }).catch((error: Error) => console.error("Could not load question-map fonts:", error));
  }, []);

  useEffect(() => {
    sendBookmarkState();
    function onMessage(event: MessageEvent) {
      if (event.origin !== "null" || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "esstorah-bookmark-ready") {
        frameReady.current = true;
        sendBookmarkState();
        sendFonts();
        sendBookmarkTarget();
      } else if (event.data?.type === "esstorah-bookmark-toggle") {
        if (!authenticated) {
          setBookmarkError("A könyvjelzőzéshez jelentkezz be.");
          return;
        }
        const { kind, text } = event.data;
        if ((kind !== "question" && kind !== "answer") || typeof text !== "string" || !text.trim()) return;
        setBookmarkError("");
        void toggleBookmark({ parasha, ref: mapRef, kind, text }).catch((error: Error) => setBookmarkError(error.message));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [authenticated, mapRef, parasha, sendBookmarkState, sendBookmarkTarget, sendFonts, toggleBookmark]);

  return (
    <div className="qmap">
      {status && !done && (
        <button type="button" className="qmap-btn" onClick={generate} disabled={busy}>
          AI kérdés-válasz kommentár
        </button>
      )}
      {(done || busy) && (
        <button type="button" className="qmap-btn" onClick={refresh} disabled={busy}>
          Frissítés
        </button>
      )}
      {busy && (
        <div className="qmap-progress" role="status">
          <div className="qmap-bar">
            <div style={{ width: `${status?.progress ?? 0}%` }} />
          </div>
          <span>{status?.stage}</span>
        </div>
      )}
      {status?.state === "error" && <p className="qmap-error">{status.error ?? "A generálás nem sikerült."}</p>}
      {bookmarkError && <p className="qmap-error" role="alert">{bookmarkError}</p>}
      {done && (
        <>
          <a className="qmap-open" href={htmlUrl} target="_blank" rel="noreferrer">
            Megnyitás új lapon
          </a>
          <iframe key={mapRef} ref={frame} className="qmap-frame" src={htmlUrl} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" onLoad={() => { frameReady.current = true; sendBookmarkState(); sendFonts(); sendBookmarkTarget(); }} title={`Kérdés-térkép ${mapRef}`} />
        </>
      )}
    </div>
  );
}
