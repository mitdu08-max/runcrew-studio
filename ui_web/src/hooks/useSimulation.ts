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
}

interface SavedEntry {
  waypoints: Pt[];
  activity: Activity;
  loopClosed: boolean;
}

const LS_KEY = "rc_saved_tracks";

export function useSimulation() {
  const [activity, setActivity] = useState<Activity>("running");
  const [speedKmh, setSpeedKmh] = useState(11);
  const [waypoints, setWaypoints] = useState<Pt[]>([]);
  const [loopClosed, setLoopClosed] = useState(true);
  const [phase, setPhase] = useState<RoutePhase>("empty");
  const [track, setTrack] = useState<TrackState | null>(null);
  const [departureEle, setDepartureEle] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [savedNames, setSavedNames] = useState<string[]>([]);
  const [flySignal, setFlySignal] = useState<{ lat: number; lon: number; seq: number } | null>(null);

  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const trackRef = useRef<TrackState | null>(null);
  trackRef.current = track;
  const speedRef = useRef(speedKmh);
  speedRef.current = speedKmh;
  const depEleRef = useRef(departureEle);
  depEleRef.current = departureEle;

  // compteurs de session (refs pour le tick 4 Hz)
  const prog = useRef(0);
  const session = useRef(0);
  const lapsN = useRef(0);
  const gainR = useRef(0);
  const lossR = useRef(0);
  const prevAlt = useRef<number | null>(null);
  const elapsed = useRef(0);

  // ---- parcours sauvegardés (format compatible avec ta version .exe) ----
  const refreshSaved = useCallback(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      setSavedNames(Object.keys(s));
    } catch {
      setSavedNames([]);
    }
  }, []);

  useEffect(refreshSaved, [refreshSaved]);

  // ---- altitude du point de départ dès le 1er clic (fix "315 m ignoré") ----
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
            : null
        );
        setPhase("empty");
        return;
      }
      setPhase("routing");
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
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints, activity, loopClosed]);

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
      // Fallback honnête : on affiche l'altitude réelle du départ (plate),
      // jamais une sinusoïde fantaisiste.
      const base = depEleRef.current;
      alt = base != null ? base : null;
    }

    setTelemetry({
      lat: cur.pos[0],
      lon: cur.pos[1],
      heading,
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
    });
  }, []);

  useEffect(() => {
    if (!running || paused) return;
    const iv = setInterval(() => advance(0.25), 250);
    return () => clearInterval(iv);
  }, [running, paused, advance]);

  // ---- actions ----
  const start = useCallback((): boolean => {
    const t = trackRef.current;
    if (!t || t.points.length < 2) return false;
    prog.current = 0;
    session.current = 0;
    lapsN.current = 0;
    gainR.current = 0;
    lossR.current = 0;
    elapsed.current = 0;
    prevAlt.current = t.ele ? t.ele[0] : depEleRef.current;
    setRunning(true);
    setPaused(false);
    advance(0); // 1re position immédiate : altitude = élévation réelle du départ
    return true;
  }, [advance]);

  const stop = useCallback(() => {
    setRunning(false);
    setPaused(false);
    setTelemetry(null);
  }, []);

  const togglePause = useCallback(() => setPaused((p) => !p), []);

  const addWaypoint = useCallback((p: Pt) => setWaypoints((w) => [...w, p]), []);
  const undoWaypoint = useCallback(() => setWaypoints((w) => (w.length ? w.slice(0, -1) : w)), []);
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
  }, []);
  const toggleLoop = useCallback((v: boolean) => setLoopClosed(v), []);

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
      return true;
    },
    [waypoints, activity, loopClosed, refreshSaved]
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
      return true;
    },
    []
  );

  const exportGpx = useCallback((): string | null => {
    const t = trackRef.current;
    if (!t || t.points.length < 2 || !t.ele) return null;
    return buildGpx(t.points, t.ele, t.cum, speedRef.current, "Parcours RunCrew");
  }, []);

  return {
    activity,
    setActivity,
    speedKmh,
    setSpeedKmh,
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
    flySignal,
    start,
    stop,
    togglePause,
    addWaypoint,
    undoWaypoint,
    clearTrack,
    saveTrack,
    loadTrack,
    exportGpx,
  };
}
