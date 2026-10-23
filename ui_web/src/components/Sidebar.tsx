import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bike,
  Download,
  Footprints,
  Gauge,
  Loader2,
  Map as MapIcon,
  Mountain,
  Pause,
  Play,
  Repeat,
  Save,
  Satellite,
  ScrollText,
  Search,
  SlidersHorizontal,
  Sparkles,
  Square,
  Timer,
  Trash2,
  Turtle,
  Undo2,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import type { useSimulation, Activity as ActivityType, GpsMode } from "../hooks/useSimulation";
import { fmtKm, fmtPace, fmtClock } from "../lib/geo";
import { downloadFile } from "../lib/download";

type Sim = ReturnType<typeof useSimulation>;
type SidebarTab = "route" | "control";

const ACTIVITIES: { id: ActivityType; label: string; icon: typeof Footprints }[] = [
  { id: "running", label: "Course", icon: Footprints },
  { id: "cycling", label: "Vélo", icon: Bike },
  { id: "hiking", label: "Rando", icon: Mountain },
  { id: "pacer", label: "Pacer", icon: Timer },
];

const PRESETS = [
  { label: "Marche", value: 5 },
  { label: "Endu.", value: 10.9 },
  { label: "Semi", value: 15 },
  { label: "Vélo", value: 25 },
  { label: "Sprint", value: 45 },
];

const GPS_MODES: { id: GpsMode; label: string; icon: typeof Satellite }[] = [
  { id: "nominal", label: "Nominal", icon: Satellite },
  { id: "degraded", label: "Dégradé", icon: Activity },
  { id: "lost", label: "Perte", icon: WifiOff },
];

interface Props {
  sim: Sim;
  onFly: (lat: number, lon: number) => void;
  open: boolean;
  onClose: () => void;
  onOpenJournal: () => void;
}

export default function Sidebar({ sim, onFly, open, onClose, onOpenJournal }: Props) {
  const [tab, setTab] = useState<SidebarTab>("route");
  const [gpsQuery, setGpsQuery] = useState("");
  const [gpsError, setGpsError] = useState(false);
  const [trackName, setTrackName] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const tel = sim.telemetry;

  const busy = sim.phase === "routing" || sim.phase === "elevation";
  const canStart = !busy && !!sim.track && sim.track.points.length >= 2;

  const goToCoords = () => {
    const values = gpsQuery.trim().split(/[\s,;]+/).map(Number);
    const valid = values.length >= 2 && Number.isFinite(values[0]) && Number.isFinite(values[1])
      && Math.abs(values[0]) <= 90 && Math.abs(values[1]) <= 180;
    setGpsError(!valid);
    if (valid) onFly(values[0], values[1]);
  };

  const exportGpx = () => {
    const gpx = sim.exportGpx();
    if (gpx) downloadFile("parcours-runcrew.gpx", gpx, "application/gpx+xml;charset=utf-8");
  };

  const phaseText: Record<string, React.ReactNode> = {
    empty: sim.waypoints.length === 1
      ? "Ajoute un deuxième point pour calculer l’itinéraire."
      : "Clique sur la carte ou charge la boucle d’exemple.",
    routing: <span className="flex items-center gap-1.5 text-sky-300"><Loader2 size={11} className="spin" /> Calcul de l’itinéraire OSRM…</span>,
    elevation: <span className="flex items-center gap-1.5 text-amberx"><Loader2 size={11} className="spin" /> Lecture du terrain SRTM…</span>,
    ready: sim.track ? (
      <span><b className="num text-slate-200">{fmtKm(sim.track.length)} km</b> · {sim.track.points.length} points routés{sim.track.gainTotal != null && <> · <b className="num text-volt">D+ {sim.track.gainTotal} m</b></>}</span>
    ) : null,
    direct: sim.track ? <span className="text-amberx">Routage indisponible · segments directs · <b className="num">{fmtKm(sim.track.length)} km</b></span> : null,
  };

  const altShown = tel?.alt ?? sim.departureEle;

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-[1600] flex w-[360px] max-w-[92vw] shrink-0 flex-col border-r border-line bg-panel shadow-2xl transition-transform duration-200 lg:relative lg:z-10 lg:h-auto lg:max-w-none lg:translate-x-0 lg:shadow-none ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
      aria-label="Configuration du banc d’essai"
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4 lg:hidden">
        <span className="text-[12px] font-bold tracking-[0.12em] text-white">RUNCREW <span className="text-volt">STUDIO</span></span>
        <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-white/5" aria-label="Fermer le panneau">
          <X size={18} />
        </button>
      </div>

      <div className="grid h-[49px] shrink-0 grid-cols-2 border-b border-line bg-panel-2/40 px-3" role="tablist" aria-label="Réglages">
        <SidebarTabButton active={tab === "route"} onClick={() => setTab("route")} icon={MapIcon} label="Parcours" />
        <SidebarTabButton active={tab === "control"} onClick={() => setTab("control")} icon={SlidersHorizontal} label="Pilotage" live={sim.running} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {tab === "route" ? (
          <div className="space-y-3.5">
            <Section title="Point de départ" icon={Search}>
              <div className="flex gap-2">
                <input
                  value={gpsQuery}
                  onChange={(event) => { setGpsQuery(event.target.value); setGpsError(false); }}
                  onKeyDown={(event) => event.key === "Enter" && goToCoords()}
                  placeholder="43.421700, 6.675192"
                  aria-label="Latitude et longitude"
                  className={`num min-w-0 flex-1 rounded-lg border bg-ink px-3 py-2.5 text-[11.5px] text-white outline-none transition-colors placeholder:text-slate-600 focus:border-volt/60 ${gpsError ? "border-rose-400/60" : "border-line"}`}
                />
                <button onClick={goToCoords} className="rounded-lg bg-volt px-3.5 text-[11px] font-bold text-ink transition-colors hover:bg-[#35ed91]">
                  Aller
                </button>
              </div>
              {gpsError && <p className="mt-1.5 text-[10px] text-rose-300">Saisis une latitude et une longitude valides.</p>}
              <button
                onClick={sim.loadDemo}
                disabled={sim.running}
                className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-volt/25 bg-volt/[0.04] py-2 text-[10.5px] font-semibold text-volt transition-colors hover:bg-volt/10 disabled:opacity-35"
              >
                <Sparkles size={12} /> Charger une boucle d’exemple
              </button>
            </Section>

            <Section title="Type d’activité">
              <div className="grid grid-cols-4 gap-1.5">
                {ACTIVITIES.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => sim.setActivity(id)}
                    disabled={sim.running}
                    aria-pressed={sim.activity === id}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border py-2.5 text-[10px] font-semibold transition-all ${
                      sim.activity === id
                        ? "border-volt/70 bg-volt/10 text-volt"
                        : "border-line bg-ink/30 text-slate-500 hover:border-slate-600 hover:text-slate-300"
                    } disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    <Icon size={16} />
                    {label}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Construction du parcours" icon={MapIcon}>
              <div className="min-h-[18px] text-[10.5px] leading-relaxed text-slate-500">{phaseText[sim.phase]}</div>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-ink/40 px-3 py-2.5">
                <span className="flex items-center gap-2 text-[10.5px] font-medium text-slate-300">
                  <Repeat size={12} className="text-volt" /> Boucle fermée
                </span>
                <button
                  role="switch"
                  aria-checked={sim.loopClosed}
                  aria-label="Boucle fermée"
                  disabled={sim.running}
                  onClick={() => sim.toggleLoop(!sim.loopClosed)}
                  className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-40 ${sim.loopClosed ? "bg-volt" : "bg-line"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${sim.loopClosed ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                </button>
              </div>
              <p className="mt-2 text-[9.5px] leading-relaxed text-slate-600">
                Les points sont déplaçables sur la carte. Le tracé est verrouillé pendant la simulation.
              </p>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button
                  onClick={sim.undoWaypoint}
                  disabled={sim.running || sim.waypoints.length === 0}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-line bg-panel-2 py-2 text-[10.5px] font-semibold text-slate-300 transition-colors hover:bg-line/60 disabled:opacity-30"
                >
                  <Undo2 size={12} /> Annuler
                </button>
                <button
                  onClick={sim.clearTrack}
                  disabled={sim.running || (sim.waypoints.length === 0 && !sim.track)}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-line bg-panel-2 py-2 text-[10.5px] font-semibold text-rose-300 transition-colors hover:bg-rose-400/10 disabled:opacity-30"
                >
                  <Trash2 size={12} /> Effacer
                </button>
              </div>

              {sim.waypoints.length > 0 && (
                <details className="group mt-2.5 rounded-lg border border-line/80 bg-ink/30">
                  <summary className="cursor-pointer select-none px-3 py-2 text-[10px] font-semibold text-slate-400 transition-colors hover:text-slate-200">
                    Points de contrôle <span className="num text-slate-600">({sim.waypoints.length})</span>
                  </summary>
                  <div className="max-h-36 space-y-1 overflow-y-auto border-t border-line/70 p-2">
                    {sim.waypoints.map((point, index) => (
                      <div key={`${index}-${point[0]}-${point[1]}`} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-white/[0.03]">
                        <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-sky-400/30 text-[8.5px] font-bold text-sky-300">{index + 1}</span>
                        <span className="num min-w-0 flex-1 truncate text-[9px] text-slate-500">{point[0].toFixed(5)}, {point[1].toFixed(5)}</span>
                        <button
                          onClick={() => sim.removeWaypoint(index)}
                          disabled={sim.running}
                          className="rounded p-1 text-slate-600 hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-30"
                          aria-label={`Supprimer le point ${index + 1}`}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </Section>

            <Section title="Bibliothèque & export" icon={Save}>
              <div className="flex gap-2">
                <input
                  value={trackName}
                  onChange={(event) => setTrackName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && sim.saveTrack(trackName)) {
                      setTrackName("");
                      setSavedFlash(true);
                      window.setTimeout(() => setSavedFlash(false), 1800);
                    }
                  }}
                  placeholder="Nom du parcours"
                  className="min-w-0 flex-1 rounded-lg border border-line bg-ink px-3 py-2 text-[11px] text-white outline-none placeholder:text-slate-600 focus:border-volt/60"
                />
                <button
                  onClick={() => {
                    if (sim.saveTrack(trackName)) {
                      setTrackName("");
                      setSavedFlash(true);
                      window.setTimeout(() => setSavedFlash(false), 1800);
                    }
                  }}
                  disabled={!trackName.trim() || sim.waypoints.length < 2}
                  className={`flex items-center gap-1.5 rounded-lg px-3 text-[10.5px] font-bold transition-colors disabled:opacity-30 ${savedFlash ? "bg-amberx text-ink" : "bg-volt text-ink hover:bg-[#35ed91]"}`}
                >
                  <Save size={12} /> {savedFlash ? "OK" : "Sauver"}
                </button>
              </div>
              {sim.savedNames.length > 0 && (
                <select
                  value=""
                  disabled={sim.running}
                  onChange={(event) => event.target.value && sim.loadTrack(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-line bg-ink px-2.5 py-2 text-[10.5px] text-slate-300 outline-none disabled:opacity-40"
                  aria-label="Charger un parcours sauvegardé"
                >
                  <option value="">Charger un parcours sauvegardé…</option>
                  {sim.savedNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              )}
              <button
                onClick={exportGpx}
                disabled={!sim.track?.ele}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-amberx/25 bg-amberx/[0.06] py-2 text-[10px] font-semibold text-amberx transition-colors hover:bg-amberx/15 disabled:opacity-30"
              >
                <Download size={12} /> Exporter le GPX avec élévations
              </button>
            </Section>
          </div>
        ) : (
          <div className="space-y-3.5">
            <Section title="Allure de référence" icon={Gauge}>
              <div className="flex items-end justify-between">
                <div className="flex items-baseline gap-1.5">
                  <span className="num text-[36px] font-semibold leading-none tracking-[-0.05em] text-white">{sim.speedKmh.toFixed(1)}</span>
                  <span className="text-[10px] font-medium text-slate-500">km/h</span>
                </div>
                <span className="num rounded-md bg-volt/10 px-2 py-1 text-[11px] font-semibold text-volt">{fmtPace(sim.speedKmh)} /km</span>
              </div>
              <input
                type="range"
                min={3}
                max={50}
                step={0.5}
                value={sim.speedKmh}
                onChange={(event) => sim.setSpeedKmh(Number(event.target.value))}
                className="rc-slider mt-4"
                style={{ ["--fill" as string]: `${((sim.speedKmh - 3) / 47) * 100}%` }}
                aria-label="Vitesse en kilomètres par heure"
              />
              <div className="mt-3 grid grid-cols-5 gap-1">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => sim.setSpeedKmh(preset.value)}
                    title={`${preset.label} · ${preset.value} km/h`}
                    className="rounded-md bg-ink/70 px-1 py-1.5 text-[8.5px] font-medium text-slate-500 transition-colors hover:bg-volt hover:text-ink"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button onClick={() => sim.setSpeedKmh(Math.min(50, sim.speedKmh + 5))} className="flex items-center justify-center gap-1.5 rounded-lg border border-line bg-ink/40 py-2 text-[10px] font-semibold text-amberx hover:bg-line/50">
                  <Zap size={12} /> +5 km/h
                </button>
                <button onClick={() => sim.setSpeedKmh(Math.max(3, sim.speedKmh - 5))} className="flex items-center justify-center gap-1.5 rounded-lg border border-line bg-ink/40 py-2 text-[10px] font-semibold text-rose-300 hover:bg-line/50">
                  <Turtle size={12} /> −5 km/h
                </button>
              </div>
            </Section>

            <Section title="Accélération du test" icon={Zap}>
              <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-ink/50 p-1">
                {[1, 2, 4, 8].map((scale) => (
                  <button
                    key={scale}
                    onClick={() => sim.setTimeScale(scale)}
                    aria-pressed={sim.timeScale === scale}
                    className={`num rounded-lg py-2 text-[11px] font-bold transition-colors ${sim.timeScale === scale ? "bg-sky-400 text-ink" : "text-slate-500 hover:bg-white/5 hover:text-slate-200"}`}
                  >
                    ×{scale}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[9.5px] leading-relaxed text-slate-500">
                Accélère la distance et le chrono simulés, sans modifier l’allure de consigne. Idéal pour tester un semi en quelques minutes.
              </p>
            </Section>

            <Section title="Robustesse du signal GPS" icon={Satellite}>
              <div className="grid grid-cols-3 gap-1.5">
                {GPS_MODES.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => sim.setGpsMode(id)}
                    aria-pressed={sim.gpsMode === id}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border py-2.5 text-[9.5px] font-semibold transition-colors ${
                      sim.gpsMode === id
                        ? id === "nominal"
                          ? "border-volt/50 bg-volt/10 text-volt"
                          : id === "degraded"
                            ? "border-amberx/50 bg-amberx/10 text-amberx"
                            : "border-rose-400/50 bg-rose-400/10 text-rose-300"
                        : "border-line bg-ink/30 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
              <div className={`mt-2.5 flex gap-2 rounded-lg border px-2.5 py-2 text-[9.5px] leading-relaxed ${sim.gpsMode === "nominal" ? "border-volt/15 bg-volt/[0.04] text-slate-500" : "border-amberx/20 bg-amberx/[0.05] text-slate-400"}`}>
                <AlertTriangle size={12} className={`mt-0.5 shrink-0 ${sim.gpsMode === "nominal" ? "text-slate-600" : "text-amberx"}`} />
                {sim.gpsMode === "nominal" && "Précision d’environ 3 m. La position suit fidèlement la trace de référence."}
                {sim.gpsMode === "degraded" && "Gigue de position, cap instable et précision de 18 à 32 m pour observer la robustesse du fix."}
                {sim.gpsMode === "lost" && "Le dernier fix est conservé pendant que le chrono et la référence continuent d’avancer."}
              </div>
            </Section>

            <Section title="Télémétrie en direct">
              <div className="grid grid-cols-2 gap-1.5">
                <MetricCard title="ALTITUDE" value={altShown != null ? `${Math.round(altShown)}` : "—"} unit="m" accent="#ffab00" />
                <MetricCard title="PENTE" value={tel?.slope != null ? `${tel.slope > 0 ? "+" : ""}${tel.slope.toFixed(1)}` : "—"} unit="%" accent={tel?.slope != null && tel.slope < -0.4 ? "#fb7185" : "#00e676"} />
                <MetricCard title="DISTANCE" value={tel ? fmtKm(tel.sessionM) : "0.00"} unit="km" accent="#00e676" />
                <MetricCard title="CHRONO" value={tel ? fmtClock(tel.elapsedS) : "00:00"} accent="#e2e8f0" />
                <MetricCard title="DÉNIVELÉ +" value={tel ? `${Math.round(tel.gain)}` : sim.track?.gainTotal != null ? `${sim.track.gainTotal}` : "0"} unit="m" accent="#00e676" />
                <MetricCard title="DÉNIVELÉ −" value={tel ? `${Math.round(tel.loss)}` : sim.track?.lossTotal != null ? `${sim.track.lossTotal}` : "0"} unit="m" accent="#fb7185" />
              </div>
            </Section>

            <button onClick={onOpenJournal} className="flex w-full items-center justify-between rounded-xl border border-line bg-panel-2/60 px-3.5 py-3 text-left transition-colors hover:border-volt/25">
              <span className="flex items-center gap-2.5">
                <ScrollText size={15} className="text-volt" />
                <span>
                  <span className="block text-[11px] font-semibold text-slate-200">Journal & rapport de test</span>
                  <span className="mt-0.5 block text-[9px] text-slate-500">Exports JSON et CSV horodatés</span>
                </span>
              </span>
              <span className="num rounded-full bg-ink px-2 py-1 text-[9px] text-slate-500">{sim.events.length}</span>
            </button>

            <div className="rounded-xl border border-line/70 px-3.5 py-3">
              <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-600">Raccourcis clavier</div>
              <div className="mt-2.5 space-y-2 text-[9.5px] text-slate-500">
                <div className="flex items-center justify-between"><span>Lancer / pause / reprendre</span><kbd>Espace</kbd></div>
                <div className="flex items-center justify-between"><span>Annuler le dernier point</span><kbd>Ctrl + Z</kbd></div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-panel p-3.5">
        <div className={`flex gap-2 ${sim.running ? "" : "grid grid-cols-1"}`}>
          <button
            onClick={() => (sim.running ? sim.stop() : sim.start())}
            disabled={!sim.running && !canStart}
            className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl py-3.5 text-[11.5px] font-extrabold tracking-[0.06em] transition-all disabled:cursor-not-allowed disabled:opacity-30 ${
              sim.running ? "bg-rose-500 text-white hover:bg-rose-400" : "bg-volt text-ink shadow-[0_8px_24px_rgba(0,230,118,.14)] hover:bg-[#35ed91]"
            }`}
          >
            {busy ? <><Loader2 size={15} className="spin" /> SYNCHRONISATION…</> : sim.running ? <><Square size={14} /> ARRÊTER</> : <><Play size={15} fill="currentColor" /> LANCER LA SIMULATION</>}
          </button>
          {sim.running && (
            <button onClick={sim.togglePause} className="flex items-center justify-center gap-2 rounded-xl bg-amberx px-4 py-3.5 text-[11px] font-extrabold text-ink transition-colors hover:bg-amber-300">
              {sim.paused ? <><Play size={14} /> REPRENDRE</> : <><Pause size={14} /> PAUSE</>}
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center justify-center gap-1.5 text-center text-[8.5px] font-medium text-slate-600">
          {sim.running ? (
            <><span className={`h-1.5 w-1.5 rounded-full ${sim.paused ? "bg-amberx" : "bg-volt"}`} /> {sim.paused ? "Session en pause" : `Télémétrie active · horloge ×${sim.timeScale}`}</>
          ) : canStart ? (
            <><span className="h-1.5 w-1.5 rounded-full bg-volt" /> Parcours prêt · Espace pour démarrer</>
          ) : (
            <>Deux points minimum pour activer la simulation</>
          )}
        </div>
      </div>
    </aside>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof Search; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel-2/45 p-3.5">
      <h3 className="mb-3 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500">
        {Icon && <Icon size={11} className="text-slate-600" />} {title}
      </h3>
      {children}
    </section>
  );
}

function SidebarTabButton({ active, onClick, icon: Icon, label, live }: { active: boolean; onClick: () => void; icon: typeof MapIcon; label: string; live?: boolean }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative flex items-center justify-center gap-2 border-b-2 text-[10.5px] font-semibold transition-colors ${active ? "border-volt text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}
    >
      <Icon size={13} className={active ? "text-volt" : ""} /> {label}
      {live && <span className="h-1.5 w-1.5 rounded-full bg-volt shadow-[0_0_8px_#00e676]" />}
    </button>
  );
}

function MetricCard({ title, value, unit, accent }: { title: string; value: string; unit?: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-line/80 bg-ink/45 px-3 py-2.5">
      <div className="text-[8px] font-bold tracking-[0.12em] text-slate-600">{title}</div>
      <div className="num mt-1 text-[16px] font-semibold leading-none" style={{ color: accent || "#fff" }}>
        {value}{unit && <span className="ml-1 text-[9px] font-medium text-slate-600">{unit}</span>}
      </div>
    </div>
  );
}
