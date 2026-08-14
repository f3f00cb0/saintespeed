import { useCallback, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { loadNetwork } from "./lib/osm";
import { buildGraph, type RoadGraph } from "./lib/graph";
import { makeCheckpoints, spawnAt } from "./lib/race";
import { loadBuildings, prepareBuildings, buildWallIndex } from "./lib/buildings";
import { loadFeatures, prepareFeatures } from "./lib/features";
import { loadRail, prepareRail, railLength } from "./lib/rail";
import { useKeyboard } from "./lib/input";
import { useStore } from "./state/store";
import { Roads } from "./scene/Roads";
import { Car } from "./scene/Car";
import { Checkpoints } from "./scene/Checkpoints";
import { Buildings } from "./scene/Buildings";
import { Landmarks } from "./scene/Landmarks";
import { Ground } from "./scene/Ground";
import { Trees } from "./scene/Trees";
import { Tram } from "./scene/Tram";
import { Fountains } from "./scene/Fountains";
import { Fences } from "./scene/Fences";
import { Viaduct } from "./scene/Viaduct";
import { Perf } from "./scene/Perf";
import { AutoQuality } from "./scene/Quality";
import { Lamps } from "./scene/Lamps";
import { Sky, HORIZON } from "./scene/Sky";
import { ChaseCamera } from "./scene/Camera";
import { Hud } from "./ui/Hud";
import { Post } from "./scene/Post";
import { LEVELS, Quality } from "./lib/quality";

const SKY = 0x0e1526; // fond et brouillard partagent la meme couleur

// l'index des murs sert au bras de camera, il est construit une fois
function buildIndex(flat: ReturnType<typeof prepareBuildings>) {
  const t0 = performance.now();
  const idx = buildWallIndex(flat);
  console.log(`index des murs: ${idx.count} segments, ${Math.round(performance.now() - t0)} ms`);
  return idx;
}

// Le Canvas reste monte en permanence : le monter au moment ou le reseau
// arrive faisait rater sa mesure de taille et le renderer restait en 300x150.
export default function App() {
  const phase = useStore((s) => s.phase);
  const error = useStore((s) => s.error);
  const graph = useStore((s) => s.graph);
  const ways = useStore((s) => s.ways);
  const buildings = useStore((s) => s.buildings);
  const walls = useStore((s) => s.walls);
  const features = useStore((s) => s.features);
  const rail = useStore((s) => s.rail);
  const checkpoints = useStore((s) => s.checkpoints);
  // objet stable : sinon les lampadaires se reconstruiraient a chaque rendu
  const centre = useMemo(() => {
    if (!checkpoints.length) return null;
    return {
      x: checkpoints.reduce((a, c) => a + c.x, 0) / checkpoints.length,
      y: checkpoints.reduce((a, c) => a + c.y, 0) / checkpoints.length,
    };
  }, [checkpoints]);
  const showBuildings = useStore((s) => s.showBuildings);
  const [stats, setStats] = useState("");
  // Qualite de rendu : part au maximum et ne descend que sur mesure, voir
  // src/lib/quality.ts. Mesure a l'origine de ce reglage : un Intel Iris Xe
  // tenait 36 fps en 1389x945 alors que la geometrie residente ne pese que
  // 200 draw calls, c'est le MSAA 4x du composer qui plafonnait.
  const [quality, setQuality] = useState<Quality>(Quality.High);
  const level = LEVELS[quality];

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const t0 = performance.now();
        const { ways, source } = await loadNetwork();
        if (dead) return;
        const g: RoadGraph = buildGraph(ways);
        const cps = makeCheckpoints(g);
        spawnAt(g, cps, 0);
        const ms = Math.round(performance.now() - t0);
        setStats(`${g.stats.nodes} noeuds · ${g.stats.edges} segments · ${ms} ms`);
        useStore.getState().setLoaded(g, ways, cps, source);

        // Le decor est bien plus leger que les batiments (0,7 Mo contre 3) et
        // c'est lui qui bouche les trous noirs des places : on le charge en
        // parallele et on l'applique des qu'il arrive, sans attendre les
        // 16 000 volumes.
        loadFeatures().then((rawFeatures) => {
          if (dead) return;
          const t = performance.now();
          const f = prepareFeatures(rawFeatures, g.proj);
          console.log(
            `decor: ${f.areas.length} surfaces, ${f.trees.length} arbres, ` +
              `${f.tram.length} troncons tram, ${f.fountains.length} fontaines, ` +
              `${Math.round(performance.now() - t)} ms`,
          );
          useStore.getState().setFeatures(f);
        });

        // Les voies ferrees : 60 ko, elles arrivent tout de suite. Seuls les
        // troncons aeriens sont gardes, ce sont eux qui portent la gare Carnot.
        loadRail().then((lines) => {
          if (dead) return;
          const flatRail = prepareRail(lines, g.proj);
          console.log(
            `rail: ${lines.length} troncons charges, ${flatRail.length} aeriens, ` +
              `${Math.round(railLength(flatRail))} m de viaduc`,
          );
          useStore.getState().setRail(flatRail);
        });

        // Les batiments arrivent apres, ils ne doivent pas retarder le depart.
        // Les hauteurs manquantes sont inferees depuis l'Hotel de Ville, que
        // prepareBuildings connait : plus on en est pres, plus on monte.
        const raw = await loadBuildings();
        if (dead || !raw.length) return;
        const flat = prepareBuildings(raw, g.proj);
        useStore.getState().setBuildings(flat, buildIndex(flat));
      } catch (err: any) {
        if (!dead) useStore.getState().setError(err?.message || String(err));
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  const onReset = useCallback(() => {
    const s = useStore.getState();
    if (!s.graph || !s.checkpoints.length) return;
    // on repart du dernier checkpoint valide
    const from = (s.nextCp - 1 + s.checkpoints.length) % s.checkpoints.length;
    spawnAt(s.graph, s.checkpoints, from);
  }, []);

  const onToggleBuildings = useCallback(() => useStore.getState().toggleBuildings(), []);

  useKeyboard(onReset, onToggleBuildings);

  const ready = phase === "ready" && !!graph;

  return (
    <>
      <Canvas
        style={{ position: "fixed", inset: 0 }}
        dpr={[1, level.dprMax]}
        // Pas de tone mapping ici : il est fait en dernier effet du composer,
        // sinon le bloom travaille sur une image deja ecrasee et bave a peine.
        gl={{ toneMapping: THREE.NoToneMapping }}
        camera={{ fov: 68, near: 0.5, far: 4000, position: [0, 40, 40] }}
        onCreated={({ scene, gl }) => {
          scene.background = new THREE.Color(SKY);
          gl.setClearColor(SKY);
        }}
      >
        <fogExp2 attach="fog" args={[HORIZON, 0.0009]} />
        {/* Ciel froid en haut, sol chaud sombre en bas : les toitures prennent
            le bleu et les facades se detachent du fond. */}
        <hemisphereLight args={["#5c72a0", "#2e2410", 3.2]} />
        {/* rasante et tres faible, juste pour un relief d'aretes */}
        <directionalLight position={[120, 60, 80]} intensity={0.9} color={0xc4d0e4} />
        {ready && (
          <>
            <Sky />
            {/* le decor passe avant les routes : les surfaces sont sous la
                chaussee, qui doit rester lisible par dessus une place */}
            {features && <Ground areas={features.areas} paths={features.paths} />}
            <Roads ways={ways} proj={graph!.proj} />
            {features && <Tram lines={features.tram} />}
            {features && <Trees trees={features.trees} />}
            {features && <Fountains points={features.fountains} />}
            {/* la ceinture d'un jardin est ce qui le separe d'un parc de loin */}
            {features && <Fences fences={features.fences} />}
            {centre && <Lamps ways={ways} proj={graph!.proj} centre={centre} graph={graph!} />}
            {/* le viaduc avant les batiments : c'est un ouvrage, pas du relief,
                et il doit exister meme si la couche batiments est coupee */}
            {rail.length > 0 && <Viaduct rail={rail} buildings={buildings} />}
            {showBuildings && buildings.length > 0 && <Buildings buildings={buildings} />}
            {showBuildings && buildings.length > 0 && (
              <Landmarks buildings={buildings} proj={graph!.proj} />
            )}
            <Perf />
            <AutoQuality quality={quality} onDrop={setQuality} />
            <Checkpoints />
            <Car graph={graph!} />
            <ChaseCamera walls={walls} />
            <Post level={level} />
          </>
        )}
      </Canvas>

      {ready && (
        <>
          <Hud />
          <div className="hud stats">{stats}</div>
        </>
      )}

      {phase === "loading" && (
        <div className="overlay">
          <h1>
            Sain<b>té</b>
          </h1>
          <p>chargement du réseau routier…</p>
        </div>
      )}

      {phase === "error" && (
        <div className="overlay">
          <h1>Pas de réseau</h1>
          <p>{error}</p>
          <pre>npm run fetch-osm</pre>
        </div>
      )}
    </>
  );
}
