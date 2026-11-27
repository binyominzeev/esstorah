"use client";

import { useEffect, useRef } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "/api";

export default function SourceDialog({ source, onClose }: {
  source: { mapRef: string; ref: string } | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (source && !dialog.current?.open) dialog.current?.showModal();
    if (!source && dialog.current?.open) dialog.current.close();
  }, [source]);

  return (
    <dialog ref={dialog} className="source-dialog" aria-label="Forrásolvasó" onClose={onClose}>
      <div className="source-dialog-header">
        <button type="button" onClick={() => dialog.current?.close()}>← Vissza</button>
        <button type="button" aria-label="Forrásolvasó bezárása" onClick={() => dialog.current?.close()}>×</button>
      </div>
      {source && <iframe
        className="source-dialog-frame"
        title="Forrásolvasó"
        src={`${API}/map/${encodeURIComponent(source.mapRef)}/source?${new URLSearchParams({ ref: source.ref })}`}
      />}
    </dialog>
  );
}
