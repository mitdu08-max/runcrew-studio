// ============================================================================
// RunCrew — Géodésie & métriques GPS
// Toutes les distances en mètres, altitudes en mètres, vitesses en km/h.
// ============================================================================

export type Pt = [number, number]; // [lat, lon]

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distance great-circle (haversine) entre deux points. */
export function haversineM(a: Pt, b: Pt): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Distances cumulées le long de la trace (cum[0] = 0). */
export function cumulativeM(points: Pt[]): number[] {
  const cum = new Array<number>(points.length);
  cum[0] = 0;
  for (let i = 1; i < points.length; i++) {
    cum[i] = cum[i - 1] + haversineM(points[i - 1], points[i]);
  }
  return cum;
}

export function totalM(points: Pt[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += haversineM(points[i - 1], points[i]);
  return s;
}

/** Position exacte (interpolée) à une distance donnée le long de la trace. */
export function positionAtM(
  points: Pt[],
  cum: number[],
  d: number
): { pos: Pt; seg: number; t: number } {
  const n = points.length;
  if (n === 0) return { pos: [0, 0], seg: 0, t: 0 };
  if (n === 1 || d <= 0) return { pos: points[0], seg: 0, t: 0 };
  const len = cum[n - 1];
  if (d >= len) return { pos: points[n - 1], seg: n - 2, t: 1 };

  // recherche binaire du segment
  let lo = 0, hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const segLen = cum[lo + 1] - cum[lo];
  const t = segLen > 0 ? (d - cum[lo]) / segLen : 0;
  return {
    pos: [
      points[lo][0] + (points[lo + 1][0] - points[lo][0]) * t,
      points[lo][1] + (points[lo + 1][1] - points[lo][1]) * t,
    ],
    seg: lo,
    t,
  };
}

/** Cap (degrés, 0 = Nord) entre deux points. */
export function bearingDeg(a: Pt, b: Pt): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x =
    Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
    Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Altitude interpolée à une distance cumulée donnée (profil keyed-by-distance). */
export function eleAtM(cum: number[], ele: number[], d: number): number | null {
  const n = ele.length;
  if (n === 0) return null;
  if (d <= 0) return ele[0];
  if (d >= cum[n - 1]) return ele[n - 1];
  let lo = 0, hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const segLen = cum[lo + 1] - cum[lo];
  const t = segLen > 0 ? (d - cum[lo]) / segLen : 0;
  return ele[lo] + (ele[lo + 1] - ele[lo]) * t;
}

/** D+ / D- total avec seuil anti-bruit (0,6 m). */
export function gainLoss(ele: number[], threshold = 0.6): { gain: number; loss: number } {
  let gain = 0, loss = 0, acc = 0;
  for (let i = 1; i < ele.length; i++) {
    acc += ele[i] - ele[i - 1];
    if (acc >= threshold) { gain += acc; acc = 0; }
    else if (acc <= -threshold) { loss -= acc; acc = 0; }
  }
  return { gain, loss };
}

/** Pente instantanée (%) lissée sur une fenêtre ±win mètres. */
export function slopeAtM(cum: number[], ele: number[], d: number, win = 30): number | null {
  const len = cum[cum.length - 1];
  if (len < win * 2) return null;
  const e1 = eleAtM(cum, ele, Math.max(0, d - win));
  const e2 = eleAtM(cum, ele, Math.min(len, d + win));
  if (e1 == null || e2 == null) return null;
  const dd = Math.min(len, d + win) - Math.max(0, d - win);
  return dd > 0 ? ((e2 - e1) / dd) * 100 : null;
}

/** Indices uniformément répartis (toujours 0 et n-1 inclus). */
export function decimateIdx(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>();
  const step = (n - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.add(Math.round(i * step));
  out.add(0);
  out.add(n - 1);
  return Array.from(out).sort((a, b) => a - b);
}

/** Moyenne glissante (fenêtre 2w+1) pour lisser le profil. */
export function movingAvg(arr: number[], w = 2): number[] {
  const n = arr.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(n - 1, i + w); k++) {
      s += arr[k];
      c++;
    }
    out[i] = s / c;
  }
  return out;
}

// ----- formatage -----

export function fmtKm(m: number, digits = 2): string {
  return (m / 1000).toFixed(digits);
}

export function fmtPace(kmh: number): string {
  if (kmh <= 0.1) return "--:--";
  const pace = 60 / kmh;
  const mm = Math.floor(pace);
  const ss = Math.round((pace - mm) * 60);
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

export function fmtClock(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`
    : `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

// ----- export GPX (avec <ele>, timestamps simulés à la vitesse choisie) -----

export function buildGpx(
  points: Pt[],
  ele: number[],
  cum: number[],
  speedKmh: number,
  name: string
): string {
  const mps = Math.max(speedKmh / 3.6, 0.5);
  const t0 = Date.now();
  const rows = points.map((p, i) => {
    const time = new Date(t0 + (cum[i] / mps) * 1000).toISOString();
    const e = ele[i] != null ? `<ele>${ele[i].toFixed(1)}</ele>` : "";
    return `      <trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}">${e}<time>${time}</time></trkpt>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RunCrew Studio" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(name)}</name></metadata>
  <trk><name>${escapeXml(name)}</name><trkseg>
${rows.join("\n")}
  </trkseg></trk>
</gpx>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string)
  );
}
