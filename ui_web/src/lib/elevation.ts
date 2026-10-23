// ============================================================================
// RunCrew — MOTEUR D'ÉLÉVATION RÉELLE (correctif du bug "altitude figée")
// ----------------------------------------------------------------------------
// AVANT : altitude = 50 + sin(progress * 0.005) * 15  →  sinusoïde synthétique
//         figée autour de 50 m (~52 m au démarrage), terrain jamais consulté.
// APRÈS : échantillonnage Open-Meteo (SRTM 90 m, sans clé API) le long de la
//         géométrie OSRM, interpolation par DISTANCE CUMULÉE, lissage MA5.
// ============================================================================

import { Pt, cumulativeM, decimateIdx, movingAvg } from "./geo";

const API = "https://api.open-meteo.com/v1/elevation";
const BATCH = 96; // Open-Meteo accepte ~100 coordonnées / requête

async function fetchElevBatch(lats: string, lons: string, signal?: AbortSignal): Promise<(number | null)[]> {
  const url = `${API}?latitude=${lats}&longitude=${lons}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { signal });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      if (Array.isArray(j.elevation)) return j.elevation as (number | null)[];
    } catch {
      if (attempt === 1) return [];
      await new Promise((res) => setTimeout(res, 500));
    }
  }
  return [];
}

/**
 * Construit un profil d'altitude DENSE (une altitude par point de trace),
 * interpolé depuis un échantillonnage intelligent (1 pt / ~110 m, 30..180 pts).
 * Retourne null si l'API est injoignable (le caller applique le fallback).
 */
export async function fetchDenseProfile(points: Pt[], signal?: AbortSignal): Promise<number[] | null> {
  if (points.length === 0) return null;
  if (points.length === 1) {
    const e = await fetchPointElevation(points[0][0], points[0][1], signal);
    return e == null ? null : [e];
  }

  const cum = cumulativeM(points);
  const total = cum[cum.length - 1];
  const target = Math.max(30, Math.min(180, Math.round(total / 110)));
  const idx = decimateIdx(points.length, target);

  const sampleEle: (number | null)[] = new Array(idx.length).fill(null);
  for (let b = 0; b < idx.length; b += BATCH) {
    if (signal?.aborted) return null;
    const slice = idx.slice(b, b + BATCH);
    const lats = slice.map((i) => points[i][0].toFixed(5)).join(",");
    const lons = slice.map((i) => points[i][1].toFixed(5)).join(",");
    const res = await fetchElevBatch(lats, lons, signal);
    for (let k = 0; k < res.length; k++) sampleEle[b + k] = res[k];
  }

  const valid = sampleEle.filter((e) => e != null && Number.isFinite(e)) as number[];
  if (valid.length < idx.length * 0.4) return null; // API trop dégradée → fallback

  // Remplit les trous par le voisin valide le plus proche
  const filled = sampleEle.map((e, i) => {
    if (e != null && Number.isFinite(e)) return e;
    for (let r = 1; r < idx.length; r++) {
      const a = sampleEle[i - r], b2 = sampleEle[i + r];
      if (a != null && Number.isFinite(a)) return a;
      if (b2 != null && Number.isFinite(b2)) return b2;
    }
    return valid[0];
  });

  // Interpolation dense keyed-by-distance (cherche binaire sur les échantillons)
  const sampleDist = idx.map((i) => cum[i]);
  const dense = new Array<number>(points.length);
  for (let i = 0; i < points.length; i++) {
    const d = cum[i];
    if (d <= sampleDist[0]) { dense[i] = filled[0]; continue; }
    if (d >= sampleDist[sampleDist.length - 1]) { dense[i] = filled[filled.length - 1]; continue; }
    let lo = 0, hi = sampleDist.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (sampleDist[mid] <= d) lo = mid;
      else hi = mid;
    }
    const seg = sampleDist[lo + 1] - sampleDist[lo];
    const t = seg > 0 ? (d - sampleDist[lo]) / seg : 0;
    dense[i] = filled[lo] + (filled[lo + 1] - filled[lo]) * t;
  }

  // Lissage MAV (fenêtre 5) : supprime le bruit de quantification du MNT
  return movingAvg(dense, 2).map((e) => Math.round(e * 10) / 10);
}

/** Élévation d'un point isolé (utilisé pour le point de départ dès le 1er clic). */
export async function fetchPointElevation(lat: number, lon: number, signal?: AbortSignal): Promise<number | null> {
  const res = await fetchElevBatch(lat.toFixed(5), lon.toFixed(5), signal);
  const e = res[0];
  return e != null && Number.isFinite(e) ? e : null;
}
