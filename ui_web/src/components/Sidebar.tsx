import { useState } from "react";
import {
  Search, Footprints, Bike, Mountain, Timer, Zap, Turtle, Save, Undo2, Trash2,
  Play, Square, Pause, Download, Repeat, TrendingUp, TrendingDown, Loader2,
} from "lucide-react";
import type { useSimulation, Activity } from "../hooks/useSimulation";
import { fmtKm, fmtPace, fmtClock } from "../lib/geo";

type Sim = ReturnType<typeof useSimulation>;

const ACTIVITIES: { id: Activity; label: string; icon: typeof Footprints }[] = [
  { id: "running", label: "Run", icon: Footprints },
  { id: "cycling", label: "Vélo", icon: Bike },
  { id: "hiking", label: "Rando", icon: Mountain },
  { id: "pacer", label: "Pacer", icon: Timer },
];

const PRESETS = [
  { label: "Marche 5.0", v: 5 },
  { label: "Endu 10.9", v: 10.9 },
  { label: "Semi 15.0", v: 15 },
  { label: "Vélo 25.0", v: 25 },
  { label: "Sprint 45.0", v: 45 },
];

function Card({ title, value, unit, accent, sub }: { title: string; value: string; unit?: string; accent?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2 px-3 py-2.5">
      <div className="text-[9px] font-bold tracking-[0.14em] text-slate-500">{title}</div>
      <div className="num mt-0.5 text-[17px] font-extrabold leading-none" style={{ color: accent || "#fff" }}>
        {value}
        {unit && <span className="ml-1 text-[10px] font-semibold text-slate-500">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-[9px] font-semibold text-slate-600">{sub}</div>}
    </div>
  );
}

export default function Sidebar({ sim, onFly }: { sim: Sim; onFly: (lat: number, lon: number) => void }) {
  const [gpsQuery, setGpsQuery] = useState("");
  const [trackName, setTrackName] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const tel = sim.telemetry;

  const busy = sim.phase === "routing" || sim.phase === "elevation";
  const canStart = !busy && !!sim.track && sim.track.points.length >= 2;

  const goToCoords = () => {
    const p = gpsQuery.trim().split(/[\s,;]+/).map(parseFloat);
    if (p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) onFly(p[0], p[1]);
  };

  const phaseText: Record<string, React.ReactNode> = {
    empty: "Clique sur la carte pour tracer ta boucle",
    routing: <span className="flex items-center gap-1.5 text-sky-300"><Loader2 size={10} className="spin" /> Itinéraire OSRM…</span>,
    elevation: <span className="flex items-center gap-1.5 text-amberx"><Loader2 size={10} className="spin" /> Relevé d'altitude SRTM…</span>,
    ready: sim.track ? (
      <>Suit la route · <b className="num text-volt">{fmtKm(sim.track.length)} km</b> · {sim.track.points.length} pts routés{sim.track.gainTotal != null && <> · <span className="text-volt">D+ {sim.track.gainTotal} m</span></>}</>
    ) : null,
    direct: sim.track ? <>Tracé direct (routage KO) · <b className="num text-amberx">{fmtKm(sim.track.length)} km</b></> : null,
  };

  const exportGpx = () => {
    const gpx = sim.exportGpx();
    if (!gpx) return;
    const u = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
    const a = document.createElement("a");
    a.href = u;
    a.download = "parcours-runcrew.gpx";
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  };

  const altShown = tel?.alt ?? sim.departureEle;
  const altIsReal = tel ? tel.eleReal : sim.departureEle != null;

  return (
    <aside className="z-10 flex w-[380px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-panel p-4">
      {/* recherche */}
      <section className="rounded-2xl border border-line bg-panel-2/60 p-3.5">
        <h3 className="mb-2.5 flex items-center gap-1.5 text-[10px] font-bold tracking-[0.16em] text-slate-500">
          <Search size={11} /> RECHERCHE COORDONNÉES
        </h3>
        <div className="flex gap-1.5">
          <input
            value={gpsQuery}
            onChange={(e) => setGpsQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && goToCoords()}
            placeholder="43.421700, 6.675192"
            className="num min-w-0 flex-1 rounded-lg border border-line bg-ink px-3 py-2 text-[12px] text-white outline-none transition-colors placeholder:text-slate-600 focus:border-volt/60"
          />
          <button
            onClick={goToCoords}
            className="rounded-lg bg-volt px-3.5 py-2 text-[12px] font-bold text-ink transition-shadow hover:shadow-[0_0_18px_rgba(0,230,118,.5)]"
          >
            Aller
          </button>
        </div>
      </section>

      {/* activité */}
      <section className="rounded-2xl border border-line bg-panel-2/60 p-3.5">
        <h3 className="mb-2.5 text-[10px] font-bold tracking-[0.16em] text-slate-500">ACTIVITÉ</h3>
        <div className="grid grid-cols-4 gap-1.5">
          {ACTIVITIES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => sim.setActivity(id)}
              className={`flex flex-col items-center gap-1 rounded-xl border-2 py-2.5 text-[10.5px] font-bold transition-all ${
                sim.activity === id
                  ? "border-volt bg-volt/10 text-volt shadow-[0_0_16px_rgba(0,230,118,.15)]"
                  : "border-line bg-transparent text-slate-500 hover:border-slate-600 hover:text-slate-300"
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* vitesse */}
      <section className="rounded-2xl border border-line bg-panel-2/60 p-3.5">
        <div className="mb-1 flex items-baseline justify-between">
          <h3 className="text-[10px] font-bold tracking-[0.16em] text-slate-500">VITESSE RÉELLE</h3>
          <span className="num text-[12px] font-bold text-volt">{fmtPace(sim.speedKmh)} /km</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="num text-[34px] font-extrabold leading-none text-white">{sim.speedKmh.toFixed(1)}</span>
          <span className="text-[11px] font-semibold text-slate-500">km/h</span>
        </div>
        <input
          type="range"
          min={3}
          max={50}
          step={0.5}
          value={sim.speedKmh}
          onChange={(e) => sim.setSpeedKmh(parseFloat(e.target.value))}
          className="rc-slider mt-2"
          style={{ ["--fill" as string]: `${((sim.speedKmh - 3) / 47) * 100}%` }}
        />
        <div className="mt-2.5 flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => sim.setSpeedKmh(p.v)}
              className="rounded-md bg-line/60 px-2 py-1 text-[9.5px] font-semibold text-slate-400 transition-colors hover:bg-volt hover:text-ink"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5">
          <button
            onClick={() => sim.setSpeedKmh(Math.max(3, sim.speedKmh + 5))}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-line/40 py-2 text-[11px] font-bold text-amberx transition-colors hover:bg-line"
          >
            <Zap size={12} /> +5 km/h
          </button>
          <button
            onClick={() => sim.setSpeedKmh(Math.max(3, sim.speedKmh - 5))}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-line/40 py-2 text-[11px] font-bold text-rose-400 transition-colors hover:bg-line"
          >
            <Turtle size={12} /> −5 km/h
          </button>
        </div>
      </section>

      {/* télémétrie */}
      <section className="rounded-2xl border border-line bg-panel-2/60 p-3.5">
        <h3 className="mb-2.5 flex items-center justify-between text-[10px] font-bold tracking-[0.16em] text-slate-500">
          TÉLÉMÉTRIE EN DIRECT
          {altIsReal && altShown != null && (
            <span className="rounded bg-amberx/15 px-1.5 py-0.5 text-[8.5px] font-bold text-amberx">ALTITUDE SRTM RÉELLE</span>
          )}
        </h3>
        <div className="grid grid-cols-2 gap-1.5">
          <Card
            title="ALTITUDE"
            value={altShown != null ? `${Math.round(altShown)}` : "—"}
            unit="m"
            accent="#ffab00"
            sub={sim.departureEle != null && !tel ? `Départ réel : ${Math.round(sim.departureEle)} m` : undefined}
          />
          <Card
            title="PENTE"
            value={tel?.slope != null ? `${tel.slope > 0 ? "+" : ""}${tel.slope.toFixed(1)}` : "—"}
            unit="%"
            accent={tel?.slope != null ? (tel.slope > 0.4 ? "#00e676" : tel.slope < -0.4 ? "#fb7185" : "#fff") : "#fff"}
          />
          <Card
            title="DISTANCE"
            value={tel ? fmtKm(tel.sessionM) : "0.00"}
            unit="km"
            accent="#00e676"
            sub={sim.track ? `Tour : ${fmtKm(sim.track.length)} km${tel && tel.laps > 0 ? ` · ×${tel.laps + 1}` : ""}` : undefined}
          />
          <Card title="CHRONO" value={tel ? fmtClock(tel.elapsedS) : "00:00"} accent="#e2e8f0" />
          <Card
            title="DÉNIVELÉ +"
            value={tel ? `${Math.round(tel.gain)}` : sim.track?.gainTotal != null ? `${sim.track.gainTotal}` : "0"}
            unit="m"
            accent="#00e676"
            sub={sim.track?.gainTotal != null ? `Total parcours : ${sim.track.gainTotal} m` : undefined}
          />
          <Card
            title="DÉNIVELÉ −"
            value={tel ? `${Math.round(tel.loss)}` : sim.track?.lossTotal != null ? `${sim.track.lossTotal}` : "0"}
            unit="m"
            accent="#fb7185"
            sub={sim.track?.lossTotal != null ? `Total parcours : ${sim.track.lossTotal} m` : undefined}
          />
        </div>
      </section>

      {/* parcours */}
      <section className="rounded-2xl border border-line bg-panel-2/60 p-3.5">
        <h3 className="mb-2 text-[10px] font-bold tracking-[0.16em] text-slate-500">PARCOURS</h3>
        <div className="min-h-[18px] text-[11px] text-slate-400">{phaseText[sim.phase]}</div>
        <label className="mt-2 flex cursor-pointer items-center justify-between gap-2 text-[11px] font-semibold text-slate-300">
          <span className="flex items-center gap-1.5"><Repeat size={11} className="text-volt" /> Boucle fermée (retour par la route)</span>
          <input
            type="checkbox"
            checked={sim.loopClosed}
            onChange={(e) => sim.toggleLoop(e.target.checked)}
            className="h-4 w-4 accent-[#00e676]"
          />
        </label>
        <div className="mt-2.5 flex gap-1.5">
          <button
            onClick={sim.undoWaypoint}
            disabled={sim.waypoints.length === 0}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-line/40 py-2 text-[11px] font-bold text-slate-300 transition-colors hover:bg-line disabled:opacity-35"
          >
            <Undo2 size={12} /> Annuler
          </button>
          <button
            onClick={sim.clearTrack}
            disabled={sim.waypoints.length === 0 && !sim.track}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-line/40 py-2 text-[11px] font-bold text-rose-400 transition-colors hover:bg-line disabled:opacity-35"
          >
            <Trash2 size={12} /> Effacer
          </button>
        </div>

        <div className="mt-3 flex gap-1.5">
          <input
            value={trackName}
            onChange={(e) => setTrackName(e.target.value)}
            placeholder="Nom du parcours"
            className="min-w-0 flex-1 rounded-lg border border-line bg-ink px-3 py-2 text-[12px] text-white outline-none placeholder:text-slate-600 focus:border-volt/60"
          />
          <button
            onClick={() => {
              if (sim.saveTrack(trackName)) {
                setTrackName("");
                setSavedFlash(true);
                setTimeout(() => setSavedFlash(false), 1800);
              }
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-bold transition-all ${
              savedFlash ? "bg-amberx text-ink" : "bg-volt text-ink hover:shadow-[0_0_16px_rgba(0,230,118,.4)]"
            }`}
          >
            <Save size={13} /> {savedFlash ? "OK" : "Sauver"}
          </button>
        </div>
        {sim.savedNames.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && sim.loadTrack(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-line bg-ink px-2.5 py-2 text-[12px] text-slate-300 outline-none"
          >
            <option value="">— Charger un parcours —</option>
            {sim.savedNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        )}
        <button
          onClick={exportGpx}
          disabled={!sim.track?.ele}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-amberx/40 bg-amberx/10 py-2 text-[11px] font-bold text-amberx transition-colors hover:bg-amberx/20 disabled:opacity-35"
        >
          <Download size={12} /> EXPORTER GPX (avec élévations)
        </button>
      </section>

      {/* démarrage */}
      <div className="sticky bottom-0 -mx-1 mt-auto px-1 pb-1 pt-2" style={{ background: "linear-gradient(transparent, #0b0e15 35%)" }}>
        <button
          onClick={() => (sim.running ? sim.stop() : sim.start())}
          disabled={!sim.running && !canStart}
          className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[14px] font-extrabold tracking-[0.1em] transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
            sim.running
              ? "bg-rose-500 text-white shadow-[0_0_30px_rgba(244,63,94,.35)]"
              : "bg-volt text-ink shadow-[0_0_30px_rgba(0,230,118,.3)] hover:shadow-[0_0_44px_rgba(0,230,118,.5)]"
          }`}
        >
          {busy ? (
            <><Loader2 size={16} className="spin" /> SYNCHRONISATION…</>
          ) : sim.running ? (
            <><Square size={16} /> STOPPER</>
          ) : (
            <><Play size={16} /> LANCER LA SIMULATION</>
          )}
        </button>
        {sim.running && (
          <button
            onClick={sim.togglePause}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-amberx py-3 text-[13px] font-extrabold tracking-wide text-ink transition-shadow hover:shadow-[0_0_24px_rgba(255,171,0,.4)]"
          >
            {sim.paused ? <><Play size={14} /> REPRENDRE</> : <><Pause size={14} /> PAUSE</>}
          </button>
        )}
        <div className="mt-2 flex items-center justify-center gap-1.5 text-[9px] font-semibold text-slate-600">
          {tel?.eleReal ? (
            <><TrendingUp size={9} className="text-amberx" /> Profil réel actif — altitude interpolée par distance</>
          ) : (
            <><TrendingDown size={9} /> Trace 2 points minimum pour activer le moteur d'altitude</>
          )}
        </div>
      </div>
    </aside>
  );
}
