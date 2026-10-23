// ============================================================================
// RunCrew — Moteur de simulation GPS temps réel (4 Hz)
// Altitude issue du profil réel interpolé par distance — plus JAMAIS figée.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pt,
  cumulativeM,
  totalM,
  positionAtM,
  bearingDeg,
  eleAtM,
  slopeAtM,
  gainLoss,
  buildGpx,
} from "../lib/geo";
import { buildRoute } from "../lib/routing";
import { fetchDenseProfile, fetchPointElevation } from "../lib/elevation";

export type Activity = "running" | "cycling" | "hiking" | "pacer";
export type RoutePhase = "empty" | "routing" | "elevation" | "ready" | "direct";
export type GpsMode = "nominal" | "degraded" | "lost";
export type EventTone = "info" | "success" | "warning";

export interface TrackState {
  points: Pt[];
  cum: number[];
  length: number;
  ele: number[] | null;
  minEle: number | null;
  maxEle: number | null;
  gainTotal: number | null;
  lossTotal: number | null;
  fallback: boolean;
}

export interface Telemetry {
  lat: number;
  lon: number;
  heading: number;
  alt: number | null;
  slope: number | null;
  speedKmh: number;
  progressM: number;
  sessionM: number;
  laps: number;
  gain: number;
  loss: number;
  elapsedS: number;
  eleReal: boolean;
  accuracy: number | null;
  gpsMode: GpsMode;
}

export interface SessionEvent {
  id: number;
  wallTime: string;
  elapsedS: number;
  message: string;
  tone: EventTone;
}

interface SavedEntry {
  waypoints: Pt[];
  activity: Activity;
  loopClosed: boolean;
}

const LS_KEY = "rc_saved_tracks";
const DEMO_LOOP: Pt[] = [
  [43.4217, 6.675192],
  [43.42415, 6.6809],
  [43.41865, 6.68365],
  [43.41695, 6.67645],
];

export function useSimulation() {
  const [activity, setActivity] = useState<Activity>("running");
  const [speedKmh, setSpeedKmh] = useState(11);
  const [timeScale, setTimeScaleState] = useState(1);
  const [gpsMode, setGpsModeState] = useState<GpsMode>("nominal");
  const [waypoints, setWaypoints] = useState<Pt[]>([]);
  const [loopClosed, setLoopClosed] = useState(true);
  const [phase, setPhase] = useState<RoutePhase>("empty");
  const [track, setTrack] = useState<TrackState | null>(null);
  const [departureEle, setDepartureEle] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [savedNames, setSavedNames] = useState<string[]>([]);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [flySignal, setFlySignal] = useState<{ lat: number; lon: number; seq: number } | null>(null);

  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const trackRef = useRef<TrackState | null>(null);
  trackRef.current = track;
  const speedRef = useRef(speedKmh);
  speedRef.current = speedKmh;
  const timeScaleRef = useRef(timeScale);
  timeScaleRef.current = timeScale;
  const gpsModeRef = useRef(gpsMode);
  gpsModeRef.current = gpsMode;
  const depEleRef = useRef(departureEle);
  depEleRef.current = departureEle;

  // Compteurs de session (refs pour le tick 4 Hz).
  const prog = useRef(0);
  const session = useRef(0);
  const lapsN = useRef(0);
  const gainR = useRef(0);
  const lossR = useRef(0);
  const prevAlt = useRef<number | null>(null);
  const elapsed = useRef(0);
  const lastFix = useRef<{ pos: Pt; alt: number | null; heading: number } | null>(null);
  const eventId = useRef(0);

  const logEvent = useCallback((message: string, tone: EventTone = "info") => {
    const event: SessionEvent = {
      id: ++eventId.current,
      wallTime: new Date().toLocaleTimeString("fr-FR", { hour12: false }),
      elapsedS: elapsed.current,
      message,
      tone,
    };
    setEvents((current) => [...current.slice(-79), event]);
  }, []);

  const [connectedPhones, setConnectedPhones] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: any = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      try {
        const host = window.location.hostname || "127.0.0.1";
        ws = new WebSocket(`ws://${host}:9876/dashboard`);
        ws.onopen = () => {
          if (disposed) return;
          wsRef.current = ws;
        };
        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if (data.type === "clients" && typeof data.phones === "number") {
              setConnectedPhones(data.phones);
            }
          } catch (_) {}
        };
        ws.onclose = () => {
          if (disposed) return;
          wsRef.current = null;
          timer = setTimeout(connect, 2000);
        };
        ws.onerror = () => {
          ws?.close();
        };
      } catch (_) {
        timer = setTimeout(connect, 2000);
      }
    }
    connect();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);

  // ---- parcours sauvegardés (format compatible avec la version .exe) ----
  const refreshSaved = useCallback(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      setSavedNames(Object.keys(s));
    } catch {
      setSavedNames([]);
    }
  }, []);

  useEffect(refreshSaved, [refreshSaved]);

  // ---- altitude du point de départ dès le 1er clic ----
  useEffect(() => {
    let alive = true;
    if (waypoints.length === 1) {
      fetchPointElevation(waypoints[0][0], waypoints[0][1])
        .then((e) => {
          if (alive && e != null) setDepartureEle(Math.round(e * 10) / 10);
        })
        .catch(() => {});
    } else if (waypoints.length === 0) {
      setDepartureEle(null);
    }
    return () => {
      alive = false;
    };
  }, [waypoints]);

  // ---- re-calcul de la trace + profil d'élévation à chaque changement ----
  useEffect(() => {
    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    (async () => {
      if (waypoints.length < 2) {
        const pts = waypoints.slice();
        setTrack(
          pts.length
            ? {
                points: pts,
                cum: cumulativeM(pts),
                length: totalM(pts),
                ele: null,
                minEle: null,
                maxEle: null,
                gainTotal: null,
                lossTotal: null,
                fallback: false,
              }
            : null,
        );
        setPhase("empty");
        return;
      }

      setPhase("routing");
      setTrack(null);
      const wps = waypoints.slice();
      if (loopClosed && waypoints.length > 2) wps.push(waypoints[0]);

      const route = await buildRoute(wps, activity, ac.signal);
      if (seq !== seqRef.current || ac.signal.aborted) return;

      setPhase("elevation");
      const ele = await fetchDenseProfile(route.points, ac.signal);
      if (seq !== seqRef.current || ac.signal.aborted) return;

      const cum = cumulativeM(route.points);
      let gl = { gain: 0, loss: 0 };
      let minE: number | null = null;
      let maxE: number | null = null;
      if (ele) {
        gl = gainLoss(ele);
        minE = Math.round(Math.min(...ele));
        maxE = Math.round(Math.max(...ele));
      }
      setTrack({
        points: route.points,
        cum,
        length: cum[cum.length - 1],
        ele,
        minEle: minE,
        maxEle: maxE,
        gainTotal: ele ? Math.round(gl.gain) : null,
        lossTotal: ele ? Math.round(gl.loss) : null,
        fallback: route.fallback,
      });
      setPhase(route.fallback ? "direct" : "ready");

      const distance = (cum[cum.length - 1] / 1000).toFixed(2);
      if (route.fallback) {
        logEvent(`Routage indisponible · trace directe de ${distance} km`, "warning");
      } else {
        logEvent(`Parcours synchronisé · ${distance} km`, "success");
      }
      if (!ele) logEvent("Élévation indisponible · altitude du départ conservée", "warning");
    })();
  }, [waypoints, activity, loopClosed, logEvent]);

  // ---- tick ----
  const advance = useCallback((dt: number) => {
    const t = trackRef.current;
    if (!t || t.points.length < 2 || t.length <= 0) return;
    const mps = speedRef.current / 3.6;
    let p = prog.current + mps * dt;
    const len = t.length;
    if (p >= len) {
      lapsN.current += Math.floor(p / len);
      p = p % len;
    }
    prog.current = p;
    session.current += mps * dt;
    elapsed.current += dt;

    const cur = positionAtM(t.points, t.cum, p);
    const ahead = positionAtM(t.points, t.cum, Math.min(len - 0.001, p + 8));
    const heading = bearingDeg(cur.pos, ahead.pos);

    let alt: number | null = null;
    let slope: number | null = null;
    let eleReal = false;

    if (t.ele) {
      const e = eleAtM(t.cum, t.ele, p);
      if (e != null) {
        eleReal = true;
        if (prevAlt.current != null) {
          const d = e - prevAlt.current;
          if (d > 0.05) gainR.current += d;
          else if (d < -0.05) lossR.current -= d;
        }
        prevAlt.current = e;
        alt = Math.round(e * 10) / 10;
        slope = slopeAtM(t.cum, t.ele, p);
      }
    } else {
      // Fallback honnête : altitude réelle du départ, jamais une sinusoïde inventée.
      alt = depEleRef.current;
    }

    // Les scénarios GPS altèrent le fix présenté, pas la trace de référence.
    // En perte de signal, le dernier fix reste visible pendant que le chrono avance.
    const mode = gpsModeRef.current;
    let displayPos = cur.pos;
    let displayHeading = heading;
    let accuracy: number | null = Math.round((2.8 + Math.abs(Math.sin(elapsed.current * 0.4)) * 0.8) * 10) / 10;

    if (mode !== "lost") {
      if (mode === "degraded") {
        const north = Math.sin(elapsed.current * 2.17) * 7 + Math.sin(elapsed.current * 0.73) * 4;
        const east = Math.cos(elapsed.current * 1.61) * 8 + Math.sin(elapsed.current * 0.51) * 5;
        displayPos = [
          cur.pos[0] + north / 111320,
          cur.pos[1] + east / (111320 * Math.max(0.2, Math.cos((cur.pos[0] * Math.PI) / 180))),
        ];
        displayHeading = (heading + Math.sin(elapsed.current * 1.9) * 22 + 360) % 360;
        accuracy = Math.round((18 + Math.abs(Math.sin(elapsed.current * 0.83)) * 14) * 10) / 10;
      }
      lastFix.current = { pos: displayPos, alt, heading: displayHeading };
    } else {
      accuracy = null;
      slope = null;
      if (lastFix.current) {
        displayPos = lastFix.current.pos;
        displayHeading = lastFix.current.heading;
        alt = lastFix.current.alt;
      }
    }

    setTelemetry({
      lat: displayPos[0],
      lon: displayPos[1],
      heading: displayHeading,
      alt,
      slope: slope != null ? Math.round(slope * 10) / 10 : null,
      speedKmh: speedRef.current,
      progressM: p,
      sessionM: session.current,
      laps: lapsN.current,
      gain: gainR.current,
      loss: lossR.current,
      elapsedS: elapsed.current,
      eleReal,
      accuracy,
      gpsMode: mode,
    });

    // 🚀 Diffusion automatique vers server.js et le smartphone
    const packet = {
      type: "position",
      lat: displayPos[0],
      lon: displayPos[1],
      lng: displayPos[1],
      heading: displayHeading,
      alt,
      altitude: alt,
      speedKmh: speedRef.current,
      speed: (speedRef.current * 1000) / 3600,
      accuracy: accuracy != null ? accuracy : 3.0,
      eleReal,
      gpsMode: mode,
    };
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(packet));
    } else {
      fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(packet),
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!running || paused) return;
    const iv = setInterval(() => advance(0.25 * timeScaleRef.current), 250);
    return () => clearInterval(iv);
  }, [running, paused, advance]);

  // ---- actions de pilotage ----
  const start = useCallback((): boolean => {
    const t = trackRef.current;
    if (!t || t.points.length < 2) return false;
    prog.current = 0;
    session.current = 0;
    lapsN.current = 0;
    gainR.current = 0;
    lossR.current = 0;
    elapsed.current = 0;
    lastFix.current = null;
    prevAlt.current = t.ele ? t.ele[0] : depEleRef.current;
    setRunning(true);
    setPaused(false);
    advance(0);
    logEvent(
      `Simulation démarrée · ${speedRef.current.toFixed(1)} km/h · ×${timeScaleRef.current}`,
      "success",
    );
    return true;
  }, [advance, logEvent]);

  const stop = useCallback(() => {
    logEvent(
      `Simulation arrêtée · ${(session.current / 1000).toFixed(2)} km · ${Math.round(elapsed.current)} s simulées`,
      "info",
    );
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "stop" }));
    } else {
      fetch("/api/inject_stop", { method: "POST" }).catch(() => {});
    }
    setRunning(false);
    setPaused(false);
    setTelemetry(null);
  }, [logEvent]);

  const togglePause = useCallback(() => {
    const nextPaused = !paused;
    setPaused(nextPaused);
    logEvent(nextPaused ? "Simulation mise en pause" : "Simulation reprise", nextPaused ? "info" : "success");
  }, [paused, logEvent]);

  const setTimeScale = useCallback(
    (value: number) => {
      const next = [1, 2, 4, 8].includes(value) ? value : 1;
      if (next === timeScaleRef.current) return;
      timeScaleRef.current = next;
      setTimeScaleState(next);
      logEvent(`Horloge de test réglée sur ×${next}`, "info");
    },
    [logEvent],
  );

  const setGpsMode = useCallback(
    (mode: GpsMode) => {
      if (mode === gpsModeRef.current) return;
      gpsModeRef.current = mode;
      setGpsModeState(mode);
      if (mode === "nominal") logEvent("Signal GPS nominal rétabli", "success");
      else if (mode === "degraded") logEvent("GPS dégradé injecté · gigue et précision élargie", "warning");
      else logEvent("Perte GPS injectée · conservation du dernier fix", "warning");
    },
    [logEvent],
  );

  // ---- actions de parcours ----
  const addWaypoint = useCallback(
    (p: Pt) => {
      setWaypoints((w) => [...w, p]);
      logEvent("Point de contrôle ajouté", "info");
    },
    [logEvent],
  );

  const moveWaypoint = useCallback(
    (index: number, p: Pt) => {
      setWaypoints((current) => current.map((point, i) => (i === index ? p : point)));
      logEvent(`Point ${index + 1} déplacé sur la carte`, "info");
    },
    [logEvent],
  );

  const removeWaypoint = useCallback(
    (index: number) => {
      setWaypoints((current) => current.filter((_, i) => i !== index));
      logEvent(`Point ${index + 1} supprimé`, "info");
    },
    [logEvent],
  );

  const undoWaypoint = useCallback(() => {
    setWaypoints((w) => (w.length ? w.slice(0, -1) : w));
    logEvent("Dernier point annulé", "info");
  }, [logEvent]);

  const clearTrack = useCallback(() => {
    setRunning(false);
    setPaused(false);
    setTelemetry(null);
    setWaypoints([]);
    setDepartureEle(null);
    seqRef.current++;
    abortRef.current?.abort();
    setTrack(null);
    setPhase("empty");
    logEvent("Parcours effacé", "info");
  }, [logEvent]);

  const toggleLoop = useCallback((v: boolean) => setLoopClosed(v), []);

  const loadDemo = useCallback(() => {
    setRunning(false);
    setPaused(false);
    setTelemetry(null);
    setActivity("running");
    setLoopClosed(true);
    setWaypoints(DEMO_LOOP);
    setFlySignal({ lat: DEMO_LOOP[0][0], lon: DEMO_LOOP[0][1], seq: Date.now() });
    logEvent("Boucle d’exemple chargée · Roquebrune", "success");
  }, [logEvent]);

  const saveTrack = useCallback(
    (name: string) => {
      if (!name.trim() || waypoints.length < 2) return false;
      let store: Record<string, SavedEntry> = {};
      try {
        store = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      } catch {}
      store[name.trim()] = { waypoints, activity, loopClosed };
      localStorage.setItem(LS_KEY, JSON.stringify(store));
      refreshSaved();
      logEvent(`Parcours « ${name.trim()} » sauvegardé`, "success");
      return true;
    },
    [waypoints, activity, loopClosed, refreshSaved, logEvent],
  );

  const loadTrack = useCallback(
    (name: string) => {
      let store: Record<string, SavedEntry> = {};
      try {
        store = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      } catch {}
      const entry = store[name];
      if (!entry || !Array.isArray(entry.waypoints)) return false;
      setRunning(false);
      setPaused(false);
      setTelemetry(null);
      setActivity(entry.activity || "running");
      setLoopClosed(entry.loopClosed !== false);
      setWaypoints(entry.waypoints);
      if (entry.waypoints.length > 0) {
        setFlySignal({ lat: entry.waypoints[0][0], lon: entry.waypoints[0][1], seq: Date.now() });
      }
      logEvent(`Parcours « ${name} » chargé`, "success");
      return true;
    },
    [logEvent],
  );

  const exportGpx = useCallback((): string | null => {
    const t = trackRef.current;
    if (!t || t.points.length < 2 || !t.ele) return null;
    logEvent("Export GPX avec élévations généré", "success");
    return buildGpx(t.points, t.ele, t.cum, speedRef.current, "Parcours RunCrew");
  }, [logEvent]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return {
    activity,
    setActivity,
    speedKmh,
    setSpeedKmh,
    timeScale,
    setTimeScale,
    gpsMode,
    setGpsMode,
    waypoints,
    loopClosed,
    toggleLoop,
    phase,
    track,
    departureEle,
    running,
    paused,
    telemetry,
    savedNames,
    events,
    logEvent,
    clearEvents,
    flySignal,
    start,
    stop,
    togglePause,
    addWaypoint,
    moveWaypoint,
    removeWaypoint,
    undoWaypoint,
    clearTrack,
    loadDemo,
    saveTrack,
    loadTrack,
    exportGpx,
    connectedPhones,
  };
}
