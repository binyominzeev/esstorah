"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

type Value = { revision: string; markdown?: string; title?: string; body?: string; level?: number };

export default function InlineEditor({ slug, kind, item, onClose, onSaved }: {
  slug: string;
  kind: "verse" | "commentary";
  item: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { request } = useAuth();
  const [value, setValue] = useState<Value>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const path = `/admin/content/${encodeURIComponent(slug)}/${kind}/${encodeURIComponent(item)}`;

  useEffect(() => {
    let active = true;
    setBusy(true);
    setValue(undefined);
    setError("");
    request(path).then((response) => response.json()).then((data: Value) => {
      if (active) setValue(data);
    }).catch((err: Error) => { if (active) setError(err.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [path, request]);

  async function save() {
    if (!value) return;
    setBusy(true);
    setError("");
    try {
      await request(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "A mentés nem sikerült.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-editor" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      {busy && <p role="status">Betöltés vagy mentés…</p>}
      {error && <p className="inline-editor-error" role="alert">{error}</p>}
      {value && (kind === "verse" ? (
        <label>Magyar fordítás ({item}) – Markdown
          <textarea value={value.markdown ?? ""} disabled={busy} onChange={(event) => setValue({ ...value, markdown: event.target.value })} />
        </label>
      ) : (
        <>
          <label>Címsor – Markdown
            <input value={value.title ?? ""} disabled={busy} onChange={(event) => setValue({ ...value, title: event.target.value })} />
          </label>
          <label>Tartalom – Markdown
            <textarea value={value.body ?? ""} disabled={busy} onChange={(event) => setValue({ ...value, body: event.target.value })} />
          </label>
        </>
      ))}
      <div className="inline-editor-actions">
        {value && <button type="button" disabled={busy} onClick={() => void save()}>Mentés</button>}
        <button type="button" disabled={busy} onClick={onClose}>Mégse</button>
      </div>
    </div>
  );
}
