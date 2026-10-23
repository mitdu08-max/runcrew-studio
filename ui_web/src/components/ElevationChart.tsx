import { useMemo, useRef, useState } from "react";
import { Mountain, MousePointer2 } from "lucide-react";
import { decimateIdx, eleAtM, fmtKm } from "../lib/geo";
import type { TrackState } from "../hooks/useSimulation";

interface Props {
  track: TrackState | null;
  progressM: number | null;
  phase: string;
  onProbe: (d: number | null) => void;
}

export default function ElevationChart({ track, progressM, onProbe }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ d: number; x: number } | null>(null);

  const model = useMemo(() => {
    if (!track || !track.ele || track.ele.length < 2) return null;
    const cum = track.cum;
    const ele = track.ele;
    const n = ele.length;
    const idx = decimateIdx(n, 340);
    let min = Infinity, max = -Infinity;
    for (const e of ele) {
      if (e < min) min = e;
      if (e > max) max = e;
    }
    const pad = Math.max(6, (max - min) * 0.18);
    min -= pad;
    max += pad;
    const len = cum[n - 1] || 1;
    const W = 1000, H = 150;
    const pts = idx.map((i) => {
      const x = (cum[i] / len) * W;
      const y = H - ((ele[i] - min) / (max - min)) * (H - 8) - 4;
      return { x, y, d: cum[i], e: ele[i] };
    });
    // ticks km
    const km = len / 1000;
    const step = km > 25 ? 5000 : km > 10 ? 2000 : km > 4 ? 1000 : 500;
    const ticks: number[] = [];
    for (let d = 0; d <= len; d += step) ticks.push(d);
    // ticks altitude
    const eleTicks = [min + pad * 0.35, (min + max) / 2, max - pad * 0.35];
    return { pts, min, max, len, W, H, ticks, eleTicks };
  }, [track]);

  const linePath = useMemo(() => {
    if (!model) return "";
    const { pts } = model;
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
    return d;
  }, [model]);

  const areaPath = useMemo(() => {
    if (!model || !linePath) return "";
    const { pts, H } = model;
    return `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${H} L ${pts[0].x.toFixed(1)} ${H} Z`;
  }, [model, linePath]);

  const yFor = (e: number) => {
    if (!model) return 0;
    return model.H - ((e - model.min) / (model.max - model.min)) * (model.H - 8) - 4;
  };

  const cursor = progressM != null && model ? Math.min(1, Math.max(0, progressM / model.len)) : null;
  const cursorEle = progressM != null && track?.ele ? eleAtM(track.cum, track.ele, progressM) : null;
  const hoverEle = hover != null && track?.ele ? eleAtM(track.cum, track.ele, hover.d) : null;

  const handleMove = (e: React.MouseEvent) => {
    if (!model || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const d = x * model.len;
    setHover({ d, x });
    onProbe(d);
  };
  const handleLeave = () => {
    setHover(null);
    onProbe(null);
  };

  return (
    <div className="pointer-events-auto flex h-full flex-col">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.16em] text-slate-400">
          <Mountain size={12} className="text-amberx" />
          PROFIL D'ÉLÉVATION RÉEL
          <span className="hidden rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[9px] text-slate-500 sm:inline">
            OPEN-METEO SRTM · LISSÉ MA5
          </span>
        </div>
        {track?.ele && (
          <div className="num flex items-center gap-3 text-[10.5px] font-bold">
            <span className="text-slate-400">
              <span className="text-white">{track.minEle}</span>–<span className="text-white">{track.maxEle}</span> m
            </span>
            <span className="text-volt">D+ {track.gainTotal} m</span>
            <span className="text-rose-400">D− {track.lossTotal} m</span>
          </div>
        )}
      </div>

      <div
        ref={boxRef}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        className="relative min-h-0 flex-1 cursor-crosshair overflow-hidden rounded-lg"
      >
        {model ? (
          <>
            <svg
              viewBox={`0 0 ${model.W} ${model.H}`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
            >
              <defs>
                <linearGradient id="eleFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffab00" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="#ffab00" stopOpacity="0.03" />
                </linearGradient>
              </defs>
              {model.ticks.map((t) => (
                <line
                  key={t}
                  x1={(t / model.len) * model.W}
                  x2={(t / model.len) * model.W}
                  y1={0}
                  y2={model.H}
                  stroke="#ffffff"
                  strokeOpacity="0.05"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <path d={areaPath} fill="url(#eleFill)" />
              <path
                d={linePath}
                fill="none"
                stroke="#ffab00"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            </svg>

            {/* labels km */}
            {model.ticks.map((t) => (
              <span
                key={`l${t}`}
                className="num absolute bottom-0.5 -translate-x-1/2 text-[8.5px] font-semibold text-slate-600"
                style={{ left: `${(t / model.len) * 100}%` }}
              >
                {fmtKm(t, t >= 10000 ? 0 : 1)}
              </span>
            ))}
            {/* labels alt */}
            {model.eleTicks.map((e, i) => (
              <span
                key={`e${i}`}
                className="num absolute right-1 text-[8.5px] font-semibold text-amberx/50"
                style={{ top: `${(yFor(e) / model.H) * 100}%`, transform: "translateY(-50%)" }}
              >
                {Math.round(e)} m
              </span>
            ))}

            {/* curseur live */}
            {cursor != null && cursorEle != null && (
              <>
                <div
                  className="absolute inset-y-0 w-px bg-volt/70 shadow-[0_0_8px_rgba(0,230,118,.8)]"
                  style={{ left: `${cursor * 100}%` }}
                />
                <div
                  className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-volt shadow-[0_0_10px_rgba(0,230,118,1)] ring-2 ring-ink"
                  style={{
                    left: `${cursor * 100}%`,
                    top: `${(yFor(cursorEle) / model.H) * 100}%`,
                  }}
                />
              </>
            )}

            {/* sonde hover */}
            {hover != null && hoverEle != null && (
              <div
                className="tt-in pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-amberx/40 bg-ink/95 px-2 py-1 text-center shadow-xl"
                style={{ left: `${Math.min(92, Math.max(8, hover.x * 100))}%`, top: 4 }}
              >
                <div className="num text-[10px] font-bold text-amberx">{Math.round(hoverEle)} m</div>
                <div className="num text-[8.5px] font-semibold text-slate-500">{fmtKm(hover.d)} km</div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-600">
            <MousePointer2 size={16} />
            <p className="max-w-xs text-center text-[11px] leading-relaxed">
              Clique au moins <span className="font-bold text-slate-400">2 points</span> sur la carte :
              la trace suit la route (OSRM) puis le profil d'altitude <span className="font-bold text-amberx/80">réel</span> se dessine ici.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
