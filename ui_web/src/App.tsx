import { useEffect, useState } from "react";
import { MousePointerClick } from "lucide-react";
import { useSimulation } from "./hooks/useSimulation";
import TopBar from "./components/TopBar";
import Sidebar from "./components/Sidebar";
import MapView from "./components/MapView";
import ElevationChart from "./components/ElevationChart";
import DiagnosticModal from "./components/DiagnosticModal";

export default function App() {
  const sim = useSimulation();
  const [modalOpen, setModalOpen] = useState(true);
  const [probeM, setProbeM] = useState<number | null>(null);
  const [fly, setFly] = useState<{ lat: number; lon: number; seq: number } | null>(null);

  // flyTo déclenchés par le hook (chargement de parcours)
  useEffect(() => {
    if (sim.flySignal) setFly(sim.flySignal);
  }, [sim.flySignal]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink text-slate-100">
      <TopBar
        phase={sim.phase}
        eleOk={!!sim.track?.ele}
        pointCount={sim.waypoints.length}
        onOpenDiagnostic={() => setModalOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          sim={sim}
          onFly={(lat, lon) => setFly({ lat, lon, seq: Date.now() })}
        />

        <main className="relative min-w-0 flex-1">
          <MapView
            waypoints={sim.waypoints}
            track={sim.track}
            telemetry={sim.telemetry}
            activity={sim.activity}
            departureEle={sim.departureEle}
            flySignal={fly}
            probeM={probeM}
            onMapClick={sim.addWaypoint}
          />

          {/* invite au 1er clic */}
          {sim.waypoints.length === 0 && !sim.running && (
            <div className="pointer-events-none absolute left-1/2 top-16 z-[1000] -translate-x-1/2">
              <div className="tt-in flex items-center gap-2.5 rounded-2xl border border-volt/40 bg-ink/90 px-5 py-3 shadow-[0_10px_40px_rgba(0,0,0,.6)] backdrop-blur-md">
                <MousePointerClick size={16} className="text-volt" />
                <div className="text-[12px] font-semibold text-slate-300">
                  Clique sur la carte pour poser tes waypoints —
                  <span className="text-amberx"> l'altitude réelle se règle dès le 1er point</span>
                </div>
              </div>
            </div>
          )}

          {/* bandeau profil d'élévation */}
          <div className="absolute inset-x-0 bottom-0 z-[900] h-[182px] border-t border-line glass px-4 pb-2.5 pt-3">
            <ElevationChart
              track={sim.track}
              progressM={sim.telemetry ? sim.telemetry.progressM : null}
              phase={sim.phase}
              onProbe={setProbeM}
            />
          </div>
        </main>
      </div>

      <DiagnosticModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
