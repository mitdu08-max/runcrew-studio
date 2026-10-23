import { Route, Mountain, Globe2, Loader2, Wrench } from "lucide-react";
import type { RoutePhase } from "../hooks/useSimulation";

interface Props {
  phase: RoutePhase;
  eleOk: boolean;
  pointCount: number;
  onOpenDiagnostic: () => void;
}

const phaseLabel: Record<RoutePhase, string> = {
  empty: "EN ATTENTE DE POINTS",
  routing: "Routage OSRM…",
  elevation: "Élévation SRTM…",
  ready: "Trace synchronisée",
  direct: "Repli segments directs",
};

export default function TopBar({ phase, eleOk, pointCount, onOpenDiagnostic }: Props) {
  const busy = phase === "routing" || phase === "elevation";
  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-4 border-b border-line bg-panel/90 px-4 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-volt shadow-[0_0_22px_rgba(0,230,118,.4)]">
          <Route size={17} strokeWidth={2.5} className="text-ink" />
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-bold tracking-[0.18em] text-white">
            RUNCREW <span className="text-volt">STUDIO</span>
          </div>
          <div className="text-[9.5px] font-semibold tracking-[0.14em] text-slate-500">
            MOTEUR GPS v2 · ALTITUDE RÉELLE
          </div>
        </div>
      </div>

      <div className="mx-1 h-6 w-px bg-line" />

      {/* statuts pipeline */}
      <div className="hidden items-center gap-2 md:flex">
        <span
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9.5px] font-bold tracking-wider ${
            busy
              ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
              : pointCount >= 2
                ? "border-volt/40 bg-volt/10 text-volt"
                : "border-line bg-panel-2 text-slate-500"
          }`}
        >
          {busy ? <Loader2 size={10} className="spin" /> : <Globe2 size={10} />}
          {phaseLabel[phase]}
        </span>
        <span
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9.5px] font-bold tracking-wider ${
            busy
              ? "border-amberx/40 bg-amberx/10 text-amberx"
              : eleOk
                ? "border-amberx/50 bg-amberx/10 text-amberx"
                : "border-line bg-panel-2 text-slate-500"
          }`}
        >
          {busy ? <Loader2 size={10} className="spin" /> : <Mountain size={10} />}
          ÉLÉVATION {eleOk ? "SRTM · OK" : "OPEN-METEO"}
        </span>
      </div>

      <div className="flex-1" />

      <button
        onClick={onOpenDiagnostic}
        className="group flex items-center gap-2 rounded-xl border border-amberx/50 bg-amberx/10 px-4 py-2 text-[11px] font-bold tracking-wide text-amberx transition-all hover:bg-amberx hover:text-ink hover:shadow-[0_0_28px_rgba(255,171,0,.4)]"
      >
        <Wrench size={13} className="transition-transform group-hover:-rotate-12" />
        <span className="hidden sm:inline">CORRECTIF ALTITUDE — BUG 52 M / 315 M</span>
        <span className="sm:hidden">CORRECTIF</span>
      </button>
    </header>
  );
}
