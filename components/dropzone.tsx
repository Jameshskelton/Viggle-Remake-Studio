"use client";

import { useRef, useState } from "react";
import { uploadFile } from "../lib/client-api.ts";
import type { Asset, AssetKind } from "../lib/types.ts";

export function DropZone({
  kind,
  label,
  hint,
  accept,
  onUpload,
}: {
  kind: AssetKind;
  label: string;
  hint: string;
  accept: string;
  onUpload: (asset: Asset) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      onUpload(await uploadFile(file, kind, setProgress));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed.");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  return (
    <div>
      <div
        className={`drop${over ? " over" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") input.current?.click(); }}
        onDragOver={(event) => { event.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void handle(event.dataTransfer.files?.[0]);
        }}
      >
        <strong>{busy ? `Uploading... ${Math.round(progress * 100)}%` : label}</strong>
        <span>{hint}</span>
        {busy ? (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        ) : null}
      </div>
      <input
        ref={input}
        className="hidden"
        type="file"
        accept={accept}
        onChange={(event) => {
          void handle(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {error ? <p className="note err" style={{ marginTop: 8 }}>{error}</p> : null}
    </div>
  );
}
