import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Crosshair, Maximize2 } from "lucide-react";
import type { Pt } from "../lib/geo";
import { positionAtM } from "../lib/geo";
import type { Activity, GpsMode, Telemetry, TrackState } from "../hooks/useSimulation";

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
  locked: boolean;
  onMapClick: (p: Pt) => void;
  onMoveWaypoint: (index: number, p: Pt) => void;
}

function runnerIcon(color: string, heading: number, mode: GpsMode) {
  const displayColor = mode === "lost" ? "#94a3b8" : color;
  return L.divIcon({
    className: "",
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    html: `<div style="position:relative;width:42px;height:42px">
      ${mode === "lost" ? "" : `<div class="runner-pulse" style="position:absolute;inset:7px;border-radius:50%;background:${displayColor}"></div>`}
      <div style="position:absolute;inset:10px;border-radius:50%;background:${displayColor};border:2.5px solid #080b10;box-shadow:0 0 16px ${displayColor}99;display:flex;align-items:center;justify-content:center">
        <svg width="15" height="15" viewBox="0 0 24 24" style="transform:rotate(${Math.round(heading)}deg)" fill="#080b10"><path d="M12 2 L19 21 L12 16.5 L5 21 Z"/></svg>
      </div>
    </div>`,
  });
}

function wpIcon(index: number, isOrigin: boolean, color: string, draggable: boolean) {
  const ring = isOrigin ? color : "#38bdf8";
  return L.divIcon({
    className: `wp-marker${draggable ? " is-draggable" : ""}`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#0d1218;border:2px solid ${ring};color:${ring};font:800 10px 'JetBrains Mono',monospace;box-shadow:0 3px 12px #0009">${index + 1}</div>`,
  });
}

export default function MapView(props: Props) {
  const { waypoints, track, telemetry, activity, departureEle, flySignal, probeM, locked } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const glowRef = useRef<L.Polyline | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const wpLayerRef = useRef<L.LayerGroup | null>(null);
  const runnerRef = useRef<L.Marker | null>(null);
  const accuracyRef = useRef<L.Circle | null>(null);
  const probeRef = useRef<L.CircleMarker | null>(null);
  const cbRef = useRef(props.onMapClick);
  cbRef.current = props.onMapClick;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);

  // ---- initialisation ----
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: true,
    }).setView([43.4217, 6.675192], 16);
    map.attributionControl.setPrefix(false);
    map.zoomControl.setPosition("bottomright");

    // Tuiles sans clé API (OpenStreetMap avec filtre sombre + secours Esri Dark)
    map.createPane("paneDark");
    const darkPane = map.getPane("paneDark");
    if (darkPane) {
      darkPane.style.zIndex = "200";
      darkPane.style.filter = "invert(1) hue-rotate(180deg) brightness(.92) contrast(.9) saturate(.22)";
    }

    const osmDark = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      pane: "paneDark",
      maxZoom: 19,
      attribution: "© OpenStreetMap · Élévation Open-Meteo SRTM",
    });

    const esriDark = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution: "© Esri · © OpenStreetMap",
      }
    );

    osmDark.addTo(map);

    let tileBroken = false;
    osmDark.on("tileerror", () => {
      if (tileBroken) return;
      tileBroken = true;
      map.removeLayer(osmDark);
      esriDark.addTo(map);
    });

    L.control.scale({ position: "bottomleft", imperial: false }).addTo(map);
    glowRef.current = L.polyline([], { weight: 12, opacity: 0.13, lineJoin: "round" }).addTo(map);
    lineRef.current = L.polyline([], { weight: 4, opacity: 0.95, lineJoin: "round" }).addTo(map);
    wpLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (event: L.LeafletMouseEvent) => {
      if (!lockedRef.current) cbRef.current([event.latlng.lat, event.latlng.lng]);
    });
    map.on("dragstart", () => {
      followRef.current = false;
      setFollow(false);
    });

    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(containerRef.current);
    mapRef.current = map;

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- trace ----
  useEffect(() => {
    const color = ACT_COLOR[activity];
    const points = track?.points ?? [];
    glowRef.current?.setLatLngs(points).setStyle({ color });
    lineRef.current?.setLatLngs(points).setStyle({ color });
  }, [track, activity]);

  // Recadre une nouvelle trace avant le départ, sans jamais reprendre la main en session.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !track || track.points.length < 2 || runnerRef.current) return;
    map.flyToBounds(L.latLngBounds(track.points as L.LatLngExpression[]).pad(0.12), { duration: 0.65 });
  }, [track]);

  // ---- waypoints déplaçables ----
  useEffect(() => {
    const layer = wpLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    waypoints.forEach((point, index) => {
      const marker = L.marker(point, {
        icon: wpIcon(index, index === 0, ACT_COLOR[activity], !locked),
        interactive: !locked,
        draggable: !locked,
        autoPan: true,
      });
      if (!locked) {
        marker.on("dragend", () => {
          const position = marker.getLatLng();
          props.onMoveWaypoint(index, [position.lat, position.lng]);
        });
      }
      if (index === 0 && departureEle != null) {
        marker.bindTooltip(`DÉPART · ${Math.round(departureEle)} M`, {
          permanent: true,
          direction: "right",
          offset: [14, 0],
          className: "dep-tt",
        });
      }
      layer.addLayer(marker);
    });
  }, [waypoints, activity, departureEle, locked, props.onMoveWaypoint]);

  // ---- coureur + précision GPS ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!telemetry) {
      if (runnerRef.current) map.removeLayer(runnerRef.current);
      if (accuracyRef.current) map.removeLayer(accuracyRef.current);
      runnerRef.current = null;
      accuracyRef.current = null;
      return;
    }
    const latLng: L.LatLngExpression = [telemetry.lat, telemetry.lon];
    const color = ACT_COLOR[activity];
    if (!runnerRef.current) {
      runnerRef.current = L.marker(latLng, {
        icon: runnerIcon(color, telemetry.heading, telemetry.gpsMode),
        interactive: false,
        zIndexOffset: 900,
      }).addTo(map);
    } else {
      runnerRef.current.setLatLng(latLng);
      runnerRef.current.setIcon(runnerIcon(color, telemetry.heading, telemetry.gpsMode));
    }

    if (telemetry.accuracy != null && telemetry.gpsMode !== "lost") {
      const accuracyColor = telemetry.gpsMode === "degraded" ? "#ffab00" : color;
      if (!accuracyRef.current) {
        accuracyRef.current = L.circle(latLng, {
          radius: telemetry.accuracy,
          color: accuracyColor,
          weight: 1,
          opacity: 0.45,
          fillColor: accuracyColor,
          fillOpacity: 0.06,
          interactive: false,
        }).addTo(map);
      } else {
        accuracyRef.current.setLatLng(latLng).setRadius(telemetry.accuracy).setStyle({ color: accuracyColor, fillColor: accuracyColor });
      }
    } else if (accuracyRef.current) {
      map.removeLayer(accuracyRef.current);
      accuracyRef.current = null;
    }

    if (followRef.current) map.panTo(latLng, { animate: true, duration: 0.45 });
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
      if (probeRef.current) map.removeLayer(probeRef.current);
      probeRef.current = null;
      return;
    }
    const current = positionAtM(track.points, track.cum, probeM);
    if (!probeRef.current) {
      probeRef.current = L.circleMarker(current.pos, {
        radius: 7,
        color: "#ffab00",
        weight: 2,
        fillColor: "#ffab00",
        fillOpacity: 0.25,
        interactive: false,
      }).addTo(map);
    } else {
      probeRef.current.setLatLng(current.pos);
    }
  }, [probeM, track]);

  const recenter = () => {
    if (!mapRef.current) return;
    if (track && track.points.length > 1) {
      mapRef.current.flyToBounds(L.latLngBounds(track.points as L.LatLngExpression[]).pad(0.12), { duration: 0.9 });
    } else if (waypoints.length > 0) {
      mapRef.current.flyTo(waypoints[0], 17, { duration: 0.7 });
    }
  };

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute right-4 top-4 z-[1000] flex flex-col items-end gap-2">
        <button
          onClick={() => {
            const value = !follow;
            setFollow(value);
            followRef.current = value;
          }}
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[9.5px] font-semibold backdrop-blur-xl transition-all ${
            follow
              ? "border-volt/35 bg-ink/85 text-volt"
              : "border-line bg-ink/85 text-slate-500 hover:text-slate-300"
          }`}
          aria-pressed={follow}
        >
          <Crosshair size={13} />
          <span className="hidden sm:inline">Auto-suivi</span>
          <span className={`h-1.5 w-1.5 rounded-full ${follow ? "bg-volt" : "bg-slate-600"}`} />
        </button>
        <button
          onClick={recenter}
          title="Recadrer sur le parcours"
          aria-label="Recadrer sur le parcours"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-ink/85 text-slate-400 backdrop-blur-xl transition-colors hover:border-volt/40 hover:text-volt"
        >
          <Maximize2 size={14} />
        </button>
      </div>
    </div>
  );
}
