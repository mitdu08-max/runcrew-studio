import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, Maximize2 } from "lucide-react";
import type { Pt } from "../lib/geo";
import { positionAtM } from "../lib/geo";
import type { Activity, Telemetry, TrackState } from "../hooks/useSimulation";

const ACT_COLOR: Record<Activity, string> = {
  running: "#00e676",
  cycling: "#38bdf8",
  hiking: "#ffab00",
  pacer: "#e879f9",
};

interface Props {
  waypoints: Pt[];
  track: TrackState | null;
  telemetry: Telemetry | null;
  activity: Activity;
  departureEle: number | null;
  flySignal: { lat: number; lon: number; seq: number } | null;
  probeM: number | null;
  onMapClick: (p: Pt) => void;
}

function runnerIcon(color: string, heading: number) {
  return L.divIcon({
    className: "",
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    html: `<div style="position:relative;width:42px;height:42px">
      <div class="runner-pulse" style="position:absolute;inset:7px;border-radius:50%;background:${color}"></div>
      <div style="position:absolute;inset:10px;border-radius:50%;background:${color};border:2.5px solid #05070b;box-shadow:0 0 16px ${color}dd;display:flex;align-items:center;justify-content:center">
        <svg width="15" height="15" viewBox="0 0 24 24" style="transform:rotate(${Math.round(heading)}deg)" fill="#05070b"><path d="M12 2 L19 21 L12 16.5 L5 21 Z"/></svg>
      </div>
    </div>`,
  });
}

function wpIcon(index: number, isOrigin: boolean, color: string) {
  const ring = isOrigin ? color : "#38bdf8";
  return L.divIcon({
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<div style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#0b0e15;border:2px solid ${ring};color:${ring};font:800 10.5px 'JetBrains Mono',monospace;box-shadow:0 0 12px ${ring}66">${index + 1}</div>`,
  });
}

export default function MapView(props: Props) {
  const { waypoints, track, telemetry, activity, departureEle, flySignal, probeM } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const glowRef = useRef<L.Polyline | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const wpLayerRef = useRef<L.LayerGroup | null>(null);
  const runnerRef = useRef<L.Marker | null>(null);
  const probeRef = useRef<L.CircleMarker | null>(null);
  const cbRef = useRef(props.onMapClick);
  cbRef.current = props.onMapClick;
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);

  // ---- init ----
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([43.4217, 6.675192], 16);
    map.attributionControl.setPrefix(false);
    map.zoomControl.setPosition("bottomright");

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: "abcd",
      attribution: "© OpenStreetMap © CARTO — Élévation : Open-Meteo SRTM",
    }).addTo(map);

    glowRef.current = L.polyline([], { weight: 11, opacity: 0.18, lineJoin: "round" }).addTo(map);
    lineRef.current = L.polyline([], { weight: 5, opacity: 0.95, lineJoin: "round" }).addTo(map);
    wpLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      cbRef.current([e.latlng.lat, e.latlng.lng]);
    });
    map.on("dragstart", () => {
      followRef.current = false;
      setFollow(false);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- trace ----
  useEffect(() => {
    const color = ACT_COLOR[activity];
    const pts = track?.points ?? [];
    glowRef.current?.setLatLngs(pts).setStyle({ color });
    lineRef.current?.setLatLngs(pts).setStyle({ color });
  }, [track, activity]);

  // ---- waypoints ----
  useEffect(() => {
    const layer = wpLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    waypoints.forEach((p, i) => {
      const m = L.marker(p, {
        icon: wpIcon(i, i === 0, ACT_COLOR[activity]),
        interactive: false,
      });
      if (i === 0 && departureEle != null) {
        m.bindTooltip(`DÉPART · ${Math.round(departureEle)} M`, {
          permanent: true,
          direction: "right",
          offset: [14, 0],
          className: "dep-tt",
        });
      }
      layer.addLayer(m);
    });
  }, [waypoints, activity, departureEle]);

  // ---- runner ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!telemetry) {
      if (runnerRef.current) {
        map.removeLayer(runnerRef.current);
        runnerRef.current = null;
      }
      return;
    }
    const ll: L.LatLngExpression = [telemetry.lat, telemetry.lon];
    const color = ACT_COLOR[activity];
    if (!runnerRef.current) {
      runnerRef.current = L.marker(ll, {
        icon: runnerIcon(color, telemetry.heading),
        interactive: false,
        zIndexOffset: 900,
      }).addTo(map);
    } else {
      runnerRef.current.setLatLng(ll);
      runnerRef.current.setIcon(runnerIcon(color, telemetry.heading));
    }
    if (followRef.current) map.panTo(ll, { animate: true, duration: 0.45 });
  }, [telemetry, activity]);

  // ---- flyTo ----
  useEffect(() => {
    if (flySignal && mapRef.current) {
      mapRef.current.flyTo([flySignal.lat, flySignal.lon], 16, { duration: 1 });
    }
  }, [flySignal]);

  // ---- sonde (hover du profil) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (probeM == null || !track || !track.ele) {
      if (probeRef.current) {
        map.removeLayer(probeRef.current);
        probeRef.current = null;
      }
      return;
    }
    const cur = positionAtM(track.points, track.cum, probeM);
    if (!probeRef.current) {
      probeRef.current = L.circleMarker(cur.pos, {
        radius: 7,
        color: "#ffab00",
        weight: 2,
        fillColor: "#ffab00",
        fillOpacity: 0.25,
        interactive: false,
      }).addTo(map);
    } else {
      probeRef.current.setLatLng(cur.pos);
    }
  }, [probeM, track]);

  const recenter = () => {
    if (track && track.points.length > 1 && mapRef.current) {
      mapRef.current.flyToBounds(L.latLngBounds(track.points as L.LatLngExpression[]).pad(0.12), {
        duration: 0.9,
      });
    }
  };

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />
      {/* auto-suivi */}
      <button
        onClick={() => {
          const v = !follow;
          setFollow(v);
          followRef.current = v;
        }}
        className={`absolute right-4 top-4 z-[1000] flex items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-bold tracking-wide backdrop-blur-md transition-all ${
          follow
            ? "border-volt/60 bg-ink/85 text-volt shadow-[0_0_24px_rgba(0,230,118,.25)]"
            : "border-line bg-ink/85 text-slate-500 hover:text-slate-300"
        }`}
      >
        <Crosshair size={13} />
        AUTO-SUIVI : {follow ? "ON" : "OFF"}
      </button>
      {/* recadrer */}
      <button
        onClick={recenter}
        title="Recadrer sur le parcours"
        className="absolute bottom-24 right-4 z-[1000] flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-ink/85 text-slate-400 backdrop-blur-md transition-colors hover:border-volt/50 hover:text-volt"
      >
        <Maximize2 size={14} />
      </button>
    </div>
  );
}
