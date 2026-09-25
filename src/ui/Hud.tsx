import { useEffect, useState, useSyncExternalStore } from "react";
import { useStore } from "../state/store";
import { elevation } from "../lib/elevation";
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

// Compteur en arc : 270 degres, l'ouverture en bas. L'arc plein est un seul
// trait pointille (stroke-dasharray), rien a recalculer que sa longueur.
const GAUGE_MAX = 200;
const GAUGE_R = 52;
const GAUGE_C = 2 * Math.PI * GAUGE_R;
const GAUGE_ARC = 0.75 * GAUGE_C;

function Gauge({ speed, road, offroad }: { speed: number; road: string; offroad: boolean }) {
  const frac = Math.min(1, speed / GAUGE_MAX);
  const ticks = [];
  for (let k = 0; k <= 10; k++) {
    const a = ((135 + k * 27) * Math.PI) / 180;
    const r0 = k % 5 === 0 ? 40 : 44;
    ticks.push(
      <line
        key={k}
        x1={Math.cos(a) * r0}
        y1={Math.sin(a) * r0}
        x2={Math.cos(a) * 47}
        y2={Math.sin(a) * 47}
        className={k >= 9 ? "tick red" : "tick"}
      />,
    );
  }
  return (
    <div className="hud bc">
      <div className="gauge">
        <svg viewBox="-60 -60 120 120">
          <circle r={GAUGE_R} className="track" strokeDasharray={`${GAUGE_ARC} ${GAUGE_C}`} transform="rotate(135)" />
          <circle
            r={GAUGE_R}
            className={"fill" + (frac > 0.85 ? " hot" : "")}
            strokeDasharray={`${GAUGE_ARC * frac} ${GAUGE_C}`}
            transform="rotate(135)"
          />
          {ticks}
        </svg>
        <div className="gauge-n">{speed}</div>
        <div className="gauge-u">km/h</div>
      </div>
      <div className={"road" + (offroad ? " off" : "")}>{offroad ? "hors piste" : road || "—"}</div>
    </div>
  );
}

// Progression du tour : un plot par checkpoint, l'arrivee en dernier.
function Pips({ count, next, running }: { count: number; next: number; running: boolean }) {
  if (count < 2) return null;
  const pips = [];
  for (let i = 1; i <= count; i++) {
    const id = i % count; // l'arrivee (0) ferme la liste
    const passed = running && (next === 0 ? id !== 0 : id !== 0 && id < next);
    const current = id === next;
    pips.push(
      <span key={i} className={"pip" + (passed ? " done" : "") + (current ? " cur" : "") + (id === 0 ? " fin" : "")} />,
    );
  }
  return <div className="hud tc pips">{pips}</div>;
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
  const ign = useStore((s) => s.ign);
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
        <div className="fps">{Math.round(tele.fps)} fps</div>
      </div>

      <Pips count={checkpoints.length} next={nextCp} running={running} />

      <Gauge speed={speed} road={tele.roadName || tele.roadType} offroad={tele.offroad} />

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
                {nextCp === 0 ? "" : "checkpoint "} {nextCp === 0 ? "arrivée" : `${nextCp}/${checkpoints.length - 1}`}
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
        {/* l'aide s'efface pendant la course : le decor a besoin de la place */}
        <div className={"keys" + (running ? " quiet" : "")}>
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
          {ign && " · bâti IGN BD TOPO, Licence Ouverte"}
          {elevation.on && " · relief IGN RGE ALTI"} · horizon SRTM, Copernicus EU-DEM
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
