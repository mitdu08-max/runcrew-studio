import { useState } from "react";
import { ChevronDown, ChevronUp, Mountain, ScrollText } from "lucide-react";
import type { useSimulation } from "../hooks/useSimulation";
import ElevationChart from "./ElevationChart";
import SessionJournal from "./SessionJournal";

type Sim = ReturnType<typeof useSimulation>;
export type DockTab = "profile" | "journal";

interface Props {
  sim: Sim;
  tab: DockTab;
  onTabChange: (tab: DockTab) => void;
  onProbe: (distance: number | null) => void;
}

export default function BottomDock({ sim, tab, onTabChange, onProbe }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section
      className={`relative z-[950] flex shrink-0 flex-col border-t border-line bg-panel/95 backdrop-blur-xl transition-[height] duration-200 ${
        collapsed ? "h-[47px]" : "h-[218px]"
      }`}
      aria-label="Analyse de session"
    >
      <div className="flex h-[46px] shrink-0 items-center justify-between gap-3 px-3 sm:px-4">
        <div className="flex h-full items-center gap-1" role="tablist" aria-label="Données de session">
          <DockButton
            active={tab === "profile"}
            onClick={() => {
              onTabChange("profile");
              setCollapsed(false);
            }}
            icon={Mountain}
            label="Profil d’élévation"
          />
          <DockButton
            active={tab === "journal"}
            onClick={() => {
              onTabChange("journal");
              setCollapsed(false);
            }}
            icon={ScrollText}
            label="Journal de test"
            count={sim.events.length}
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 text-[9px] font-medium text-slate-600 md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-volt/70" />
            Moteur local · 4 Hz
            {sim.timeScale > 1 && <span className="num text-sky-300">×{sim.timeScale}</span>}
          </div>
          <button
            onClick={() => setCollapsed((value) => !value)}
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-200"
            aria-label={collapsed ? "Déployer le panneau" : "Réduire le panneau"}
            title={collapsed ? "Déployer le panneau" : "Réduire le panneau"}
          >
            {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className={`min-h-0 flex-1 border-t border-white/[0.04] ${tab === "profile" ? "px-3 pb-3 pt-2 sm:px-4" : ""}`}>
          {tab === "profile" ? (
            <ElevationChart
              track={sim.track}
              progressM={sim.telemetry?.progressM ?? null}
              phase={sim.phase}
              onProbe={onProbe}
            />
          ) : (
            <SessionJournal sim={sim} />
          )}
        </div>
      )}
    </section>
  );
}

function DockButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Mountain;
  label: string;
  count?: number;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative flex h-full items-center gap-2 border-b-2 px-2.5 text-[10px] font-semibold transition-colors sm:px-3 ${
        active ? "border-volt text-slate-100" : "border-transparent text-slate-500 hover:text-slate-300"
      }`}
    >
      <Icon size={13} className={active ? "text-volt" : ""} />
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{label === "Journal de test" ? "Journal" : "Élévation"}</span>
      {count != null && count > 0 && (
        <span className="num min-w-[18px] rounded-full bg-white/[0.07] px-1.5 py-0.5 text-center text-[8.5px] text-slate-400">
          {count}
        </span>
      )}
    </button>
  );
}
