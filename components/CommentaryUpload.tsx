"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";

type Note = { number: number; refs: string; markdown: string; selected: boolean };
type Preview = { parasha: string; book: string; notes: Note[] };

export default function CommentaryUpload() {
  const { request } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<{ filename: string; text: string }>();
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return () => { if (dialogRef.current?.open) dialogRef.current.close(); };
  }, []);

  async function chooseFile(file: File) {
    setError("");
    setMessage("");
    setPreview(undefined);
    setSource(undefined);
    dialogRef.current?.showModal();
    setBusy(true);
    try {
      if (!file.name.toLowerCase().endsWith(".md") || file.size > 1_000_000) {
        throw new Error("Válassz legfeljebb 1 MB méretű Markdown (.md) fájlt.");
      }
      const text = await file.text();
      const nextSource = { filename: file.name, text };
      const response = await request("/admin/commentaries/preview", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextSource),
      });
      const data: Preview = await response.json();
      setSource(nextSource);
      setPreview({ ...data, notes: data.notes.map((note) => ({ ...note, selected: true })) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Az előnézet nem készíthető el.");
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (!source || !preview) return;
    setBusy(true);
    setError("");
    try {
      const selected = preview.notes.filter((note) => note.selected).map(({ number, markdown }) => ({ number, markdown }));
      const response = await request("/admin/commentaries", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...source, selected }),
      });
      const result: { count: number; parasha: string } = await response.json();
      setPreview(undefined);
      setMessage(`${result.count} kommentár feltöltve: ${result.parasha}.`);
      window.dispatchEvent(new Event("commentaries-uploaded"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "A feltöltés nem sikerült.");
    } finally {
      setBusy(false);
    }
  }

  function updateNote(number: number, patch: Partial<Note>) {
    setPreview((current) => current && {
      ...current, notes: current.notes.map((note) => note.number === number ? { ...note, ...patch } : note),
    });
  }

  return (
    <>
      <button type="button" className="upload-trigger" onClick={() => inputRef.current?.click()}>Feltöltés</button>
      <input ref={inputRef} type="file" accept=".md,text/markdown" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void chooseFile(file);
      }} />
      <dialog ref={dialogRef} className="upload-dialog" aria-labelledby="upload-title"
        onCancel={(event) => { if (busy) event.preventDefault(); }}>
        <div className="upload-dialog-header">
          <h2 id="upload-title">Kommentárok feltöltése</h2>
          <button type="button" aria-label="Bezárás" disabled={busy} onClick={() => dialogRef.current?.close()}>×</button>
        </div>
        {busy && <p role="status">Feldolgozás…</p>}
        {error && <p className="upload-error" role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        {preview && (
          <>
            <p>Hetiszakasz: <strong>{preview.book} · {preview.parasha}</strong></p>
            <p>Válaszd ki és szükség esetén szerkeszd a kommentárokat. A vershivatkozások az eredeti fájlból származnak.</p>
            <div className="upload-notes">
              {preview.notes.map((note) => (
                <div className="upload-note" key={note.number}>
                  <label><input type="checkbox" checked={note.selected} disabled={busy}
                    onChange={(event) => updateNote(note.number, { selected: event.target.checked })} />
                    <span>{note.number}. {note.markdown.split("\n")[0].replace(/^##\s*/, "")} <small>({note.refs})</small></span>
                  </label>
                  <details>
                    <summary>Olvasás és szerkesztés</summary>
                    <label className="upload-editor-label" htmlFor={`upload-note-${note.number}`}>Markdown</label>
                    <textarea id={`upload-note-${note.number}`} value={note.markdown} disabled={busy}
                      onChange={(event) => updateNote(note.number, { markdown: event.target.value })} />
                  </details>
                </div>
              ))}
            </div>
            <div className="upload-actions">
              <button type="button" disabled={busy || !preview.notes.some((note) => note.selected)} onClick={() => void upload()}>
                Kijelöltek feltöltése ({preview.notes.filter((note) => note.selected).length})
              </button>
              <button type="button" disabled={busy} onClick={() => dialogRef.current?.close()}>Mégse</button>
            </div>
          </>
        )}
        {!preview && !busy && <button type="button" onClick={() => dialogRef.current?.close()}>Bezárás</button>}
      </dialog>
    </>
  );
}
