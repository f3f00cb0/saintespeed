import { useEffect, useState, useSyncExternalStore } from "react";
import { useStore } from "../state/store";
import { onPeers, peerListKey, peers } from "../lib/peers";
import { countdownLeft } from "../lib/session";
import { launchRace } from "../lib/net";

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function hex(n: number) {
  return "#" + n.toString(16).padStart(6, "0");
}

function Countdown({ gen }: { gen: number }) {
  const [left, setLeft] = useState(countdownLeft);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const n = countdownLeft();
      setLeft(n);
      if (n > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gen]);
  if (left <= 0) return null;
  return <div className="go">{Math.ceil(left / 1000)}</div>;
}

export function Hud({ onEdit }: { onEdit: () => void }) {
  const tele = useStore((s) => s.tele);
  const lapTime = useStore((s) => s.lapTime);
  const bestLap = useStore((s) => s.bestLap);
  const laps = useStore((s) => s.laps);
  const nextCp = useStore((s) => s.nextCp);
  const checkpoints = useStore((s) => s.checkpoints);
  const running = useStore((s) => s.running);
  const source = useStore((s) => s.source);
  const netStatus = useStore((s) => s.netStatus);
  const netCount = useStore((s) => s.netCount);
  const goGen = useStore((s) => s.goGen);
  const peerKey = useSyncExternalStore(onPeers, peerListKey, peerListKey);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (netStatus !== "on" || !peerKey) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [netStatus, peerKey]);

  const cp = checkpoints[nextCp];
  const speed = Math.max(0, Math.round(Math.abs(tele.speedKmh)));
  const others = peerKey ? peerKey.split(",").map((id) => peers.get(id)).filter(Boolean) : [];
  void tick;

  const netLabel =
    netStatus === "on" ? (netCount > 1 ? `${netCount} en ligne` : "en ligne") : netStatus === "lost" ? "reconnexion…" : "";

  return (
    <>
      <div className="hud tl">
        <div className="kicker">Saint-Étienne · réseau OSM</div>
        <div className="chrono">{fmt(lapTime)}</div>
        <div className="row">
          <span className="lbl">meilleur</span>
          <span className="val">{bestLap === null ? "—" : fmt(bestLap)}</span>
        </div>
        <div className="row">
          <span className="lbl">tours</span>
          <span className="val">{laps.length}</span>
        </div>
        {netLabel && (
          <div className="row">
            <span className="lbl">salon</span>
            <span className="val">{netLabel}</span>
          </div>
        )}
        {others.length > 0 && (
          <ul className="peers">
            {others.map((p) => (
              <li key={p!.id}>
                <i style={{ background: hex(p!.color) }} />
                <span>{p!.name}</span>
                <span className="peer-time">{p!.running ? fmt(p!.lapTime) : "—"}</span>
              </li>
            ))}
          </ul>
        )}
        {checkpoints.length >= 2 && (
          <button type="button" className="go-btn" onClick={launchRace}>
            lancer
          </button>
        )}
      </div>

      <div className="hud tr">
        <div className="speedo">
          <span className="n">{speed}</span>
          <span className="u">km/h</span>
        </div>
        <div className="fps">{Math.round(tele.fps)} fps</div>
        <div className={"road" + (tele.offroad ? " off" : "")}>
          {tele.offroad ? "HORS PISTE" : tele.roadName || tele.roadType || "—"}
        </div>
      </div>

      {cp && (
        <div className="hud br">
          <div className="cpwrap">
            <svg viewBox="-50 -50 100 100" className="arrow">
              <g transform={`rotate(${(-tele.cpBearing * 180) / Math.PI})`}>
                <path d="M0,-34 L20,22 L0,10 L-20,22 Z" fill="#ff5d3b" />
              </g>
              <circle cx="0" cy="0" r="46" fill="none" stroke="#33352a" strokeWidth="2" />
            </svg>
            <div className="cpinfo">
              <div className="lbl">
                checkpoint {nextCp === 0 ? "arrivée" : `${nextCp}/${checkpoints.length - 1}`}
              </div>
              <div className="name">{cp.label}</div>
              <div className="dist">
                {tele.cpDist > 999
                  ? (tele.cpDist / 1000).toFixed(2) + " km"
                  : Math.round(tele.cpDist) + " m"}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="hud bl">
        <div className="keys">
          <b>Z/↑</b> accélérer · <b>S/↓</b> freiner · <b>Q D</b> tourner · <b>espace</b> frein à main ·{" "}
          <b>R</b> replacer · <b>B</b> bâtiments ·{" "}
          <button type="button" className="link" onClick={onEdit}>
            E éditeur
          </button>
          <br />
          manette : <b>RT</b> accélérer · <b>LT</b> freiner · <b>stick</b> tourner · <b>X</b> frein à main ·{" "}
          <b>Y</b> replacer · <b>Select</b> bâtiments
        </div>
        <div className="attrib">
          données © contributeurs OpenStreetMap, ODbL · {source}
        </div>
      </div>

      {goGen > 0 && <Countdown gen={goGen} />}

      {!running && checkpoints.length >= 2 && countdownLeft() <= 0 && (
        <div className="start">
          <div>
            appuie sur <b>Z</b>, <b>↑</b> ou <b>RT</b> pour le chrono · <b>lancer</b> pour tout le monde
          </div>
        </div>
      )}
    </>
  );
}
