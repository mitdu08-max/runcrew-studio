import { Clock, Mountain, Navigation, Route, Satellite, Timer } from "lucide-react";
import type { useSimulation } from "../hooks/useSimulation";
import { fmtClock, fmtKm, fmtPace } from "../lib/geo";

type Sim = ReturnType<typeof useSimulation>;

const ACTIVITY_LABEL = {
  running: "Course à pied",
  cycling: "Cyclisme",
  hiking: "Randonnée",
  pacer: "Test du Pacer",
} as const;

export default function LiveHud({ sim }: { sim: Sim }) {
  const { track, telemetry: tel } = sim;
  if ((!track || track.points.length < 2) && !tel) return null;

  const progress = tel && track ? Math.min(1, tel.progressM / Math.max(1, track.length)) : 0;
  const remainingS = tel && track
    ? Math.max(0, track.length - tel.progressM) / Math.max(0.1, tel.speedKmh / 3.6)
    : null;
  const estimatedS = track ? track.length / Math.max(0.1, sim.speedKmh / 3.6) : 0;

  const status = sim.running ? (sim.paused ? "EN PAUSE" : "EN DIRECT") : "PRÊT À TESTER";
  const statusColor = sim.running
    ? sim.paused
      ? "bg-amberx text-amberx"
      : "bg-volt text-volt"
    : "bg-sky-400 text-sky-300";

  return (
    <section
      aria-label="Résumé de la simulation"
      className="hud-panel pointer-events-none absolute left-4 top-4 z-[1000] w-[318px] max-w-[calc(100%-5rem)] overflow-hidden rounded-2xl"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`relative flex h-2 w-2 shrink-0 rounded-full ${statusColor.split(" ")[0]}`}>
            {sim.running && !sim.paused && (
              <span className={`absolute inset-0 animate-ping rounded-full ${statusColor.split(" ")[0]} opacity-60`} />
            )}
          </span>
          <div className="min-w-0">
            <div className={`text-[9px] font-bold tracking-[0.18em] ${statusColor.split(" ")[1]}`}>{status}</div>
            <div className="mt-0.5 truncate text-[12px] font-semibold text-slate-200">{ACTIVITY_LABEL[sim.activity]}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {sim.timeScale > 1 && (
            <span className="num rounded-md border border-sky-400/25 bg-sky-400/10 px-1.5 py-1 text-[9px] font-bold text-sky-300">
              ×{sim.timeScale}
            </span>
          )}
          {tel && (
            <span
              className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-[9px] font-bold ${
                tel.gpsMode === "lost"
                  ? "border-rose-400/30 bg-rose-400/10 text-rose-300"
                  : tel.gpsMode === "degraded"
                    ? "border-amberx/30 bg-amberx/10 text-amberx"
                    : "border-volt/25 bg-volt/10 text-volt"
              }`}
            >
              <Satellite size={10} />
              {tel.gpsMode === "lost" ? "GPS PERDU" : `±${Math.round(tel.accuracy ?? 0)} M`}
            </span>
          )}
        </div>
      </div>

      {tel ? (
        <div className="p-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="num text-[42px] font-semibold leading-none tracking-[-0.06em] text-white">
                  {tel.speedKmh.toFixed(1)}
                </span>
                <span className="text-[11px] font-medium text-slate-500">km/h</span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
                <Navigation size={11} className="text-volt" />
                {fmtPace(tel.speedKmh)} /km
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">Chrono simulé</div>
              <div className="num mt-1 text-[21px] font-semibold tracking-tight text-slate-100">{fmtClock(tel.elapsedS)}</div>
            </div>
          </div>

          <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-volt shadow-[0_0_10px_rgba(0,230,118,.35)] transition-[width] duration-200"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[9.5px] font-medium text-slate-500">
            <span className="num text-slate-300">{Math.round(progress * 100)} % du tour</span>
            <span className="num">
              {remainingS != null ? `Fin du tour · ${fmtClock(Math.ceil(remainingS))}` : "—"}
            </span>
          </div>

          <div className="mt-3.5 grid grid-cols-3 divide-x divide-white/[0.07] rounded-xl border border-white/[0.06] bg-black/15 py-2.5">
            <HudMetric icon={Route} label="Distance" value={fmtKm(tel.sessionM)} unit="km" />
            <HudMetric icon={Mountain} label="Altitude" value={tel.alt != null ? `${Math.round(tel.alt)}` : "—"} unit="m" />
            <HudMetric icon={Timer} label="Tour" value={`${tel.laps + 1}`} unit={tel.laps > 0 ? "effectués" : "en cours"} />
          </div>
        </div>
      ) : track ? (
        <div className="p-4">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-200">
            <Route size={14} className="text-volt" />
            Ton terrain de jeu est prêt
          </div>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-slate-500">
            Vérifie le tracé, choisis ton allure puis lance le test.
          </p>
          <div className="mt-3.5 grid grid-cols-3 divide-x divide-white/[0.07] rounded-xl border border-white/[0.06] bg-black/15 py-3">
            <HudMetric icon={Route} label="Distance" value={fmtKm(track.length)} unit="km" />
            <HudMetric icon={Mountain} label="Dénivelé" value={track.gainTotal != null ? `${track.gainTotal}` : "—"} unit="m D+" />
            <HudMetric icon={Clock} label="Durée estimée" value={fmtClock(Math.round(estimatedS))} unit="" />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function HudMetric({
  icon: Icon,
  label,
  value,
  unit,
}: {
  icon: typeof Route;
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="min-w-0 px-2.5 text-center">
      <div className="flex items-center justify-center gap-1 text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-600">
        <Icon size={9} /> {label}
      </div>
      <div className="num mt-1 truncate text-[15px] font-semibold text-slate-100">
        {value} <span className="text-[8.5px] font-medium text-slate-500">{unit}</span>
      </div>
    </div>
  );
}
