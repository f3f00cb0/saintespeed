import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { DEFAULT_TRACK, parseTrack } from "../lib/track";
import { framePoints, jumpEditView } from "../lib/editView";
import { trackLength } from "../lib/race";
import { car } from "../lib/car";
import { sendTrack } from "../lib/net";

function fmtKm(m: number) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function EditorHud({ onPlay }: { onPlay: () => void }) {
  const track = useStore((s) => s.track);
  const checkpoints = useStore((s) => s.checkpoints);
  const selectedCp = useStore((s) => s.selectedCp);
  const library = useStore((s) => s.library);
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const len = trackLength(checkpoints);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Delete") return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const s = useStore.getState();
      if (s.selectedCp >= 0) s.removeCheckpoint(s.selectedCp);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const load = (t: typeof track) => {
    const s = useStore.getState();
    s.loadTrack(t);
    const cps = useStore.getState().checkpoints;
    if (cps.length) framePoints(cps);
    else jumpEditView(car.x, car.y, 280);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(track, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* presse-papiers refuse */
    }
  };

  const onImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseTrack(JSON.parse(String(reader.result)));
        if (parsed) load(parsed);
      } catch {
        /* json invalide */
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="editor">
      <div className="kicker">Éditeur de tracé</div>
      <input
        className="editor-name"
        value={track.name}
        onChange={(e) => useStore.getState().setTrackName(e.target.value)}
        spellCheck={false}
      />
      <div className="row">
        <span className="lbl">portiques</span>
        <span className="val">{checkpoints.length}</span>
      </div>
      <div className="row">
        <span className="lbl">boucle</span>
        <span className="val">{checkpoints.length >= 2 ? fmtKm(len) : "—"}</span>
      </div>

      <ol className="editor-list">
        {checkpoints.map((cp, i) => (
          <li
            key={cp.id}
            className={i === selectedCp ? "on" : ""}
            onClick={() => {
              useStore.getState().setSelectedCp(i);
              framePoints([cp]);
            }}
          >
            <span className="n">{i === 0 ? "D" : i}</span>
            <input
              value={cp.label}
              spellCheck={false}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => useStore.getState().setCheckpointLabel(i, e.target.value)}
            />
            <button type="button" onClick={() => useStore.getState().reorderCheckpoint(i, -1)} disabled={i === 0}>
              ↑
            </button>
            <button
              type="button"
              onClick={() => useStore.getState().reorderCheckpoint(i, 1)}
              disabled={i === checkpoints.length - 1}
            >
              ↓
            </button>
            <button type="button" className="danger" onClick={() => useStore.getState().removeCheckpoint(i)}>
              ×
            </button>
          </li>
        ))}
      </ol>
      {checkpoints.length === 0 && <p className="editor-empty">clic sur une rue pour poser un portique</p>}

      <div className="editor-actions">
        <button type="button" className="primary" onClick={onPlay} disabled={checkpoints.length < 2}>
          tester
        </button>
        <button
          type="button"
          onClick={() => sendTrack(useStore.getState().track)}
          disabled={checkpoints.length < 2}
        >
          partager
        </button>
        <button
          type="button"
          onClick={() => {
            useStore.getState().saveToLibrary();
            setSaved(true);
            window.setTimeout(() => setSaved(false), 1400);
          }}
        >
          {saved ? "enregistré" : "enregistrer"}
        </button>
        <button
          type="button"
          onClick={() => {
            useStore.getState().newTrack();
            jumpEditView(car.x, car.y, 280);
          }}
        >
          nouveau
        </button>
        <button type="button" onClick={copy}>
          {copied ? "copié" : "copier"}
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          importer
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="editor-lib">
        <div className="lbl">tracés</div>
        <button type="button" className="ghost" onClick={() => load(DEFAULT_TRACK)}>
          {DEFAULT_TRACK.name}
        </button>
        {library.map((t) => (
          <div key={t.id} className="librow">
            <button type="button" className="ghost" onClick={() => load(t)}>
              {t.name}
            </button>
            <button type="button" className="danger" onClick={() => useStore.getState().deleteFromLibrary(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="keys">
        <b>clic</b> poser · <b>glisser</b> déplacer · <b>clic droit</b> retirer
        <br />
        <b>ZQSD</b> / molette / clic droit : se déplacer · <b>E</b> tester
      </div>
    </div>
  );
}
