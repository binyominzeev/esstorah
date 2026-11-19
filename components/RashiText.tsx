"use client";

import { useEffect, useState } from "react";

type Result = { ref: string; passages?: string[]; error?: string };

export default function RashiText({ book, chapter, verse }: { book: string; chapter: number; verse: number }) {
  const ref = `${book}.${chapter}.${verse}`;
  const [result, setResult] = useState<Result>();

  useEffect(() => {
    const controller = new AbortController();
    const url = `https://www.sefaria.org/api/v3/texts/Rashi_on_${ref}?version=hebrew`;
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) {
          const data = await response.json();
          if (data.error === `We have no text for Rashi on ${book} ${chapter}:${verse}.`) {
            setResult({ ref, passages: [] });
            return;
          }
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.versions)) throw new Error("Érvénytelen Sefaria-válasz");
        const version = data.versions.find((item: { language?: string }) => item.language === "he");
        const text = version?.text;
        if (text !== undefined && !Array.isArray(text) && typeof text !== "string") {
          throw new Error("Érvénytelen Rási-szöveg");
        }
        const passages = (typeof text === "string" ? [text] : text ?? [])
          .filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0);
        setResult({ ref, passages });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setResult({ ref, error: `A Rási-szöveg nem tölthető be: ${error.message}` });
      });
    return () => controller.abort();
  }, [book, chapter, ref, verse]);

  if (result?.ref !== ref) return <p className="panel-message" role="status">Rási betöltése…</p>;
  if (result.error) return <p className="qmap-error" role="alert">{result.error}</p>;
  if (!result.passages?.length) return <p className="panel-message">Ehhez a pászukhoz nincs elérhető Rási-kommentár.</p>;

  return (
    <div className="rashi-text" lang="he" dir="rtl">
      {result.passages.map((passage, index) => {
        const doc = new DOMParser().parseFromString(passage, "text/html");
        return <p key={index}>{Array.from(doc.body.childNodes).map((node, i) =>
          node.nodeName === "B" || node.nodeName === "STRONG"
            ? <strong key={i}>{node.textContent}</strong>
            : node.textContent
        )}</p>;
      })}
    </div>
  );
}
