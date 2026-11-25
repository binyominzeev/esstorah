"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";

type Value = { revision: string; markdown?: string; title?: string; body?: string; level?: number };

function AutoTextarea({ value, onChange, label, disabled, focus, singleLine, className }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled: boolean;
  focus: boolean;
  singleLine?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight + textarea.offsetHeight - textarea.clientHeight}px`;
  }

  useLayoutEffect(resize, [value]);
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    let width = parent.getBoundingClientRect().width;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0].contentRect.width;
      if (nextWidth !== width) { width = nextWidth; resize(); }
    });
    observer.observe(parent);
    window.addEventListener("resize", resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
  }, []);

  return <textarea ref={ref} className={className} aria-label={label} rows={1} value={value}
    disabled={disabled} autoFocus={focus} onChange={(event) => onChange(event.target.value)}
    onKeyDown={(event) => { if (singleLine && event.key === "Enter") event.preventDefault(); }} />;
}

export default function InlineEditor({ slug, kind, item, focus = "body", onClose, onSaved }: {
  slug: string;
  kind: "verse" | "commentary";
  item: string;
  focus?: "title" | "body";
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
    <div className={`inline-editor inline-editor-${kind}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      {busy && <p role="status">Betöltés vagy mentés…</p>}
      {error && <p className="inline-editor-error" role="alert">{error}</p>}
      {value && (kind === "verse" ? (
        <AutoTextarea label={`Magyar fordítás (${item}) – Markdown, egy sor`} value={value.markdown ?? ""}
          disabled={busy} focus singleLine onChange={(markdown) => setValue({ ...value, markdown })} />
      ) : (
        <>
          <AutoTextarea className="inline-editor-title" label="Címsor – Markdown, egy sor" value={value.title ?? ""}
            disabled={busy} focus={focus === "title"} singleLine onChange={(title) => setValue({ ...value, title })} />
          <AutoTextarea label="Tartalom – Markdown" value={value.body ?? ""}
            disabled={busy} focus={focus === "body"} onChange={(body) => setValue({ ...value, body })} />
        </>
      ))}
      <div className="inline-editor-actions">
        {value && <button type="button" disabled={busy} onClick={() => void save()}>Mentés</button>}
        <button type="button" disabled={busy} onClick={onClose}>Mégse</button>
        {value && <span>Markdown{kind === "verse" ? " · egy sor" : ""}</span>}
      </div>
    </div>
  );
}
