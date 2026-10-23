import { BookOpen, CheckCircle2, FlaskConical, Loader2, Menu, MousePointer2, Route, TriangleAlert } from "lucide-react";
import type { RoutePhase } from "../hooks/useSimulation";

interface Props {
  phase: RoutePhase;
  eleOk: boolean;
  pointCount: number;
  connectedPhones?: number;
  onOpenDiagnostic: () => void;
  onToggleSidebar: () => void;
}

const PHASES: Record<RoutePhase, { label: string; className: string }> = {
  empty: { label: "En attente d’un parcours", className: "border-line bg-panel-2 text-slate-500" },
  routing: { label: "Calcul de l’itinéraire", className: "border-sky-400/25 bg-sky-400/[0.07] text-sky-300" },
  elevation: { label: "Lecture de l’altitude réelle", className: "border-amberx/25 bg-amberx/[0.07] text-amberx" },
  ready: { label: "Parcours synchronisé", className: "border-volt/25 bg-volt/[0.07] text-volt" },
  direct: { label: "Mode direct · routage indisponible", className: "border-amberx/25 bg-amberx/[0.07] text-amberx" },
};

export default function TopBar({ phase, eleOk, pointCount, connectedPhones = 0, onOpenDiagnostic, onToggleSidebar }: Props) {
  const busy = phase === "routing" || phase === "elevation";
  const meta = PHASES[phase];
  const label = phase === "ready" && !eleOk ? "Tracé prêt · altitude du départ" : meta.label;

  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-panel/95 px-3 backdrop-blur-xl sm:px-4">
      <button
        onClick={onToggleSidebar}
        className="rounded-lg border border-line p-2 text-slate-400 transition-colors hover:text-white lg:hidden"
        aria-label="Ouvrir les réglages"
      >
        <Menu size={18} />
      </button>

      <div className="flex items-center gap-3">
        <div className="brand-mark flex h-9 w-9 items-center justify-center rounded-xl bg-volt text-ink">
          <Route size={19} strokeWidth={2.4} />
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-bold tracking-[0.14em] text-white">
            RUNCREW <span className="text-volt">STUDIO</span>
          </div>
          <div className="mt-1 hidden text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-600 sm:block">
            Laboratoire de télémétrie · v3
          </div>
        </div>
      </div>

      <div className="mx-2 hidden h-7 w-px bg-line md:block" />

      <div className={`hidden min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[9.5px] font-semibold md:flex ${meta.className}`} role="status">
        {busy ? (
          <Loader2 size={11} className="spin shrink-0" />
        ) : phase === "ready" ? (
          <CheckCircle2 size={11} className="shrink-0" />
        ) : phase === "direct" ? (
          <TriangleAlert size={11} className="shrink-0" />
        ) : (
          <MousePointer2 size={11} className="shrink-0" />
        )}
        <span className="truncate">{label}</span>
        {pointCount > 0 && <span className="num rounded-full bg-black/20 px-1.5 py-0.5 text-[8px] opacity-75">{pointCount} pts</span>}
      </div>

      <div className="flex-1" />

      <div className="hidden items-center gap-2 rounded-full border border-line bg-panel-2/60 px-3 py-1.5 text-[8.5px] font-bold tracking-[0.12em] sm:flex">
        {connectedPhones > 0 ? (
          <span className="flex items-center gap-1.5 text-volt">
            <span className="inline-block h-2 w-2 rounded-full bg-volt animate-pulse" />
            {connectedPhones} TÉLÉPHONE{connectedPhones > 1 ? "S" : ""} CONNECTÉ{connectedPhones > 1 ? "S" : ""} (ADB)
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-slate-500">
            <FlaskConical size={11} className="text-volt" />
            EN ATTENTE TÉLÉPHONE (ADB)
          </span>
        )}
      </div>

      <button
        onClick={onOpenDiagnostic}
        className="flex items-center gap-2 rounded-xl border border-line bg-panel-2/60 px-3 py-2 text-[10px] font-semibold text-slate-400 transition-colors hover:border-slate-600 hover:text-white"
        title="Guide technique, correctif d’altitude et fichiers de compilation"
      >
        <BookOpen size={14} />
        <span className="hidden xl:inline">Guide technique</span>
      </button>
    </header>
  );
}
