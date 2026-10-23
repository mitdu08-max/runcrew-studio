// ============================================================================
// RunCrew — Suivi de route OSRM (pied / vélo) avec repli en segments directs
// ============================================================================

import { Pt, totalM } from "./geo";

export interface RouteResult {
  points: Pt[];
  fallback: boolean;
}

export async function buildRoute(
  wps: Pt[],
  activity: string,
  signal?: AbortSignal
): Promise<RouteResult> {
  if (wps.length < 2) return { points: wps.slice(), fallback: false };
  const profile = activity === "cycling" ? "routed-bike" : "routed-foot";
  const coords = wps.map((p) => `${p[1]},${p[0]}`).join(";");
  const url =
    `https://routing.openstreetmap.de/${profile}/route/v1/driving/${coords}` +
    `?overview=full&geometries=geojson&steps=false&continue_straight=false`;
  try {
    const r = await fetch(url, { signal });
    const j = await r.json();
    if (j.code === "Ok" && j.routes && j.routes.length > 0) {
      const pts: Pt[] = j.routes[0].geometry.coordinates.map(
        (c: number[]) => [c[1], c[0]] as Pt
      );
      if (pts.length >= 2) return { points: pts, fallback: false };
    }
    throw new Error(j.code || "NoRoute");
  } catch {
    // Repli : segments directs entre waypoints
    return { points: wps.slice(), fallback: true };
  }
}

export function directLength(wps: Pt[]): number {
  return totalM(wps);
}
