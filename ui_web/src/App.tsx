import { useEffect, useRef, useState } from "react";
import { MousePointerClick, Play, Sparkles } from "lucide-react";
import { useSimulation } from "./hooks/useSimulation";
import TopBar from "./components/TopBar";
import Sidebar from "./components/Sidebar";
import MapView from "./components/MapView";
import LiveHud from "./components/LiveHud";
import BottomDock, { type DockTab } from "./components/BottomDock";
import DiagnosticModal from "./components/DiagnosticModal";

export default function App() {
  const sim = useSimulation();
  const simRef = useRef(sim);
  simRef.current = sim;
  const [modalOpen, setModalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dockTab, setDockTab] = useState<DockTab>("profile");
  const [probeM, setProbeM] = useState<number | null>(null);
  const [fly, setFly] = useState<{ lat: number; lon: number; seq: number } | null>(null);

  useEffect(() => {
    if (sim.flySignal) setFly(sim.flySignal);
  }, [sim.flySignal]);

  // Raccourcis utiles sur un banc d’essai, sans capter la saisie dans les champs.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing = !!target?.closest("input, textarea, select, button, [contenteditable='true']");

      if (event.key === "Escape") {
        setModalOpen(false);
        setSidebarOpen(false);
        return;
      }
      if (isEditing) return;

      if (event.code === "Space") {
        event.preventDefault();
        const current = simRef.current;
        if (current.running) current.togglePause();
        else current.start();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        const current = simRef.current;
        if (!current.running && current.waypoints.length > 0) {
          event.preventDefault();
          current.undoWaypoint();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink text-slate-100">
      <TopBar
        phase={sim.phase}
        eleOk={!!sim.track?.ele}
        pointCount={sim.waypoints.length}
        onOpenDiagnostic={() => setModalOpen(true)}
        onToggleSidebar={() => setSidebarOpen((value) => !value)}
      />

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <button
            className="fixed inset-0 z-[1500] bg-ink/70 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Fermer les réglages"
          />
        )}

        <Sidebar
          sim={sim}
          onFly={(lat, lon) => setFly({ lat, lon, seq: Date.now() })}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onOpenJournal={() => {
            setDockTab("journal");
            setSidebarOpen(false);
          }}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <MapView
              waypoints={sim.waypoints}
              track={sim.track}
              telemetry={sim.telemetry}
              activity={sim.activity}
              departureEle={sim.departureEle}
              flySignal={fly}
              probeM={probeM}
              locked={sim.running}
              onMapClick={sim.addWaypoint}
              onMoveWaypoint={sim.moveWaypoint}
            />

            <LiveHud sim={sim} />

            {sim.waypoints.length === 0 && !sim.running && (
              <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center p-5">
                <div className="empty-state pointer-events-auto w-full max-w-[380px] rounded-2xl border border-white/[0.09] bg-ink/85 p-6 text-center shadow-2xl backdrop-blur-xl">
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-volt/25 bg-volt/10 text-volt">
                    <MousePointerClick size={20} />
                  </div>
                  <div className="mt-4 text-[9px] font-bold uppercase tracking-[0.2em] text-volt">Nouveau terrain de test</div>
                  <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.04em] text-white">Trace. Simule. Vérifie.</h1>
                  <p className="mx-auto mt-2 max-w-[300px] text-[11.5px] leading-relaxed text-slate-400">
                    Clique sur la carte pour poser tes points. RunCrew calcule la route et son altitude réelle.
                  </p>
                  <button
                    onClick={sim.loadDemo}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-volt px-4 py-3 text-[11px] font-bold text-ink transition-colors hover:bg-[#35ed91]"
                  >
                    <Sparkles size={14} /> Essayer avec une boucle d’exemple
                  </button>
                  <div className="mt-3 flex items-center justify-center gap-1.5 text-[9px] text-slate-600">
                    <Play size={9} /> Le simulateur ne démarre qu’à ta demande
                  </div>
                </div>
              </div>
            )}

            {sim.waypoints.length === 1 && !sim.running && (
              <div className="tt-in pointer-events-none absolute left-1/2 top-4 z-[1000] -translate-x-1/2 rounded-xl border border-sky-400/25 bg-ink/90 px-4 py-2.5 text-center text-[10px] font-medium text-slate-300 shadow-xl backdrop-blur-xl">
                Premier point posé. <span className="text-sky-300">Ajoute une destination sur la carte.</span>
              </div>
            )}
          </div>

          <BottomDock sim={sim} tab={dockTab} onTabChange={setDockTab} onProbe={setProbeM} />
        </main>
      </div>

      <DiagnosticModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
