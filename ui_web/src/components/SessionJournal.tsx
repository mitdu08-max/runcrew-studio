import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, FileJson, FileText, Info, ScrollText, Trash2 } from "lucide-react";
import type { EventTone, useSimulation } from "../hooks/useSimulation";
import { downloadFile, fileDate } from "../lib/download";
import { fmtClock } from "../lib/geo";

type Sim = ReturnType<typeof useSimulation>;

const TONE_ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
} as const;

const TONE_COLOR = {
  info: "text-sky-300 bg-sky-400/10 border-sky-400/20",
  success: "text-volt bg-volt/10 border-volt/20",
  warning: "text-amberx bg-amberx/10 border-amberx/20",
} as const;

export default function SessionJournal({ sim }: { sim: Sim }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [sim.events.length]);

  const exportJson = () => {
    const report = {
      schema: "runcrew.studio.session-report/v1",
      exportedAt: new Date().toISOString(),
      configuration: {
        activity: sim.activity,
        speedKmh: sim.speedKmh,
        timeScale: sim.timeScale,
        gpsMode: sim.gpsMode,
        loopClosed: sim.loopClosed,
      },
      route: sim.track
        ? {
            distanceMeters: Math.round(sim.track.length * 10) / 10,
            gainMeters: sim.track.gainTotal,
            lossMeters: sim.track.lossTotal,
            minElevation: sim.track.minEle,
            maxElevation: sim.track.maxEle,
            elevationSource: sim.track.ele ? "Open-Meteo SRTM" : "unavailable",
            directFallback: sim.track.fallback,
            waypoints: sim.waypoints.map(([lat, lon]) => ({ lat, lon })),
          }
        : null,
      telemetry: sim.telemetry,
      events: sim.events,
    };
    downloadFile(
      `runcrew-rapport-${fileDate()}.json`,
      JSON.stringify(report, null, 2),
      "application/json;charset=utf-8",
    );
    sim.logEvent("Rapport de session JSON exporté", "success");
  };

  const exportCsv = () => {
    const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [
      ["horodatage", "temps_simule", "secondes_simulees", "niveau", "evenement"],
      ...sim.events.map((event) => [
        event.wallTime,
        fmtClock(event.elapsedS),
        Math.round(event.elapsedS),
        event.tone,
        event.message,
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(escape).join(";")).join("\r\n")}`;
    downloadFile(`runcrew-journal-${fileDate()}.csv`, csv, "text/csv;charset=utf-8");
    sim.logEvent("Journal CSV exporté", "success");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.05] px-4 py-2">
        <p className="truncate text-[10px] text-slate-500">
          Un historique horodaté pour comparer tes tests et retrouver le contexte d’un bug.
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={exportJson}
            disabled={sim.events.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-[9.5px] font-semibold text-slate-300 transition-colors hover:border-volt/35 hover:text-volt disabled:opacity-35"
            title="Exporter le rapport complet avec configuration et télémétrie"
          >
            <FileJson size={12} /> Rapport JSON
          </button>
          <button
            onClick={exportCsv}
            disabled={sim.events.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-[9.5px] font-semibold text-slate-300 transition-colors hover:border-volt/35 hover:text-volt disabled:opacity-35"
            title="Exporter les événements pour Excel ou Sheets"
          >
            <FileText size={12} /> CSV
          </button>
          <button
            onClick={sim.clearEvents}
            disabled={sim.events.length === 0}
            className="rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-30"
            title="Vider le journal"
            aria-label="Vider le journal"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2" aria-live="polite">
        {sim.events.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-3 text-slate-600">
            <ScrollText size={20} />
            <div>
              <div className="text-[11px] font-semibold text-slate-400">Le journal est prêt.</div>
              <div className="mt-0.5 text-[10px]">Les actions, changements de scénario et exports seront consignés ici.</div>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {sim.events.map((event) => (
              <JournalRow key={event.id} tone={event.tone} wallTime={event.wallTime} elapsedS={event.elapsedS} message={event.message} />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>
    </div>
  );
}

function JournalRow({
  tone,
  wallTime,
  elapsedS,
  message,
}: {
  tone: EventTone;
  wallTime: string;
  elapsedS: number;
  message: string;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <div className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.025]">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${TONE_COLOR[tone]}`}>
        <Icon size={12} />
      </span>
      <span className="num w-[62px] shrink-0 text-[9px] text-slate-600">{wallTime}</span>
      <span className="num w-[46px] shrink-0 text-[9px] text-slate-500">+{fmtClock(elapsedS)}</span>
      <span className="min-w-0 flex-1 text-[10.5px] leading-relaxed text-slate-300">{message}</span>
    </div>
  );
}
