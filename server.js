// ============================================================================
//  ██████╗ ██╗   ██╗███╗   ██╗ ██████╗██████╗ ███████╗██╗    ██╗
//  ██╔══██╗██║   ██║████╗  ██║██╔════╝██╔══██╗██╔════╝██║    ██║
//  ██████╔╝██║   ██║██╔██╗ ██║██║     ██████╔╝█████╗  ██║ █╗ ██║
//  ██╔══██╗██║   ██║██║╚██╗██║██║     ██╔══██╗██╔══╝  ██║███╗██║
//  ██║  ██║╚██████╔╝██║ ╚████║╚██████╗██║  ██║███████╗╚███╔███╔╝
//  ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝╚═╝  ╚═╝╚══════╝ ╚══╝╚══╝
//  S T U D I O   v3.0  —  Banc d'essai GPS complet
// ============================================================================
//  SOMMAIRE
//   §1  Bootstrap & gestion d'erreurs
//   §2  Ponts ADB multi-téléphones (fix connexion)
//   §3  Serveur WebSocket & clients
//   §4  État global
//   §5  Géodésie
//   §6  Piste d'athlétisme 400 m (8 couloirs, World Athletics)
//   §7  Moteur d'élévation réelle (Open-Meteo SRTM)
//   §8  Physiologie VMA / FC (Karvonen, Tanaka, zones)      [NOUVEAU v3]
//   §9  Moteur de séances (fractionné/seuil/pyramide/tabata/fartlek) [NOUVEAU v3]
//   §10 Diffusion & boucle de simulation
//   §11 Interface web (dashboard à onglets)
//   §12 API HTTP
//   §13 Démarrage
// ----------------------------------------------------------------------------
//  HISTORIQUE DES CORRECTIFS
//   v2.0  Altitude réelle SRTM (fin du bug "52 m figés" / point 315 m ignoré)
//   v2.1  Ponts ADB par numéro de série (fin du "more than one device")
//   v2.2  Pont direct armé : fix mock immédiat, Pacer sans attente GPS
//   v2.3  Mode piste d'athlétisme 400 m, 8 couloirs
//   v3.0  Moteur VMA + séances structurées à récupération automatique,
//         profil athlète (âge / FCmax / FC repos / VMA), FC simulée,
//         dashboard réorganisé en onglets.
// ============================================================================

// ===========================================================================
// §1  BOOTSTRAP
// ===========================================================================
const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const { WebSocketServer } = require('ws');

process.on('uncaughtException', (err) => {
  console.error('❌ [Erreur interne] :', err);
});

// ===========================================================================
// §2  PONTS ADB MULTI-TÉLÉPHONES
// ---------------------------------------------------------------------------
// Avant : un seul "adb reverse" global → échoue dès que 2 appareils sont
// branchés ("error: more than one device/emulator"), donc AUCUN tunnel.
// Après : tunnel par numéro de série + diag complet + ré-armement 4 s.
// ===========================================================================
const adbLogged = new Set();
const bridgeDevices = {};

function logOnce(key, msg) {
  if (!adbLogged.has(key)) {
    adbLogged.add(key);
    console.log(msg);
  }
}

function refreshAdbBridges() {
  exec('adb devices', { timeout: 6000 }, (err, stdout) => {
    if (err) {
      logOnce('noadb', '⚠️  [ADB] adb introuvable dans le PATH — installe les platform-tools Android.');
      return;
    }
    const lines = String(stdout).split(/\r?\n/).slice(1)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('*') && !/^list/i.test(l));
    const entries = lines.map(l => l.split(/\s+/)).filter(e => e[0]);
    const online = entries.filter(e => e[1] === 'device').map(e => e[0]);
    const unauthorized = entries.filter(e => e[1] === 'unauthorized').map(e => e[0]);
    const offline = entries.filter(e => e[1] === 'offline').map(e => e[0]);

    if (entries.length === 0) {
      logOnce('none', '🔌 [ADB] Aucun téléphone détecté — branche en USB et active "Débogage USB".');
    } else {
      adbLogged.delete('none');
    }
    unauthorized.forEach(s => logOnce('unauth:' + s,
      '⚠️  [ADB] ' + s + ' = UNAUTHORIZED → accepte la popup "Autoriser le débogage USB" sur le téléphone !'));
    offline.forEach(s => logOnce('offline:' + s,
      '⚠️  [ADB] ' + s + ' = OFFLINE → débranche puis rebranche le câble USB.'));

    online.forEach(serial => {
      if (bridgeDevices[serial] === 'ok') return;
      exec('adb -s ' + serial + ' reverse tcp:9876 tcp:9876', { timeout: 6000 }, (e2) => {
        if (!e2) {
          bridgeDevices[serial] = 'ok';
          logOnce('ok:' + serial, '✅ [ADB] Pont ouvert → ' + serial + '  (ws://localhost:9876 ⇄ ce PC)');
        } else {
          logOnce('ko:' + serial, '❌ [ADB] Pont impossible sur ' + serial + ' : ' + e2.message);
        }
      });
    });
    Object.keys(bridgeDevices).forEach(s => {
      if (online.indexOf(s) === -1) {
        delete bridgeDevices[s];
        adbLogged.delete('ok:' + s);
        adbLogged.delete('ko:' + s);
        console.log('🔌 [ADB] ' + s + ' débranché — pont supprimé du suivi.');
      }
    });
  });
}
refreshAdbBridges();
setInterval(refreshAdbBridges, 4000);

/** Libère un port occupé par un ancien Studio resté ouvert (Windows). */
function freePort(port, done) {
  const ps = 'Get-NetTCPConnection -LocalPort ' + port +
    ' -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }';
  exec('powershell -NoProfile -Command "' + ps + '"', () => setTimeout(done, 900));
}

// ===========================================================================
// §3  SERVEUR WEBSOCKET & CLIENTS
// ===========================================================================
const wsHttpServer = http.createServer();
const wss = new WebSocketServer({ server: wsHttpServer });
let clients = [];

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

function phoneCount() {
  return clients.filter(c => c._rcKind !== 'dashboard').length;
}

function pushClientsCount() {
  broadcast({ type: 'clients', phones: phoneCount(), total: clients.length });
}

wss.on('connection', (ws, req) => {
  const isDashboard = String((req && req.url) || '').indexOf('dashboard') !== -1;
  ws._rcKind = isDashboard ? 'dashboard' : 'phone';
  clients.push(ws);
  console.log(isDashboard
    ? '🖥️  Dashboard connecté (téléphones en ligne : ' + phoneCount() + ')'
    : '📱 TÉLÉPHONE connecté ! (téléphones en ligne : ' + phoneCount() + ')');
  pushClientsCount();

  // Armement direct : fix immédiat, sans attendre le moindre satellite
  if (!isDashboard) {
    setTimeout(() => {
      if (ws.readyState === 1) {
        broadcastCurrentPosition();
        broadcastWorkoutState();
        console.log('🎯 [PONT] Fix immédiat envoyé au téléphone (pas d\'attente GPS).');
      }
    }, 120);
  }
  updateIdleHeartbeat();

  ws.on('close', () => {
    clients = clients.filter(c => c !== ws);
    console.log((isDashboard ? '🖥️  Dashboard' : '📱 Téléphone') + ' déconnecté.');
    pushClientsCount();
    updateIdleHeartbeat();
  });
});

// ===========================================================================
// §4  ÉTAT GLOBAL
// ===========================================================================
let isRunning = false;
let isPaused = false;
let simInterval = null;

let rawTrack = [];               // [[lat, lon], ...]
let trackCum = [];               // distances cumulées (m)
let trackEle = null;             // profil d'altitude dense (m) ou null
let profileStatus = 'none';      // none | fetching | ok | fallback | client
let baseAlt = 60;
let totalTrackLengthMeters = 0;
let currentProgressMeters = 0;

let speedKmh = 11.0;             // vitesse courante (pilotée par la séance si active)
let manualSpeedKmh = 11.0;       // vitesse réglée à la main (hors séance)
let activity = 'running';

// compteurs de session
let sessionDistance = 0;
let elevGain = 0;
let elevLoss = 0;
let laps = 0;
let prevAlt = null;
let elapsedS = 0;

// pont direct / ancre
let armed = true;
let idleInterval = null;
let anchorPoint = null;
let anchorAlt = null;
let warpFrom = null;
let warpStart = 0;
let warpMs = 0;

// ===========================================================================
// §5  GÉODÉSIE
// ===========================================================================
function calculateDistance(p1, p2) {
  const R = 6371000;
  const dLat = (p2[0] - p1[0]) * Math.PI / 180;
  const dLon = (p2[1] - p1[1]) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(p1[0] * Math.PI / 180) * Math.cos(p2[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeCumulative(points) {
  const cum = new Array(points.length);
  cum[0] = 0;
  for (let i = 1; i < points.length; i++) {
    cum[i] = cum[i - 1] + calculateDistance(points[i - 1], points[i]);
  }
  return cum;
}

function getExactPositionAtDistance(points, cum, targetDist) {
  if (points.length === 0) return null;
  if (points.length === 1) return { pos: points[0], ratio: 0, seg: 0 };
  const len = cum[points.length - 1];
  if (targetDist <= 0) return { pos: points[0], ratio: 0, seg: 0 };
  if (targetDist >= len) return { pos: points[points.length - 1], ratio: 1, seg: points.length - 2 };
  let lo = 0, hi = points.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= targetDist) lo = mid; else hi = mid;
  }
  const segDist = cum[lo + 1] - cum[lo];
  const ratio = segDist > 0 ? (targetDist - cum[lo]) / segDist : 0;
  return {
    pos: [
      points[lo][0] + (points[lo + 1][0] - points[lo][0]) * ratio,
      points[lo][1] + (points[lo + 1][1] - points[lo][1]) * ratio
    ],
    ratio, seg: lo
  };
}

function bearingBetween(p1, p2) {
  const rad = Math.PI / 180;
  const y = Math.sin((p2[1] - p1[1]) * rad) * Math.cos(p2[0] * rad);
  const x = Math.cos(p1[0] * rad) * Math.sin(p2[0] * rad) -
    Math.sin(p1[0] * rad) * Math.cos(p2[0] * rad) * Math.cos((p2[1] - p1[1]) * rad);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function movingAvg(arr, w) {
  const n = arr.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(n - 1, i + w); k++) { s += arr[k]; c++; }
    out[i] = s / c;
  }
  return out;
}

// ===========================================================================
// §6  PISTE D'ATHLÉTISME 400 m — géométrie officielle World Athletics
// ---------------------------------------------------------------------------
// 2 droites de 84,39 m + 2 demi-cercles. Corde intérieure : rayon 36,50 m.
// Ligne de mesure : couloir 1 = +0,30 m ; couloirs 2-8 = +0,20 m.
// Largeur de couloir : 1,22 m. Sens anti-horaire (pelouse à gauche).
//   C1 400,00 · C2 407,04 · C3 414,70 · C4 422,37
//   C5 430,03 · C6 437,70 · C7 445,36 · C8 453,03
// ===========================================================================
const TRACK_STRAIGHT = 84.39;
const TRACK_KERB_R = 36.5;
const TRACK_LANE_W = 1.22;
const TRACK_LANES = 8;

let trackMode = false;
let trackLane = 1;
let trackBearing = 90;
let trackOrigin = null;
let trackLaneLength = 400;

function laneRadius(n) {
  return n <= 1 ? TRACK_KERB_R + 0.3 : TRACK_KERB_R + (n - 1) * TRACK_LANE_W + 0.2;
}
function laneLength(n) {
  return 2 * TRACK_STRAIGHT + 2 * Math.PI * laneRadius(n);
}
function laneTable() {
  const out = [];
  for (let n = 1; n <= TRACK_LANES; n++) {
    out.push({
      lane: n,
      length: Math.round(laneLength(n) * 100) / 100,
      radius: Math.round(laneRadius(n) * 100) / 100,
      stagger: Math.round((laneLength(n) - laneLength(1)) * 100) / 100
    });
  }
  return out;
}
function metersPerDegree(lat) {
  const p = lat * Math.PI / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    lon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p)
  };
}
function localToLatLon(origin, bearingDeg, x, y) {
  const t = bearingDeg * Math.PI / 180;
  const east = x * Math.sin(t) + y * Math.cos(t);
  const north = x * Math.cos(t) - y * Math.sin(t);
  const m = metersPerDegree(origin[0]);
  return [origin[0] + north / m.lat, origin[1] + east / m.lon];
}
function buildLanePolyline(origin, bearingDeg, n, stepM) {
  stepM = stepM || 2;
  const r1 = laneRadius(1);
  const r = laneRadius(n);
  const S = TRACK_STRAIGHT;
  const cx = S / 2, cy = r1;
  const L = (x, y) => localToLatLon(origin, bearingDeg, x + cx, y + cy);
  const pts = [];
  const nStraight = Math.max(2, Math.ceil(S / stepM));
  for (let i = 0; i < nStraight; i++) pts.push(L(-S / 2 + (S * i) / nStraight, -r));
  const nArc = Math.max(8, Math.ceil((Math.PI * r) / stepM));
  for (let i = 0; i < nArc; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / nArc;
    pts.push(L(S / 2 + r * Math.cos(a), r * Math.sin(a)));
  }
  for (let i = 0; i < nStraight; i++) pts.push(L(S / 2 - (S * i) / nStraight, r));
  for (let i = 0; i < nArc; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / nArc;
    pts.push(L(-S / 2 + r * Math.cos(a), r * Math.sin(a)));
  }
  pts.push(pts[0]);
  return pts;
}
function buildAllLanes(origin, bearingDeg) {
  const out = [];
  for (let n = 1; n <= TRACK_LANES; n++) out.push(buildLanePolyline(origin, bearingDeg, n, 3));
  return out;
}

// ===========================================================================
// §7  MOTEUR D'ÉLÉVATION RÉELLE (Open-Meteo SRTM 90 m, sans clé API)
// ---------------------------------------------------------------------------
// Remplace l'ancienne sinusoïde "50 + sin(x)*15" qui figeait l'altitude à ~52 m.
// ===========================================================================
function getJson(url) {
  if (typeof fetch === 'function') {
    return fetch(url).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function fetchElevBatch(points, idxSlice) {
  const lats = idxSlice.map(i => points[i][0].toFixed(5)).join(',');
  const lons = idxSlice.map(i => points[i][1].toFixed(5)).join(',');
  const url = 'https://api.open-meteo.com/v1/elevation?latitude=' + lats + '&longitude=' + lons;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const j = await getJson(url);
      if (Array.isArray(j.elevation)) return j.elevation;
    } catch (e) {
      if (attempt === 1) return [];
      await new Promise(res => setTimeout(res, 600));
    }
  }
  return [];
}

async function buildElevationProfile(points, cum) {
  if (points.length < 2) return null;
  const total = cum[cum.length - 1];
  const target = Math.max(30, Math.min(180, Math.round(total / 110)));
  const idxSet = new Set();
  if (points.length <= target) {
    for (let i = 0; i < points.length; i++) idxSet.add(i);
  } else {
    const step = (points.length - 1) / (target - 1);
    for (let i = 0; i < target; i++) idxSet.add(Math.round(i * step));
    idxSet.add(0); idxSet.add(points.length - 1);
  }
  const idx = Array.from(idxSet).sort((a, b) => a - b);

  const sampleEle = new Array(idx.length).fill(null);
  const BATCH = 96;
  for (let b = 0; b < idx.length; b += BATCH) {
    const slice = idx.slice(b, b + BATCH);
    const res = await fetchElevBatch(points, slice);
    for (let k = 0; k < res.length; k++) sampleEle[b + k] = res[k];
  }

  const validCount = sampleEle.filter(e => e != null && isFinite(e)).length;
  if (validCount < idx.length * 0.4) return null;

  const filled = sampleEle.map((e, i) => {
    if (e != null && isFinite(e)) return e;
    for (let r = 1; r < idx.length; r++) {
      const a = sampleEle[i - r], b2 = sampleEle[i + r];
      if (a != null && isFinite(a)) return a;
      if (b2 != null && isFinite(b2)) return b2;
    }
    return 60;
  });

  const sampleDist = idx.map(i => cum[i]);
  const dense = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const d = cum[i];
    if (d <= sampleDist[0]) { dense[i] = filled[0]; continue; }
    if (d >= sampleDist[sampleDist.length - 1]) { dense[i] = filled[filled.length - 1]; continue; }
    let lo = 0, hi = sampleDist.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (sampleDist[mid] <= d) lo = mid; else hi = mid;
    }
    const seg = sampleDist[lo + 1] - sampleDist[lo];
    const t = seg > 0 ? (d - sampleDist[lo]) / seg : 0;
    dense[i] = filled[lo] + (filled[lo + 1] - filled[lo]) * t;
  }
  return movingAvg(dense, 2).map(e => Math.round(e * 10) / 10);
}

function eleAtDistance(targetDist) {
  if (!trackEle || trackEle.length === 0) return null;
  const n = trackEle.length;
  if (targetDist <= 0) return trackEle[0];
  const len = trackCum[n - 1];
  if (targetDist >= len) return trackEle[n - 1];
  let lo = 0, hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (trackCum[mid] <= targetDist) lo = mid; else hi = mid;
  }
  const seg = trackCum[lo + 1] - trackCum[lo];
  const t = seg > 0 ? (targetDist - trackCum[lo]) / seg : 0;
  return Math.round((trackEle[lo] + (trackEle[lo + 1] - trackEle[lo]) * t) * 10) / 10;
}

// ===========================================================================
// §8  PHYSIOLOGIE — VMA / FRÉQUENCE CARDIAQUE                    [NOUVEAU v3]
// ---------------------------------------------------------------------------
// Karvonen : FC cible = FC repos + %FCR × (FCmax − FC repos)
// Tanaka    : FCmax ≈ 208 − 0,7 × âge      Astrand : 220 − âge
// Correspondance %VMA → %FCR : (pct − 0,30) / 0,70, bornée [0 ; 1]
// ===========================================================================
let athlete = {
  age: 35,
  fcRepos: 55,
  fcMax: 185,
  vma: 16.0,      // km/h
  poids: 70
};

let currentHr = athlete.fcRepos;   // FC simulée (avec inertie cardiaque)

const fcMaxTanaka = (age) => Math.round(208 - 0.7 * age);
const fcMaxAstrand = (age) => Math.round(220 - age);

function karvonen(pctHRR) {
  return Math.round(athlete.fcRepos + (athlete.fcMax - athlete.fcRepos) * pctHRR);
}
function pctVmaToHRR(pctVma) {
  const p = Math.max(0.3, Math.min(1.3, pctVma));
  return Math.max(0, Math.min(1, (p - 0.3) / 0.7));
}
function hrForIntensity(pctVma) {
  return karvonen(pctVmaToHRR(pctVma));
}
function paceString(kmh) {
  if (kmh <= 0.5) return '--:--';
  const p = 60 / kmh;
  const m = Math.floor(p);
  const s = Math.round((p - m) * 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

const ZONES = [
  { z: 1, name: 'Récupération', color: '#38bdf8', lo: 0.50, hi: 0.65 },
  { z: 2, name: 'Endurance',    color: '#00e676', lo: 0.65, hi: 0.75 },
  { z: 3, name: 'Tempo',        color: '#ffab00', lo: 0.75, hi: 0.85 },
  { z: 4, name: 'Seuil',        color: '#fb7185', lo: 0.85, hi: 0.95 },
  { z: 5, name: 'VMA / VO2max', color: '#e879f9', lo: 0.95, hi: 1.40 }
];

function zoneFor(pctVma) {
  for (let i = 0; i < ZONES.length; i++) if (pctVma < ZONES[i].hi) return ZONES[i];
  return ZONES[ZONES.length - 1];
}

/** Tableau VMA complet (50 % → 120 %). */
function vmaTable() {
  const steps = [0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.2];
  return steps.map(p => {
    const kmh = Math.round(athlete.vma * p * 10) / 10;
    const z = zoneFor(p);
    return {
      pct: Math.round(p * 100),
      kmh,
      pace: paceString(kmh),
      fc: hrForIntensity(p),
      zone: z.z,
      zoneName: z.name,
      zoneColor: z.color,
      d30: Math.round((kmh / 3.6) * 30),
      d45: Math.round((kmh / 3.6) * 45)
    };
  });
}

/** Temps de passage prédits sur les distances de référence. */
function predictions() {
  const rows = [
    { dist: '1000 m', m: 1000, pct: 1.00 },
    { dist: '3000 m', m: 3000, pct: 0.94 },
    { dist: '5 km',   m: 5000, pct: 0.90 },
    { dist: '10 km',  m: 10000, pct: 0.855 },
    { dist: 'Semi',   m: 21097, pct: 0.81 },
    { dist: 'Marathon', m: 42195, pct: 0.76 }
  ];
  return rows.map(r => {
    const kmh = athlete.vma * r.pct;
    const sec = (r.m / 1000 / kmh) * 3600;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.round(sec % 60);
    const pad = (v) => (v < 10 ? '0' + v : '' + v);
    return {
      dist: r.dist,
      time: h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s),
      pace: paceString(kmh),
      pct: Math.round(r.pct * 100)
    };
  });
}

// ===========================================================================
// §9  MOTEUR DE SÉANCES                                          [NOUVEAU v3]
// ---------------------------------------------------------------------------
// Une séance = liste de phases. Chaque phase porte une intensité en %VMA et
// une durée (secondes) OU une distance (mètres). La RÉCUPÉRATION EST AUTOMATIQUE :
// le moteur enchaîne effort → récup → effort sans aucune action de ta part,
// et pilote la vitesse diffusée au téléphone en temps réel.
// ===========================================================================
function warm(min) { return { kind: 'warmup', label: 'Échauffement ' + min + "'", pctVma: 0.62, durationS: min * 60 }; }
function cool(min) { return { kind: 'cooldown', label: 'Retour au calme ' + min + "'", pctVma: 0.55, durationS: min * 60 }; }

function intervalsTime(reps, workS, recS, pct, recPct, block) {
  const out = [];
  for (let i = 1; i <= reps; i++) {
    out.push({ kind: 'work', label: workS + 's @ ' + Math.round(pct * 100) + '% VMA', pctVma: pct, durationS: workS, rep: i, repTotal: reps, block: block });
    out.push({ kind: 'recovery', label: 'Récup ' + recS + 's', pctVma: recPct, durationS: recS, rep: i, repTotal: reps, block: block });
  }
  return out;
}

function intervalsDist(reps, distM, recS, pct, recPct) {
  const out = [];
  for (let i = 1; i <= reps; i++) {
    out.push({ kind: 'work', label: distM + ' m @ ' + Math.round(pct * 100) + '% VMA', pctVma: pct, distanceM: distM, rep: i, repTotal: reps });
    out.push({ kind: 'recovery', label: 'Récup ' + recS + 's', pctVma: recPct, durationS: recS, rep: i, repTotal: reps });
  }
  return out;
}

function buildSessions() {
  const S = [];

  // ---------- FRACTIONNÉ (VMA) ----------
  S.push({ id: '30-30', name: '30/30 — 2 × 8', family: 'Fractionné', icon: '⚡',
    desc: 'VMA courte classique. 2 blocs de 8 répétitions, récup 3\' entre blocs.',
    phases: [].concat([warm(15)], intervalsTime(8, 30, 30, 1.05, 0.50, 1),
      [{ kind: 'rest', label: 'Récup inter-blocs 3\'', pctVma: 0.50, durationS: 180 }],
      intervalsTime(8, 30, 30, 1.05, 0.50, 2), [cool(10)]) });

  S.push({ id: '30-15', name: '30/15 — 2 × 9', family: 'Fractionné', icon: '⚡',
    desc: 'Format densifié : récupération réduite à 15 s, charge cardiaque élevée.',
    phases: [].concat([warm(15)], intervalsTime(9, 30, 15, 1.05, 0.45, 1),
      [{ kind: 'rest', label: 'Récup inter-blocs 3\'', pctVma: 0.50, durationS: 180 }],
      intervalsTime(9, 30, 15, 1.05, 0.45, 2), [cool(10)]) });

  S.push({ id: '45-45', name: '45/45 — 2 × 6', family: 'Fractionné', icon: '⚡',
    desc: 'VMA moyenne : sollicitation cardiaque plus longue à chaque répétition.',
    phases: [].concat([warm(15)], intervalsTime(6, 45, 45, 1.02, 0.50, 1),
      [{ kind: 'rest', label: 'Récup inter-blocs 3\'', pctVma: 0.50, durationS: 180 }],
      intervalsTime(6, 45, 45, 1.02, 0.50, 2), [cool(10)]) });

  S.push({ id: '400', name: '8 × 400 m', family: 'Fractionné', icon: '🏟️',
    desc: 'VMA longue sur piste. Récup 1\'30 entre chaque 400 m.',
    phases: [].concat([warm(15)], intervalsDist(8, 400, 90, 1.05, 0.45), [cool(10)]) });

  S.push({ id: '1000', name: '5 × 1000 m', family: 'Fractionné', icon: '🏟️',
    desc: 'VMA longue à allure 3000 m. Récup 2\' en trot.',
    phases: [].concat([warm(15)], intervalsDist(5, 1000, 120, 0.97, 0.50), [cool(10)]) });

  // ---------- SEUIL ----------
  S.push({ id: 'seuil-2x20', name: 'Seuil 2 × 20\'', family: 'Seuil', icon: '🔥',
    desc: 'Seuil anaérobie à 85 % VMA, récup 3\' active. Développe le seuil lactique.',
    phases: [warm(15),
      { kind: 'work', label: '20\' @ 85% VMA', pctVma: 0.85, durationS: 1200, rep: 1, repTotal: 2 },
      { kind: 'recovery', label: 'Récup 3\'', pctVma: 0.55, durationS: 180 },
      { kind: 'work', label: '20\' @ 85% VMA', pctVma: 0.85, durationS: 1200, rep: 2, repTotal: 2 },
      cool(10)] });

  S.push({ id: 'seuil-3x10', name: 'Seuil 3 × 10\'', family: 'Seuil', icon: '🔥',
    desc: 'Seuil fractionné à 88 % VMA, récup 2\'30 entre les blocs.',
    phases: [warm(15),
      { kind: 'work', label: '10\' @ 88% VMA', pctVma: 0.88, durationS: 600, rep: 1, repTotal: 3 },
      { kind: 'recovery', label: 'Récup 2\'30', pctVma: 0.55, durationS: 150 },
      { kind: 'work', label: '10\' @ 88% VMA', pctVma: 0.88, durationS: 600, rep: 2, repTotal: 3 },
      { kind: 'recovery', label: 'Récup 2\'30', pctVma: 0.55, durationS: 150 },
      { kind: 'work', label: '10\' @ 88% VMA', pctVma: 0.88, durationS: 600, rep: 3, repTotal: 3 },
      cool(10)] });

  // ---------- PYRAMIDE ----------
  const ladder = [200, 400, 600, 800, 1000, 800, 600, 400, 200];
  const pyr = [warm(15)];
  ladder.forEach((d, i) => {
    const pct = d <= 200 ? 1.10 : d <= 400 ? 1.06 : d <= 600 ? 1.02 : d <= 800 ? 1.00 : 0.97;
    pyr.push({ kind: 'work', label: d + ' m @ ' + Math.round(pct * 100) + '%', pctVma: pct, distanceM: d, rep: i + 1, repTotal: ladder.length });
    pyr.push({ kind: 'recovery', label: 'Récup ' + (Math.round(d / 10) * 3) + 's', pctVma: 0.48, durationS: Math.round(d / 10) * 3 });
  });
  pyr.push(cool(10));
  S.push({ id: 'pyramide', name: 'Pyramide 200→1000→200', family: 'Pyramide', icon: '🔺',
    desc: 'Montée puis descente en distance. Récup proportionnelle à l\'effort.', phases: pyr });

  const ladderT = [1, 2, 3, 4, 5, 4, 3, 2, 1];
  const pyrT = [warm(15)];
  ladderT.forEach((m, i) => {
    const pct = m <= 1 ? 1.08 : m <= 2 ? 1.03 : m <= 3 ? 1.00 : m <= 4 ? 0.95 : 0.92;
    pyrT.push({ kind: 'work', label: m + '\' @ ' + Math.round(pct * 100) + '%', pctVma: pct, durationS: m * 60, rep: i + 1, repTotal: ladderT.length });
    pyrT.push({ kind: 'recovery', label: 'Récup ' + (m * 30) + 's', pctVma: 0.50, durationS: m * 30 });
  });
  pyrT.push(cool(10));
  S.push({ id: 'pyramide-temps', name: 'Pyramide 1\'→5\'→1\'', family: 'Pyramide', icon: '🔺',
    desc: 'Pyramide temporelle, récup égale à la moitié de l\'effort.', phases: pyrT });

  // ---------- TABATA ----------
  S.push({ id: 'tabata', name: 'Tabata 8 × 20/10', family: 'Tabata', icon: '💥',
    desc: 'Protocole original : 20 s à 170 % VMA / 10 s de récup. 4 minutes de feu.',
    phases: [].concat([warm(15)], intervalsTime(8, 20, 10, 1.70, 0.35, 1), [cool(10)]) });

  S.push({ id: 'tabata-2x', name: 'Tabata double 2 × 8', family: 'Tabata', icon: '💥',
    desc: 'Deux séries Tabata séparées de 5\' de récupération complète.',
    phases: [].concat([warm(15)], intervalsTime(8, 20, 10, 1.70, 0.35, 1),
      [{ kind: 'rest', label: 'Récup complète 5\'', pctVma: 0.45, durationS: 300 }],
      intervalsTime(8, 20, 10, 1.65, 0.35, 2), [cool(10)]) });

  // ---------- FARTLEK ----------
  const fk = [warm(15)];
  [{ m: 5, p: 0.87 }, { m: 4, p: 0.92 }, { m: 3, p: 0.96 }, { m: 2, p: 1.00 }, { m: 1, p: 1.08 }]
    .forEach((b, i) => {
      fk.push({ kind: 'work', label: b.m + '\' @ ' + Math.round(b.p * 100) + '%', pctVma: b.p, durationS: b.m * 60, rep: i + 1, repTotal: 5 });
      fk.push({ kind: 'recovery', label: 'Récup 2\'', pctVma: 0.55, durationS: 120 });
    });
  fk.push(cool(10));
  S.push({ id: 'fartlek', name: 'Fartlek 5-4-3-2-1', family: 'Fartlek', icon: '🌊',
    desc: 'Jeu d\'allures suédois : blocs dégressifs, intensité croissante.', phases: fk });

  const fn = [warm(10)];
  for (let i = 1; i <= 6; i++) {
    fn.push({ kind: 'work', label: '1\' @ 100%', pctVma: 1.00, durationS: 60, rep: i, repTotal: 6, block: 1 });
    fn.push({ kind: 'recovery', label: 'Récup 1\'', pctVma: 0.60, durationS: 60 });
  }
  for (let i = 1; i <= 4; i++) {
    fn.push({ kind: 'work', label: '2\' @ 92%', pctVma: 0.92, durationS: 120, rep: i, repTotal: 4, block: 2 });
    fn.push({ kind: 'recovery', label: 'Récup 1\'', pctVma: 0.60, durationS: 60 });
  }
  fn.push(cool(10));
  S.push({ id: 'fartlek-nature', name: 'Fartlek nature 30\'', family: 'Fartlek', icon: '🌊',
    desc: 'Alternance libre 1\'/1\' puis 2\'/1\' — sensations de terrain.', phases: fn });

  // ---------- TESTS ----------
  S.push({ id: 'demi-cooper', name: 'Test demi-Cooper 6\'', family: 'Test', icon: '🎯',
    desc: '6 minutes à fond : distance (m) ÷ 100 = VMA en km/h. Recalibre ta VMA.',
    phases: [warm(20), { kind: 'work', label: '6\' à fond', pctVma: 1.00, durationS: 360 }, cool(10)] });

  const vv = [warm(10)];
  for (let i = 0; i < 18; i++) {
    const kmh = 8 + i * 0.5;
    vv.push({ kind: 'work', label: 'Palier ' + (i + 1) + ' — ' + kmh.toFixed(1) + ' km/h',
      pctVma: kmh / Math.max(1, athlete.vma), durationS: 60, rep: i + 1, repTotal: 18, absKmh: kmh });
  }
  vv.push(cool(8));
  S.push({ id: 'vameval', name: 'VAMEVAL (paliers)', family: 'Test', icon: '🎯',
    desc: 'Paliers de 1\' : +0,5 km/h par minute à partir de 8 km/h.', phases: vv });

  return S;
}

let SESSIONS = buildSessions();

function sessionSummary(s) {
  let totalS = 0, totalM = 0, workS = 0, reps = 0;
  s.phases.forEach(p => {
    const kmh = p.absKmh != null ? p.absKmh : athlete.vma * p.pctVma;
    const mps = kmh / 3.6;
    let dur = p.durationS || 0;
    if (p.distanceM) dur = mps > 0 ? p.distanceM / mps : 0;
    totalS += dur;
    totalM += p.distanceM != null ? p.distanceM : mps * dur;
    if (p.kind === 'work') { workS += dur; reps++; }
  });
  return {
    totalS: Math.round(totalS),
    totalKm: Math.round(totalM / 10) / 100,
    workS: Math.round(workS),
    reps: reps
  };
}

function sessionCatalog() {
  return SESSIONS.map(s => {
    const sum = sessionSummary(s);
    return { id: s.id, name: s.name, family: s.family, icon: s.icon, desc: s.desc,
      totalS: sum.totalS, totalKm: sum.totalKm, reps: sum.reps, phases: s.phases.length };
  });
}

// ----- état d'exécution de la séance -----
let workout = null;        // séance active
let wkPhaseIdx = 0;
let wkPhaseElapsed = 0;    // s écoulées dans la phase
let wkPhaseDistance = 0;   // m parcourus dans la phase
let wkElapsed = 0;         // s depuis le début de la séance
let wkActive = false;

function currentPhase() {
  if (!wkActive || !workout) return null;
  return workout.phases[wkPhaseIdx] || null;
}

function phaseTargetKmh(p) {
  if (!p) return manualSpeedKmh;
  if (p.absKmh != null) return p.absKmh;
  return Math.round(athlete.vma * p.pctVma * 10) / 10;
}

/** Durée totale (s) d'une phase, distance convertie en temps si besoin. */
function phaseDurationS(p) {
  if (!p) return 0;
  if (p.durationS != null) return p.durationS;
  const kmh = phaseTargetKmh(p);
  return kmh > 0 ? p.distanceM / (kmh / 3.6) : 0;
}

function startWorkout(id) {
  const s = SESSIONS.filter(x => x.id === id)[0];
  if (!s) return false;
  workout = s;
  wkActive = true;
  wkPhaseIdx = 0;
  wkPhaseElapsed = 0;
  wkPhaseDistance = 0;
  wkElapsed = 0;
  speedKmh = phaseTargetKmh(workout.phases[0]);
  currentHr = athlete.fcRepos + 8;
  console.log('🏋️  [SÉANCE] ' + s.name + ' — ' + s.phases.length + ' phases — VMA ' + athlete.vma + ' km/h');
  broadcastWorkoutState();
  return true;
}

function stopWorkout() {
  if (!wkActive) return;
  wkActive = false;
  workout = null;
  speedKmh = manualSpeedKmh;
  console.log('🏋️  [SÉANCE] Terminée / arrêtée.');
  broadcast({ type: 'workout', active: false });
}

/** Passe à la phase suivante (récupération automatique). */
function nextPhase(auto) {
  if (!workout) return;
  wkPhaseIdx++;
  wkPhaseElapsed = 0;
  wkPhaseDistance = 0;
  if (wkPhaseIdx >= workout.phases.length) {
    console.log('🏁 [SÉANCE] ' + workout.name + ' TERMINÉE en ' + Math.round(wkElapsed / 60) + ' min !');
    broadcast({ type: 'workout', active: false, finished: true, name: workout.name, elapsedS: Math.round(wkElapsed) });
    wkActive = false;
    workout = null;
    speedKmh = manualSpeedKmh;
    return;
  }
  const p = currentPhase();
  speedKmh = phaseTargetKmh(p);
  if (auto) {
    const icon = p.kind === 'work' ? '🔴' : p.kind === 'recovery' ? '🟢' : p.kind === 'rest' ? '🔵' : '⚪';
    console.log(icon + ' [SÉANCE] ' + p.label + '  →  ' + speedKmh.toFixed(1) + ' km/h (' + paceString(speedKmh) + '/km)');
  }
  broadcastWorkoutState();
}

/** Avance le moteur de séance de dt secondes. */
function tickWorkout(dt, metersAdvanced) {
  if (!wkActive || !workout) return;
  const p = currentPhase();
  if (!p) return;
  wkPhaseElapsed += dt;
  wkPhaseDistance += metersAdvanced;
  wkElapsed += dt;

  // inertie cardiaque : la FC tend vers la cible avec ~25 s de constante
  const targetHr = hrForIntensity(p.pctVma);
  currentHr += (targetHr - currentHr) * (1 - Math.exp(-dt / 25));

  const done = p.distanceM != null
    ? wkPhaseDistance >= p.distanceM
    : wkPhaseElapsed >= p.durationS;
  if (done) nextPhase(true);
}

function workoutState() {
  if (!wkActive || !workout) return { type: 'workout', active: false };
  const p = currentPhase();
  const totalPhaseS = phaseDurationS(p);
  const remainS = p.distanceM != null
    ? Math.max(0, (p.distanceM - wkPhaseDistance) / Math.max(0.1, speedKmh / 3.6))
    : Math.max(0, p.durationS - wkPhaseElapsed);
  const nextP = workout.phases[wkPhaseIdx + 1] || null;
  const z = zoneFor(p.pctVma);
  return {
    type: 'workout',
    active: true,
    sessionId: workout.id,
    sessionName: workout.name,
    family: workout.family,
    phaseIndex: wkPhaseIdx,
    phaseCount: workout.phases.length,
    kind: p.kind,
    label: p.label,
    pctVma: Math.round(p.pctVma * 100),
    targetKmh: phaseTargetKmh(p),
    targetPace: paceString(phaseTargetKmh(p)),
    targetHr: hrForIntensity(p.pctVma),
    zone: z.z,
    zoneName: z.name,
    zoneColor: z.color,
    rep: p.rep || null,
    repTotal: p.repTotal || null,
    block: p.block || null,
    phaseElapsedS: Math.round(wkPhaseElapsed * 10) / 10,
    phaseTotalS: Math.round(totalPhaseS),
    phaseRemainS: Math.round(remainS * 10) / 10,
    phaseProgress: totalPhaseS > 0 ? Math.min(100, Math.round((wkPhaseElapsed / totalPhaseS) * 1000) / 10) : 0,
    phaseDistanceM: Math.round(wkPhaseDistance),
    phaseTargetM: p.distanceM || null,
    nextLabel: nextP ? nextP.label : 'Fin de séance',
    nextKind: nextP ? nextP.kind : null,
    elapsedS: Math.round(wkElapsed),
    hr: Math.round(currentHr)
  };
}

function broadcastWorkoutState() {
  broadcast(workoutState());
}

// ===========================================================================
// §10  DIFFUSION & BOUCLE DE SIMULATION
// ===========================================================================
function currentFixPoint() {
  if (rawTrack.length > 0 && trackCum.length > 0) {
    const cur = getExactPositionAtDistance(rawTrack, trackCum, currentProgressMeters);
    if (cur) return cur.pos;
  }
  return anchorPoint;
}

function updateIdleHeartbeat() {
  const shouldRun = armed && !isRunning && !!currentFixPoint() && clients.length > 0;
  if (shouldRun && !idleInterval) {
    idleInterval = setInterval(() => broadcastCurrentPosition(), 1000);
    console.log('🎯 [PONT ARMÉ] Fix mock émis à 1 Hz (vitesse 0) — le Pacer se cale sans attendre le GPS.');
  } else if (!shouldRun && idleInterval) {
    clearInterval(idleInterval);
    idleInterval = null;
  }
}

function broadcastCurrentPosition() {
  const hasTrack = rawTrack.length > 0 && trackCum.length > 0;
  let pos = null, heading = 0, alt = null;

  if (hasTrack) {
    const cur = getExactPositionAtDistance(rawTrack, trackCum, currentProgressMeters);
    if (!cur) return;
    pos = cur.pos;
    const ahead = getExactPositionAtDistance(rawTrack, trackCum, Math.min(totalTrackLengthMeters, currentProgressMeters + 8));
    heading = ahead ? bearingBetween(pos, ahead.pos) : 0;
    alt = eleAtDistance(currentProgressMeters);
  } else if (anchorPoint) {
    pos = anchorPoint;
    alt = anchorAlt;
  } else {
    return;
  }

  // Anti-téléport : glissement progressif au lieu d'un saut sec
  let outLat = pos[0], outLon = pos[1];
  if (warpFrom && warpMs > 0) {
    const t = (Date.now() - warpStart) / warpMs;
    if (t >= 1) warpFrom = null;
    else {
      const k = t < 0 ? 0 : t;
      outLat = warpFrom[0] + (pos[0] - warpFrom[0]) * k;
      outLon = warpFrom[1] + (pos[1] - warpFrom[1]) * k;
    }
  }

  const moving = isRunning && !isPaused;
  const wk = wkActive ? workoutState() : null;

  broadcast({
    type: 'position',
    lat: outLat, lon: outLon, lng: outLon,
    speed: moving ? (speedKmh * 1000) / 3600 : 0,
    speedKmh: moving ? speedKmh : 0,
    heading: heading,
    altitude: alt != null ? alt : baseAlt,
    altitudeSource: alt != null ? 'srtm' : 'fallback',
    accuracy: 3.0,
    // trame GPS complète : certaines apps refusent un mock incomplet
    provider: 'gps',
    satellites: 12,
    bearingAccuracy: 5.0,
    verticalAccuracy: 3.0,
    mock: true,
    fix: true,
    armed: armed,
    idle: !moving,
    activity: activity,
    distanceMeters: currentProgressMeters,
    totalDistanceMeters: totalTrackLengthMeters,
    sessionDistance: sessionDistance,
    elevGain: elevGain, elevLoss: elevLoss, laps: laps,
    elapsedS: Math.round(elapsedS),
    // ---- piste ----
    mode: trackMode ? 'track' : 'free',
    trackMode: trackMode,
    lane: trackMode ? trackLane : null,
    laneLength: trackMode ? Math.round(trackLaneLength * 100) / 100 : null,
    lapNumber: trackMode ? laps + 1 : null,
    lapDistance: trackMode ? Math.round(currentProgressMeters * 10) / 10 : null,
    lapPercent: trackMode && trackLaneLength > 0
      ? Math.round((currentProgressMeters / trackLaneLength) * 1000) / 10 : null,
    // ---- séance / physiologie ----
    workoutActive: wkActive,
    workoutName: wk ? wk.sessionName : null,
    phaseKind: wk ? wk.kind : null,
    phaseLabel: wk ? wk.label : null,
    phaseRemainS: wk ? wk.phaseRemainS : null,
    pctVma: wk ? wk.pctVma : null,
    targetHr: wk ? wk.targetHr : null,
    zone: wk ? wk.zone : null,
    hr: Math.round(currentHr),
    vma: athlete.vma,
    timestamp: Date.now()
  });
}

function setAnchor(lat, lon, smoothMs2) {
  const prev = currentFixPoint();
  anchorPoint = [lat, lon];
  if (prev && smoothMs2 > 0) {
    warpFrom = prev;
    warpStart = Date.now();
    warpMs = smoothMs2;
  } else {
    warpFrom = null;
    warpMs = 0;
  }
  fetchElevBatch([[lat, lon]], [0])
    .then(r => { if (r && r.length && isFinite(r[0])) anchorAlt = Math.round(r[0] * 10) / 10; })
    .catch(() => {});
  broadcastCurrentPosition();
  updateIdleHeartbeat();
}

function tick() {
  if (!isRunning || isPaused || rawTrack.length < 2 || totalTrackLengthMeters === 0) return;

  const dt = 0.25;
  const metersPerSecond = (speedKmh * 1000) / 3600;
  const advanced = metersPerSecond * dt;

  let next = currentProgressMeters + advanced;
  if (next >= totalTrackLengthMeters) {
    laps += Math.floor(next / totalTrackLengthMeters);
    next = next % totalTrackLengthMeters;
  }
  currentProgressMeters = next;
  sessionDistance += advanced;
  elapsedS += dt;

  // moteur de séance : récupération automatique + pilotage de la vitesse
  tickWorkout(dt, advanced);

  // FC hors séance : tend vers l'intensité correspondant à la vitesse
  if (!wkActive) {
    const pct = athlete.vma > 0 ? speedKmh / athlete.vma : 0.6;
    const target = hrForIntensity(pct);
    currentHr += (target - currentHr) * (1 - Math.exp(-dt / 25));
  }

  const alt = eleAtDistance(currentProgressMeters);
  if (alt != null) {
    if (prevAlt != null) {
      const d = alt - prevAlt;
      if (d > 0.05) elevGain += d;
      else if (d < -0.05) elevLoss -= d;
    }
    prevAlt = alt;
  }
  broadcastCurrentPosition();
}

// ===========================================================================
// §11  INTERFACE WEB — dashboard réorganisé en onglets
// ===========================================================================
const htmlContent = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>RunCrew Studio v3 — Banc d'essai GPS</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  *{box-sizing:border-box;margin:0;padding:0;font-family:'Segoe UI',system-ui,sans-serif}
  :root{
    --volt:#00e676; --amber:#ffab00; --sky:#38bdf8; --fuchsia:#e879f9; --rose:#fb7185;
    --ink:#05070b; --panel:#0b0e15; --panel2:#11151f; --line:#1c2230; --muted:#64748b;
  }
  body{background:var(--ink);color:#e8edf5;display:flex;height:100vh;overflow:hidden}
  ::-webkit-scrollbar{width:8px;height:8px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:#232a3a;border-radius:8px}
  ::-webkit-scrollbar-thumb:hover{background:#2e3850}
  .mono{font-family:'Consolas','JetBrains Mono',monospace;font-variant-numeric:tabular-nums}

  /* ---------- SIDEBAR ---------- */
  #sidebar{width:400px;min-width:400px;background:var(--panel);display:flex;flex-direction:column;border-right:1px solid var(--line)}
  .brand{display:flex;align-items:center;gap:11px;padding:15px 16px;border-bottom:1px solid var(--line)}
  .brand-logo{width:34px;height:34px;border-radius:9px;background:var(--volt);display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 0 22px #00e67666}
  .brand-t1{font-size:13px;font-weight:900;letter-spacing:2px}
  .brand-t2{font-size:9px;font-weight:700;letter-spacing:1.4px;color:var(--muted);margin-top:1px}
  .brand-badge{margin-left:auto;font-size:9px;font-weight:800;color:var(--volt);background:#00e67615;border:1px solid #00e67640;padding:4px 8px;border-radius:20px}

  .statusbar{display:flex;gap:6px;padding:9px 12px;border-bottom:1px solid var(--line);background:var(--panel2)}
  .chip{flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;padding:6px 3px;border-radius:8px;background:#0b0e15;border:1px solid var(--line)}
  .chip b{font-size:12px;font-weight:900}
  .chip span{font-size:8px;font-weight:700;color:var(--muted);letter-spacing:.6px}

  .tabs{display:flex;border-bottom:1px solid var(--line);background:var(--panel2)}
  .tab{flex:1;padding:11px 3px;border:none;background:transparent;color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.5px;cursor:pointer;border-bottom:2px solid transparent;transition:.18s}
  .tab:hover{color:#cbd5e1}
  .tab.active{color:var(--volt);border-bottom-color:var(--volt);background:#00e6760a}
  .tabpane{display:none;flex:1;overflow-y:auto;padding:14px;flex-direction:column;gap:12px}
  .tabpane.active{display:flex}

  .card{background:var(--panel2);border:1px solid var(--line);border-radius:13px;padding:13px}
  .card h3{font-size:10px;color:var(--muted);margin-bottom:9px;text-transform:uppercase;letter-spacing:1.2px;font-weight:800;display:flex;align-items:center;gap:6px}
  .hint{font-size:10px;color:#5b6678;line-height:1.55;margin-top:7px}

  input[type=text],input[type=number],select{width:100%;padding:8px 10px;background:var(--ink);border:1px solid var(--line);color:#fff;border-radius:8px;font-size:12px;outline:none;transition:.18s}
  input[type=text]:focus,input[type=number]:focus,select:focus{border-color:#00e67699}
  input[type=range]{width:100%;accent-color:var(--volt);margin:9px 0}
  label.fl{display:block;font-size:9px;font-weight:800;color:var(--muted);letter-spacing:.7px;margin-bottom:3px}

  .btn{padding:9px 12px;border-radius:9px;border:1px solid var(--line);background:#1a2030;color:#e2e8f0;font-size:11px;font-weight:800;cursor:pointer;transition:.18s}
  .btn:hover{background:#232b3d;border-color:#2d374d}
  .btn-volt{background:var(--volt);color:#04150b;border-color:transparent}
  .btn-volt:hover{background:#22ef8d;box-shadow:0 0 20px #00e67666}
  .btn-ghost{background:transparent}
  .row{display:flex;gap:6px}
  .row>*{flex:1}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:7px}
  .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
  .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}

  .act-btn{padding:9px 3px;border:2px solid var(--line);border-radius:10px;background:transparent;color:var(--muted);font-size:11px;font-weight:800;cursor:pointer;transition:.18s}
  .act-btn.active{border-color:var(--volt);color:var(--volt);background:#00e67612}
  .act-btn:hover{border-color:#00e67688}

  .lane-btn{display:flex;flex-direction:column;align-items:center;gap:1px;padding:7px 2px;border:2px solid var(--line);border-radius:9px;background:transparent;color:var(--muted);font-size:14px;font-weight:900;cursor:pointer;transition:.18s}
  .lane-btn small{font-size:7.5px;font-weight:700;color:#4b5568;font-family:monospace}
  .lane-btn.active{border-color:var(--volt);color:var(--volt);background:#00e67612}
  .lane-btn.active small{color:var(--volt)}
  .lane-btn:hover{border-color:#00e67688}

  .tel{background:#0b0e15;border:1px solid var(--line);padding:9px;border-radius:9px;text-align:center}
  .tel-t{font-size:8.5px;color:var(--muted);font-weight:800;letter-spacing:.6px}
  .tel-v{font-size:16px;font-weight:900;margin-top:2px;font-family:'Consolas',monospace}

  .preset{padding:5px 8px;background:#1a2030;border:none;border-radius:6px;color:#94a3b8;font-size:9.5px;font-weight:700;cursor:pointer}
  .preset:hover{background:var(--volt);color:#04150b}

  .mainbtn{width:100%;padding:15px;border:none;border-radius:13px;font-size:14px;font-weight:900;letter-spacing:1px;cursor:pointer;transition:.18s}
  .btn-start{background:var(--volt);color:#04150b;box-shadow:0 0 28px #00e6764d}
  .btn-stop{background:var(--rose);color:#fff}
  .btn-pause{background:var(--amber);color:#2a1a00}
  .footer{padding:12px 14px;border-top:1px solid var(--line);background:var(--panel)}

  /* ---------- SÉANCES ---------- */
  .fam-row{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:9px}
  .fam{padding:5px 9px;border-radius:20px;border:1px solid var(--line);background:transparent;color:var(--muted);font-size:9.5px;font-weight:800;cursor:pointer;transition:.18s}
  .fam.active{border-color:var(--fuchsia);color:var(--fuchsia);background:#e879f915}
  .sess{width:100%;text-align:left;padding:10px;border-radius:10px;border:1px solid var(--line);background:#0b0e15;cursor:pointer;margin-bottom:6px;transition:.18s}
  .sess:hover{border-color:#e879f966;transform:translateX(2px)}
  .sess.active{border-color:var(--fuchsia);background:#e879f90f}
  .sess-h{display:flex;align-items:center;gap:7px}
  .sess-n{font-size:12px;font-weight:800;color:#fff}
  .sess-d{font-size:9.5px;color:#5b6678;margin-top:3px;line-height:1.45}
  .sess-m{display:flex;gap:7px;margin-top:6px;font-size:9px;font-weight:800;font-family:monospace}
  .sess-m span{color:var(--muted)}

  /* ---------- PHASE LIVE (overlay carte) ---------- */
  #phaseHud{position:absolute;left:16px;top:16px;z-index:1000;width:280px;background:#0b0e15f2;border:1px solid var(--line);border-radius:15px;padding:14px;backdrop-filter:blur(14px);box-shadow:0 14px 44px #000a;display:none}
  #phaseHud.on{display:block}
  .ph-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
  .ph-kind{font-size:9.5px;font-weight:900;letter-spacing:1.3px;padding:4px 9px;border-radius:20px}
  .ph-sess{font-size:9px;color:var(--muted);font-weight:700}
  .ph-label{font-size:19px;font-weight:900;color:#fff;line-height:1.15}
  .ph-timer{font-size:42px;font-weight:900;font-family:'Consolas',monospace;line-height:1;margin:7px 0;letter-spacing:-2px}
  .ph-bar{height:6px;border-radius:20px;background:var(--line);overflow:hidden;margin:9px 0}
  .ph-bar i{display:block;height:100%;border-radius:20px;transition:width .25s linear}
  .ph-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:9px}
  .ph-c{background:#0f1420;border:1px solid var(--line);border-radius:8px;padding:6px;text-align:center}
  .ph-c b{display:block;font-size:14px;font-weight:900;font-family:'Consolas',monospace}
  .ph-c span{font-size:7.5px;color:var(--muted);font-weight:800;letter-spacing:.5px}
  .ph-next{margin-top:9px;padding-top:9px;border-top:1px solid var(--line);font-size:9.5px;color:var(--muted);font-weight:700}
  .ph-next b{color:#cbd5e1}

  /* ---------- CARTE ---------- */
  #map-container{flex:1;position:relative}
  #map{width:100%;height:100%;background:#070a10}
  .leaflet-control-attribution{background:#05070bcc!important;color:#4b5568!important;font-size:9px!important}
  .leaflet-control-attribution a{color:#64748b!important}
  .leaflet-control-layers{background:#0b0e15f0;border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px #0009}
  .leaflet-control-layers-toggle{background-color:#0b0e15;filter:invert(1) brightness(.9)}
  .leaflet-control-layers-expanded{padding:8px 10px}
  .leaflet-control-layers-list label{color:#cbd5e1;font-size:11px;font-weight:700;line-height:1.9;cursor:pointer}
  .leaflet-control-layers-selector{accent-color:#00e676;margin-right:5px}
  .follow-pill{position:absolute;top:16px;right:16px;z-index:1000;background:#0b0e15ee;border:1.5px solid var(--volt);color:var(--volt);padding:8px 14px;border-radius:20px;font-size:11px;font-weight:800;cursor:pointer;box-shadow:0 4px 15px #0008;display:flex;align-items:center;gap:6px}
  .follow-pill.off{border-color:#3a4356;color:var(--muted)}
  .hr-pill{position:absolute;right:16px;top:60px;z-index:1000;background:#0b0e15ee;border:1px solid var(--line);border-radius:14px;padding:10px 14px;text-align:center;display:none}
  .hr-pill.on{display:block}
  .hr-v{font-size:26px;font-weight:900;font-family:'Consolas',monospace;line-height:1}
  .hr-l{font-size:8px;color:var(--muted);font-weight:800;letter-spacing:1px;margin-top:2px}

  table.vma{width:100%;border-collapse:collapse;font-family:'Consolas',monospace;font-size:10.5px}
  table.vma th{color:var(--muted);font-size:8.5px;text-align:left;padding:5px 4px;border-bottom:1px solid var(--line);letter-spacing:.5px}
  table.vma td{padding:5px 4px;border-bottom:1px solid #141a26}
  table.vma tr:hover td{background:#0f1420}
  .zdot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px}
</style>
</head>
<body>
<div id="sidebar">
  <div class="brand">
    <div class="brand-logo">🏃</div>
    <div>
      <div class="brand-t1">RUNCREW <span style="color:var(--volt)">STUDIO</span></div>
      <div class="brand-t2">BANC D'ESSAI GPS · v3.0</div>
    </div>
    <div class="brand-badge" id="phoneChip">0 📱</div>
  </div>

  <div class="statusbar">
    <div class="chip"><b style="color:var(--volt)" id="stDist">0.00</b><span>KM</span></div>
    <div class="chip"><b style="color:var(--amber)" id="stAlt">—</b><span>ALT m</span></div>
    <div class="chip"><b style="color:var(--rose)" id="stHr">—</b><span>FC bpm</span></div>
    <div class="chip"><b style="color:var(--sky)" id="stSpeed">11.0</b><span>KM/H</span></div>
  </div>

  <div class="tabs">
    <button class="tab active" data-tab="train" onclick="showTab('train',this)">🏋️ SÉANCE</button>
    <button class="tab" data-tab="athlete" onclick="showTab('athlete',this)">❤️ ATHLÈTE</button>
    <button class="tab" data-tab="route" onclick="showTab('route',this)">🗺️ PARCOURS</button>
    <button class="tab" data-tab="bridge" onclick="showTab('bridge',this)">🎯 PONT</button>
  </div>

  <!-- ================= ONGLET SÉANCE ================= -->
  <div class="tabpane active" id="pane-train">
    <div class="card">
      <h3>🏋️ Programme d'entraînement</h3>
      <div class="fam-row" id="famRow"></div>
      <div id="sessList" style="max-height:320px;overflow-y:auto"></div>
    </div>
    <div class="card" id="sessDetail" style="display:none">
      <h3>📋 Détail de la séance</h3>
      <div id="sessInfo"></div>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-volt" onclick="launchWorkout()">▶ LANCER LA SÉANCE</button>
        <button class="btn" style="flex:0 0 90px" onclick="stopWorkoutUI()">⏹ Arrêter</button>
      </div>
      <div class="hint">La <b style="color:var(--volt)">récupération est automatique</b> : le moteur enchaîne effort → récup → effort et pilote la vitesse envoyée au téléphone.</div>
    </div>
  </div>

  <!-- ================= ONGLET ATHLÈTE ================= -->
  <div class="tabpane" id="pane-athlete">
    <div class="card">
      <h3>❤️ Profil athlète</h3>
      <div class="grid2">
        <div><label class="fl">ÂGE</label><input type="number" id="inAge" value="35" min="10" max="99" oninput="onAthleteInput()"></div>
        <div><label class="fl">POIDS (kg)</label><input type="number" id="inPoids" value="70" min="30" max="150" oninput="onAthleteInput()"></div>
        <div><label class="fl">FC REPOS (bpm)</label><input type="number" id="inFcRepos" value="55" min="30" max="100" oninput="onAthleteInput()"></div>
        <div><label class="fl">FC MAX (bpm)</label><input type="number" id="inFcMax" value="185" min="120" max="230" oninput="onAthleteInput()"></div>
      </div>
      <div style="margin-top:9px"><label class="fl">VMA (km/h)</label>
        <input type="number" id="inVma" value="16" min="8" max="26" step="0.1" oninput="onAthleteInput()">
      </div>
      <div class="row" style="margin-top:8px">
        <button class="preset" onclick="useTanaka()">FCmax Tanaka</button>
        <button class="preset" onclick="useAstrand()">FCmax Astrand</button>
        <button class="btn btn-volt" style="flex:0 0 100px;padding:6px" onclick="saveAthlete()">💾 Appliquer</button>
      </div>
      <div class="hint" id="athleteHint"></div>
    </div>

    <div class="card">
      <h3>📊 Tableau VMA — allures & FC cibles</h3>
      <table class="vma"><thead><tr>
        <th>%VMA</th><th>KM/H</th><th>ALLURE</th><th>FC</th><th>30s</th><th>ZONE</th>
      </tr></thead><tbody id="vmaBody"></tbody></table>
      <div class="hint">FC calculée par <b>Karvonen</b> : FCrepos + %FCR × (FCmax − FCrepos). Colonne <b>30s</b> = distance couverte en 30 secondes (calibrage du fractionné court).</div>
    </div>

    <div class="card">
      <h3>🎯 Temps de passage prédits</h3>
      <table class="vma"><thead><tr>
        <th>DISTANCE</th><th>TEMPS</th><th>ALLURE</th><th>%VMA</th>
      </tr></thead><tbody id="predBody"></tbody></table>
    </div>
  </div>

  <!-- ================= ONGLET PARCOURS ================= -->
  <div class="tabpane" id="pane-route">
    <div class="card">
      <h3>🔍 Recherche coordonnées</h3>
      <div class="row">
        <input type="text" id="gpsInput" placeholder="43.421700, 6.675192">
        <button class="btn btn-volt" style="flex:0 0 66px" onclick="goToCoords()">Aller</button>
      </div>
    </div>

    <div class="card">
      <h3>🎯 Activité</h3>
      <div class="grid4">
        <button class="act-btn active" onclick="setActivity('running',this)">🏃</button>
        <button class="act-btn" onclick="setActivity('cycling',this)">🚴</button>
        <button class="act-btn" onclick="setActivity('hiking',this)">🥾</button>
        <button class="act-btn" onclick="setActivity('pacer',this)">🎯</button>
      </div>
    </div>

    <div class="card">
      <h3>🏟️ Piste d'athlétisme — 8 couloirs</h3>
      <div id="trackState" style="font-size:10.5px;color:var(--muted);margin-bottom:8px">Mode piste inactif</div>
      <div class="grid4">
        <button class="lane-btn active" data-lane="1" onclick="setLane(1)">1<small>400.00</small></button>
        <button class="lane-btn" data-lane="2" onclick="setLane(2)">2<small>407.04</small></button>
        <button class="lane-btn" data-lane="3" onclick="setLane(3)">3<small>414.70</small></button>
        <button class="lane-btn" data-lane="4" onclick="setLane(4)">4<small>422.37</small></button>
        <button class="lane-btn" data-lane="5" onclick="setLane(5)">5<small>430.03</small></button>
        <button class="lane-btn" data-lane="6" onclick="setLane(6)">6<small>437.70</small></button>
        <button class="lane-btn" data-lane="7" onclick="setLane(7)">7<small>445.36</small></button>
        <button class="lane-btn" data-lane="8" onclick="setLane(8)">8<small>453.03</small></button>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--muted);font-weight:800;margin-top:9px">
        <span>ORIENTATION LIGNE DROITE</span><span id="brgVal" style="color:var(--sky)">90°</span>
      </div>
      <input type="range" id="brgSlider" min="0" max="359" value="90" oninput="setBearing(this.value)">
      <div class="row">
        <button class="btn btn-volt" onclick="placeTrack()">🏟️ Poser la piste ici</button>
        <button class="btn" style="flex:0 0 78px" onclick="exitTrack()">✖ Quitter</button>
      </div>
      <div class="hint">Point A = centre de la carte. Départ et arrivée au <b>même point A</b> (norme World Athletics).</div>
    </div>

    <div class="card">
      <h3>🗺️ Parcours libre (routage OSRM)</h3>
      <div id="trackInfo" style="font-size:11px;color:var(--muted)">Clique sur la carte pour tracer ta boucle</div>
      <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px;font-size:10.5px;color:#94a3b8;font-weight:700">
        <span>Boucle fermée (retour par la route)</span>
        <input type="checkbox" id="loopToggle" checked onchange="toggleLoop(this.checked)" style="accent-color:var(--volt);width:15px;height:15px">
      </label>
      <div class="row" style="margin-top:8px">
        <button class="btn" onclick="undoWaypoint()">↩️ Annuler</button>
        <button class="btn" onclick="clearTrack()">🗑️ Effacer</button>
      </div>
    </div>

    <div class="card">
      <h3>💾 Sauvegarde parcours</h3>
      <div class="row">
        <input type="text" id="trackNameInput" placeholder="Nom du parcours">
        <button class="btn btn-volt" style="flex:0 0 70px" onclick="saveTrack()">Sauver</button>
      </div>
      <select id="trackSelect" onchange="loadTrack(this.value)" style="margin-top:8px">
        <option value="">— Charger un parcours —</option>
      </select>
    </div>
  </div>

  <!-- ================= ONGLET PONT ================= -->
  <div class="tabpane" id="pane-bridge">
    <div class="card" style="border-color:#e879f955">
      <h3 style="color:var(--fuchsia)">🎯 Pont direct — Pacer sans attente GPS</h3>
      <div id="armState" style="font-size:10.5px;color:var(--fuchsia);font-weight:700;margin-bottom:8px">🎯 Pont ARMÉ — fix mock émis à 1 Hz</div>
      <div class="row">
        <button class="btn" onclick="toggleArm()">⚡ Armer / Désarmer</button>
        <button class="btn" onclick="anchorHere()">📍 Ancrer ici</button>
      </div>
      <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px;font-size:10.5px;color:#94a3b8;font-weight:700">
        <span>Anti-téléport : glissement doux (3 s)</span>
        <input type="checkbox" id="smoothToggle" checked style="accent-color:var(--fuchsia);width:15px;height:15px">
      </label>
      <div class="hint">Le pont armé envoie une position <b>même à l'arrêt</b> (vitesse 0) : le Pacer reçoit son fix immédiatement.</div>
    </div>

    <div class="card">
      <h3>⚡ Vitesse manuelle</h3>
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div><span class="mono" style="font-size:30px;font-weight:900" id="speedVal">11.0</span>
          <span style="color:var(--muted);font-size:11px">km/h</span></div>
        <div class="mono" style="color:var(--volt);font-weight:800;font-size:13px" id="paceVal">5:27 /km</div>
      </div>
      <input type="range" id="speedSlider" min="3" max="50" step="0.5" value="11" oninput="updateSpeed(this.value)">
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="preset" onclick="setSpeed(5)">Marche 5</button>
        <button class="preset" onclick="setSpeed(10.9)">Endu 10.9</button>
        <button class="preset" onclick="setSpeed(15)">Semi 15</button>
        <button class="preset" onclick="setSpeed(25)">Vélo 25</button>
        <button class="preset" onclick="setSpeed(45)">Sprint 45</button>
      </div>
      <div class="hint">Pendant une séance, la vitesse est pilotée automatiquement par le moteur d'entraînement.</div>
    </div>

    <div class="card">
      <h3>📊 Télémétrie détaillée</h3>
      <div class="grid2">
        <div class="tel"><div class="tel-t">DISTANCE</div><div class="tel-v" style="color:var(--volt)" id="distVal">0.00 km</div></div>
        <div class="tel"><div class="tel-t">ALTITUDE</div><div class="tel-v" style="color:var(--amber)" id="altVal">— m</div></div>
        <div class="tel"><div class="tel-t">DÉNIVELÉ +</div><div class="tel-v" style="color:var(--volt)" id="gainVal">0 m</div></div>
        <div class="tel"><div class="tel-t">DÉNIVELÉ −</div><div class="tel-v" style="color:var(--rose)" id="lossVal">0 m</div></div>
      </div>
    </div>
  </div>

  <div class="footer">
    <button id="btnMain" class="mainbtn btn-start" onclick="toggleRun()">▶ LANCER LA SIMULATION</button>
    <button id="btnPause" class="mainbtn btn-pause" style="display:none;margin-top:7px" onclick="togglePause()">⏸ PAUSE</button>
  </div>
</div>

<div id="map-container">
  <div id="map"></div>
  <button id="btnFollow" class="follow-pill" onclick="toggleAutoFollow()"><span>🎯</span> Auto-suivi : ON</button>
  <div class="hr-pill" id="hrPill">
    <div class="hr-v" id="hrBig">—</div><div class="hr-l">BPM</div>
  </div>
  <div id="phaseHud">
    <div class="ph-top">
      <span class="ph-kind" id="phKind">EFFORT</span>
      <span class="ph-sess" id="phSess"></span>
    </div>
    <div class="ph-label" id="phLabel">—</div>
    <div class="ph-timer" id="phTimer">0:00</div>
    <div class="ph-bar"><i id="phBar" style="width:0%"></i></div>
    <div class="ph-grid">
      <div class="ph-c"><b id="phSpeed" style="color:var(--volt)">—</b><span>KM/H</span></div>
      <div class="ph-c"><b id="phPace" style="color:var(--sky)">—</b><span>ALLURE</span></div>
      <div class="ph-c"><b id="phHr" style="color:var(--rose)">—</b><span>FC CIBLE</span></div>
    </div>
    <div class="ph-next">SUIVANT → <b id="phNext">—</b></div>
  </div>
</div>

<script>
  // ============ CARTE ============
  var map = L.map('map', {zoomControl:true}).setView([43.421700, 6.675192], 17);
  map.zoomControl.setPosition('bottomright');

  // ⚠️ TUILES (fix v3.1) : CARTO exige désormais une clé API ("API KEY REQUIRED"
  // imprimé sur les tuiles). Retour à OpenStreetMap — sans clé, identique à la
  // version d'origine — avec un FILTRE SOMBRE CSS sur un pane dédié pour garder
  // le rendu night-ops. Secours automatique vers Esri Dark (sans clé non plus).
  map.createPane('paneDark');
  var darkPane = map.getPane('paneDark');
  darkPane.style.zIndex = 200;
  darkPane.style.filter = 'invert(1) hue-rotate(180deg) brightness(.92) contrast(.9) saturate(.22)';

  var OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  var osmDark = L.tileLayer(OSM_URL, {pane:'paneDark', maxZoom:19,
    attribution:'© OpenStreetMap · Élévation Open-Meteo SRTM'});
  var esriDark = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    {maxZoom:19, attribution:'© Esri · © OpenStreetMap'});
  var osmStd = L.tileLayer(OSM_URL, {maxZoom:19, attribution:'© OpenStreetMap'});
  osmDark.addTo(map);

  // 🛟 Secours auto : si OSM échoue → bascule Esri natif sombre (sans filtre)
  var tileBroken = false;
  osmDark.on('tileerror', function(){
    if (tileBroken) return;
    tileBroken = true;
    console.log('⚠️ Tuiles OSM en erreur → bascule sur Esri Dark');
    map.removeLayer(osmDark);
    esriDark.addTo(map);
  });

  // 🎛️ Sélecteur de fond de carte (3 options, aucune clé requise)
  L.control.layers({
    'Sombre · OpenStreetMap': osmDark,
    'Sombre natif · Esri': esriDark,
    'Standard · OpenStreetMap': osmStd
  }, null, {position:'topleft'}).addTo(map);

  var waypoints = [], trackPoints = [], routeDistanceM = null, routeRequestSeq = 0, loopClosed = true;
  var trackGlow = L.polyline([], {color:'#00e676',weight:9,opacity:0.22}).addTo(map);
  var trackLine = L.polyline([], {color:'#00e676',weight:5}).addTo(map);
  var markers = [], isRunning = false, currentActivity = 'running', currentSpeed = 11.0;
  var runnerMarker = null, autoFollow = true;

  function showTab(id, btn) {
    var panes = document.querySelectorAll('.tabpane');
    for (var i=0;i<panes.length;i++) panes[i].classList.remove('active');
    document.getElementById('pane-'+id).classList.add('active');
    var tabs = document.querySelectorAll('.tab');
    for (var j=0;j<tabs.length;j++) tabs[j].classList.remove('active');
    btn.classList.add('active');
  }

  function getRunnerColor(act) {
    var c = {running:'#00e676', cycling:'#38bdf8', hiking:'#ffab00', pacer:'#e879f9'};
    return c[act] || '#00e676';
  }
  function profileForActivity(act) { return act === 'cycling' ? 'routed-bike' : 'routed-foot'; }
  function createRunnerIcon(act) {
    var color = getRunnerColor(act);
    return L.divIcon({className:'', iconSize:[28,28], iconAnchor:[14,14],
      html:'<div style="width:28px;height:28px;border-radius:50%;background:'+color+';border:3px solid #05070b;box-shadow:0 0 20px '+color+';display:flex;align-items:center;justify-content:center;font-size:13px">🏃</div>'});
  }
  function toggleAutoFollow(){ autoFollow=!autoFollow; updateFollowButton(); }
  function updateFollowButton(){
    var b=document.getElementById('btnFollow');
    b.className = autoFollow ? 'follow-pill' : 'follow-pill off';
    b.innerHTML = autoFollow ? '<span>🎯</span> Auto-suivi : ON' : '<span>🖐️</span> Auto-suivi : OFF';
  }
  map.on('dragstart', function(){ if(autoFollow){autoFollow=false;updateFollowButton();} });

  // ============ WEBSOCKET ============
  var ws = new WebSocket('ws://localhost:9876/?src=dashboard');
  ws.onmessage = function(event) {
    try {
      var d = JSON.parse(event.data);
      if (d.type === 'position') {
        var ll = [d.lat, d.lon];
        if (!runnerMarker) runnerMarker = L.marker(ll, {icon:createRunnerIcon(currentActivity)}).addTo(map);
        else { runnerMarker.setLatLng(ll); runnerMarker.setIcon(createRunnerIcon(currentActivity)); }
        if (autoFollow) map.panTo(ll, {animate:true, duration:0.45});

        if (d.trackMode) {
          document.getElementById('distVal').textContent = 'T'+d.lapNumber+' · '+Math.round(d.lapDistance)+'/'+Math.round(d.laneLength)+' m';
        } else {
          document.getElementById('distVal').textContent =
            (d.distanceMeters/1000).toFixed(2)+' / '+(d.totalDistanceMeters/1000).toFixed(2)+' km';
        }
        document.getElementById('stDist').textContent = (d.sessionDistance/1000).toFixed(2);
        document.getElementById('altVal').textContent = Math.round(d.altitude)+' m';
        document.getElementById('stAlt').textContent = Math.round(d.altitude);
        document.getElementById('stSpeed').textContent = d.speedKmh.toFixed(1);
        if (typeof d.elevGain === 'number') document.getElementById('gainVal').textContent = Math.round(d.elevGain)+' m';
        if (typeof d.elevLoss === 'number') document.getElementById('lossVal').textContent = Math.round(d.elevLoss)+' m';
        if (typeof d.hr === 'number') {
          document.getElementById('stHr').textContent = d.hr;
          document.getElementById('hrBig').textContent = d.hr;
          document.getElementById('hrPill').classList.add('on');
        }
      } else if (d.type === 'workout') {
        renderPhaseHud(d);
      } else if (d.type === 'clients') {
        var el = document.getElementById('phoneChip');
        el.textContent = d.phones + ' 📱';
        el.style.color = d.phones > 0 ? 'var(--volt)' : 'var(--rose)';
      } else if (d.type === 'profile') {
        if (typeof d.startAltitude === 'number')
          document.getElementById('altVal').textContent = Math.round(d.startAltitude)+' m';
      } else if (d.type === 'trackmode') {
        // état piste géré côté UI
      } else if (d.type === 'stop') {
        if (runnerMarker) { map.removeLayer(runnerMarker); runnerMarker = null; }
      }
    } catch(e) {}
  };

  // ============ HUD DE PHASE ============
  var KIND_STYLE = {
    work:      {bg:'#fb718522', fg:'#fb7185', t:'EFFORT'},
    recovery:  {bg:'#00e67622', fg:'#00e676', t:'RÉCUPÉRATION'},
    rest:      {bg:'#38bdf822', fg:'#38bdf8', t:'REPOS'},
    warmup:    {bg:'#ffab0022', fg:'#ffab00', t:'ÉCHAUFFEMENT'},
    cooldown:  {bg:'#94a3b822', fg:'#94a3b8', t:'RETOUR AU CALME'}
  };
  function fmtT(s) {
    s = Math.max(0, Math.round(s));
    var m = Math.floor(s/60), r = s%60;
    return m + ':' + (r<10?'0':'') + r;
  }
  function renderPhaseHud(d) {
    var hud = document.getElementById('phaseHud');
    if (!d.active) {
      hud.classList.remove('on');
      if (d.finished) alert('🏁 Séance « ' + d.name + ' » terminée en ' + Math.round(d.elapsedS/60) + ' min !');
      return;
    }
    hud.classList.add('on');
    var st = KIND_STYLE[d.kind] || KIND_STYLE.work;
    var k = document.getElementById('phKind');
    k.textContent = st.t + (d.rep ? '  ' + d.rep + '/' + d.repTotal : '');
    k.style.background = st.bg; k.style.color = st.fg;
    document.getElementById('phSess').textContent = d.sessionName + ' · ' + (d.phaseIndex+1) + '/' + d.phaseCount;
    document.getElementById('phLabel').textContent = d.label;
    var timer = document.getElementById('phTimer');
    timer.textContent = fmtT(d.phaseRemainS);
    timer.style.color = st.fg;
    var bar = document.getElementById('phBar');
    bar.style.width = d.phaseProgress + '%';
    bar.style.background = st.fg;
    document.getElementById('phSpeed').textContent = d.targetKmh.toFixed(1);
    document.getElementById('phPace').textContent = d.targetPace;
    document.getElementById('phHr').textContent = d.targetHr;
    document.getElementById('phNext').textContent = d.nextLabel;
  }

  // ============ SÉANCES ============
  var SESS = [], curFamily = 'Tous', selectedSession = null;

  function loadSessions() {
    fetch('http://localhost:9877/api/sessions').then(function(r){return r.json();}).then(function(d){
      SESS = d.sessions;
      var fams = ['Tous'];
      for (var i=0;i<SESS.length;i++) if (fams.indexOf(SESS[i].family) === -1) fams.push(SESS[i].family);
      var fr = document.getElementById('famRow');
      fr.innerHTML = '';
      fams.forEach(function(f){
        var b = document.createElement('button');
        b.className = 'fam' + (f === curFamily ? ' active' : '');
        b.textContent = f;
        b.onclick = function(){ curFamily = f; loadSessions(); };
        fr.appendChild(b);
      });
      renderSessions();
    });
  }
  function renderSessions() {
    var box = document.getElementById('sessList');
    box.innerHTML = '';
    SESS.filter(function(s){ return curFamily === 'Tous' || s.family === curFamily; })
      .forEach(function(s){
        var b = document.createElement('button');
        b.className = 'sess' + (selectedSession === s.id ? ' active' : '');
        b.innerHTML =
          '<div class="sess-h"><span style="font-size:15px">' + s.icon + '</span>' +
          '<span class="sess-n">' + s.name + '</span></div>' +
          '<div class="sess-d">' + s.desc + '</div>' +
          '<div class="sess-m"><span>⏱ ' + Math.round(s.totalS/60) + ' min</span>' +
          '<span>📏 ' + s.totalKm.toFixed(2) + ' km</span>' +
          '<span>🔁 ' + s.reps + ' efforts</span></div>';
        b.onclick = function(){ selectSession(s); };
        box.appendChild(b);
      });
  }
  function selectSession(s) {
    selectedSession = s.id;
    renderSessions();
    document.getElementById('sessDetail').style.display = 'block';
    document.getElementById('sessInfo').innerHTML =
      '<div style="font-size:14px;font-weight:900;color:#fff">' + s.icon + ' ' + s.name + '</div>' +
      '<div style="font-size:10.5px;color:#5b6678;margin-top:5px;line-height:1.5">' + s.desc + '</div>' +
      '<div class="grid3" style="margin-top:9px">' +
      '<div class="tel"><div class="tel-t">DURÉE</div><div class="tel-v" style="color:var(--volt)">' + Math.round(s.totalS/60) + "'</div></div>" +
      '<div class="tel"><div class="tel-t">DISTANCE</div><div class="tel-v" style="color:var(--sky)">' + s.totalKm.toFixed(1) + '</div></div>' +
      '<div class="tel"><div class="tel-t">EFFORTS</div><div class="tel-v" style="color:var(--fuchsia)">' + s.reps + '</div></div></div>';
  }
  function launchWorkout() {
    if (!selectedSession) { alert('Choisis une séance !'); return; }
    fetch('http://localhost:9877/api/workout/start?id=' + selectedSession)
      .then(function(r){return r.json();}).then(function(d){
        if (d.error) { alert(d.error); return; }
        if (!isRunning) toggleRun();
      });
  }
  function stopWorkoutUI() {
    fetch('http://localhost:9877/api/workout/stop');
    document.getElementById('phaseHud').classList.remove('on');
  }

  // ============ ATHLÈTE / VMA ============
  function onAthleteInput(){ /* live preview au clic sur Appliquer */ }
  function useTanaka(){
    var age = parseInt(document.getElementById('inAge').value,10) || 35;
    document.getElementById('inFcMax').value = Math.round(208 - 0.7*age);
    saveAthlete();
  }
  function useAstrand(){
    var age = parseInt(document.getElementById('inAge').value,10) || 35;
    document.getElementById('inFcMax').value = 220 - age;
    saveAthlete();
  }
  function saveAthlete() {
    var q = '?age=' + document.getElementById('inAge').value +
            '&fcRepos=' + document.getElementById('inFcRepos').value +
            '&fcMax=' + document.getElementById('inFcMax').value +
            '&vma=' + document.getElementById('inVma').value +
            '&poids=' + document.getElementById('inPoids').value;
    fetch('http://localhost:9877/api/athlete' + q)
      .then(function(r){return r.json();}).then(function(d){ renderAthlete(d); loadSessions(); });
  }
  function loadAthlete() {
    fetch('http://localhost:9877/api/athlete').then(function(r){return r.json();}).then(function(d){
      document.getElementById('inAge').value = d.athlete.age;
      document.getElementById('inFcRepos').value = d.athlete.fcRepos;
      document.getElementById('inFcMax').value = d.athlete.fcMax;
      document.getElementById('inVma').value = d.athlete.vma;
      document.getElementById('inPoids').value = d.athlete.poids;
      renderAthlete(d);
    });
  }
  function renderAthlete(d) {
    var a = d.athlete;
    document.getElementById('athleteHint').innerHTML =
      'FC réserve : <b style="color:var(--volt)">' + (a.fcMax - a.fcRepos) + ' bpm</b> · ' +
      'Tanaka : <b>' + d.tanaka + '</b> · Astrand : <b>' + d.astrand + '</b> · ' +
      'Allure VMA : <b style="color:var(--sky)">' + d.vmaPace + ' /km</b>';
    var tb = document.getElementById('vmaBody');
    tb.innerHTML = '';
    d.table.forEach(function(r){
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td style="font-weight:800;color:#cbd5e1">' + r.pct + '%</td>' +
        '<td style="color:var(--volt);font-weight:800">' + r.kmh.toFixed(1) + '</td>' +
        '<td style="color:var(--sky)">' + r.pace + '</td>' +
        '<td style="color:var(--rose);font-weight:700">' + r.fc + '</td>' +
        '<td style="color:#7c8899">' + r.d30 + 'm</td>' +
        '<td style="font-size:9px"><span class="zdot" style="background:' + r.zoneColor + '"></span>Z' + r.zone + '</td>';
      tb.appendChild(tr);
    });
    var pb = document.getElementById('predBody');
    pb.innerHTML = '';
    d.predictions.forEach(function(p){
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td style="font-weight:800;color:#cbd5e1">' + p.dist + '</td>' +
        '<td style="color:var(--volt);font-weight:800">' + p.time + '</td>' +
        '<td style="color:var(--sky)">' + p.pace + '</td>' +
        '<td style="color:#7c8899">' + p.pct + '%</td>';
      pb.appendChild(tr);
    });
  }

  // ============ PISTE ============
  var LANE_COLORS = ['#00e676','#38bdf8','#e879f9','#ffab00','#fb7185','#a78bfa','#2dd4bf','#f97316'];
  var laneLayers = [], trackActive = false, curLane = 1, curBearing = 90, trackOriginLL = null;

  function clearLaneLayers(){ for(var i=0;i<laneLayers.length;i++) map.removeLayer(laneLayers[i]); laneLayers=[]; }
  function drawLanes(geometry) {
    clearLaneLayers();
    if (!geometry || !geometry.length) return;
    laneLayers.push(L.polygon(geometry[0], {color:'#14532d',weight:1,opacity:.5,fillColor:'#022c22',fillOpacity:.5,interactive:false}).addTo(map));
    for (var i=0;i<geometry.length;i++) {
      var active = (i+1) === curLane;
      laneLayers.push(L.polyline(geometry[i], {color:LANE_COLORS[i], weight:active?4:1.5, opacity:active?.95:.4, interactive:false}).addTo(map));
      laneLayers.push(L.marker(geometry[i][0], {interactive:false, icon:L.divIcon({className:'',iconSize:[18,18],iconAnchor:[9,9],
        html:'<div style="display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#0b0e15;border:1.5px solid '+LANE_COLORS[i]+';color:'+LANE_COLORS[i]+';font-size:9px;font-weight:800">'+(i+1)+'</div>'})}).addTo(map));
    }
  }
  function setLane(n) {
    curLane = n;
    var btns = document.querySelectorAll('.lane-btn');
    for (var i=0;i<btns.length;i++) btns[i].classList.toggle('active', parseInt(btns[i].getAttribute('data-lane'),10) === n);
    if (trackActive) placeTrack(true);
  }
  function setBearing(v) {
    curBearing = parseInt(v,10);
    document.getElementById('brgVal').textContent = curBearing + '°';
    if (trackActive) placeTrack(true);
  }
  function placeTrack(keepCenter) {
    var c = (trackActive && keepCenter && trackOriginLL) ? trackOriginLL : map.getCenter();
    trackOriginLL = c;
    fetch('http://localhost:9877/api/track-mode?lat='+c.lat+'&lon='+c.lng+'&bearing='+curBearing+'&lane='+curLane)
      .then(function(r){return r.json();}).then(function(d){
        if (d.error) { alert(d.error); return; }
        trackActive = true;
        drawLanes(d.geometry);
        trackGlow.setLatLngs([]); trackLine.setLatLngs([]);
        for (var i=0;i<markers.length;i++) map.removeLayer(markers[i]);
        markers=[]; waypoints=[]; trackPoints=[];
        document.getElementById('trackState').innerHTML =
          '🏟️ <b style="color:var(--volt)">Couloir '+d.lane+'</b> — tour de <b style="color:var(--volt)">'+d.laneLength.toFixed(2)+' m</b> — cap '+curBearing+'°';
        document.getElementById('trackInfo').innerHTML =
          '🏟️ Mode piste actif — couloir '+d.lane+' — <b style="color:var(--volt)">'+d.laneLength.toFixed(2)+' m</b> / tour';
      });
  }
  function exitTrack() {
    trackActive = false; trackOriginLL = null; clearLaneLayers();
    fetch('http://localhost:9877/api/track-mode?off=1');
    document.getElementById('trackState').textContent = 'Mode piste inactif';
    document.getElementById('trackInfo').textContent = 'Clique sur la carte pour tracer ta boucle';
  }

  // ============ PONT DIRECT ============
  var bridgeArmed = true;
  function smoothMs(){ var e=document.getElementById('smoothToggle'); return (e&&e.checked)?3000:0; }
  function toggleArm() {
    bridgeArmed = !bridgeArmed;
    fetch('http://localhost:9877/api/arm?on='+(bridgeArmed?'1':'0'))
      .then(function(r){return r.json();}).then(function(d){
        var el = document.getElementById('armState');
        el.textContent = d.armed ? '🎯 Pont ARMÉ — fix mock émis à 1 Hz' : '⏸️ Pont désarmé — le téléphone perdra son fix';
        el.style.color = d.armed ? 'var(--fuchsia)' : 'var(--rose)';
      });
  }
  function anchorHere() {
    var c = map.getCenter();
    fetch('http://localhost:9877/api/anchor?lat='+c.lat+'&lon='+c.lng+'&smooth='+smoothMs())
      .then(function(r){return r.json();}).then(function(){
        var el = document.getElementById('armState');
        el.textContent = '📍 Ancre posée : '+c.lat.toFixed(5)+', '+c.lng.toFixed(5);
        el.style.color = 'var(--volt)';
      });
  }

  // ============ PARCOURS LIBRE (OSRM) ============
  function drawWaypointMarkers() {
    for (var i=0;i<markers.length;i++) map.removeLayer(markers[i]);
    markers = [];
    for (var j=0;j<waypoints.length;j++) {
      var o = j === 0;
      markers.push(L.marker(waypoints[j], {interactive:false, icon:L.divIcon({className:'',iconSize:[22,22],iconAnchor:[11,11],
        html:'<div style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#0b0e15;border:2px solid '+(o?'#00e676':'#38bdf8')+';color:'+(o?'#00e676':'#38bdf8')+';font-size:10px;font-weight:800">'+(j+1)+'</div>'})}).addTo(map));
    }
  }
  function redrawTrack() {
    var c = getRunnerColor(currentActivity);
    trackGlow.setLatLngs(trackPoints).setStyle({color:c});
    trackLine.setLatLngs(trackPoints).setStyle({color:c});
  }
  function clientDistance(p1,p2) {
    var R=6371000, dLat=(p2[0]-p1[0])*Math.PI/180, dLon=(p2[1]-p1[1])*Math.PI/180;
    var a=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(p1[0]*Math.PI/180)*Math.cos(p2[0]*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }
  function computeLengthClient(pts){ var l=0; for(var i=0;i<pts.length-1;i++) l+=clientDistance(pts[i],pts[i+1]); return l; }
  function updateTrackInfo(fallback) {
    var el = document.getElementById('trackInfo');
    if (trackPoints.length < 2) { el.textContent = waypoints.length + ' point(s) — ajoute un 2ᵉ point.'; return; }
    var km = routeDistanceM != null ? (routeDistanceM/1000).toFixed(2) : (computeLengthClient(trackPoints)/1000).toFixed(2);
    el.innerHTML = (fallback ? '⚠️ Tracé direct (routage KO)' : '🛣️ Suit la route') +
      ' : <b style="color:var(--volt)">' + km + ' km</b> — ' + trackPoints.length + ' pts routés';
  }
  function recomputeRoute() {
    if (waypoints.length < 2) {
      trackPoints = waypoints.slice(); routeDistanceM = null;
      redrawTrack(); updateTrackInfo(); sendTrack(); return;
    }
    var wps = waypoints.slice();
    if (loopClosed && waypoints.length > 2) wps.push(waypoints[0]);
    var coords = [];
    for (var i=0;i<wps.length;i++) coords.push(wps[i][1] + ',' + wps[i][0]);
    var url = 'https://routing.openstreetmap.de/' + profileForActivity(currentActivity) +
      '/route/v1/driving/' + coords.join(';') + '?overview=full&geometries=geojson&steps=false&continue_straight=false';
    var mySeq = ++routeRequestSeq;
    document.getElementById('trackInfo').innerHTML = "⏳ Calcul de l'itinéraire…";
    fetch(url).then(function(r){return r.json();}).then(function(data){
      if (mySeq !== routeRequestSeq) return;
      if (data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error('NoRoute');
      trackPoints = data.routes[0].geometry.coordinates.map(function(c){ return [c[1], c[0]]; });
      routeDistanceM = data.routes[0].distance;
      redrawTrack(); updateTrackInfo(); sendTrack();
    }).catch(function(){
      if (mySeq !== routeRequestSeq) return;
      trackPoints = wps.slice(); routeDistanceM = null;
      redrawTrack(); updateTrackInfo(true); sendTrack();
    });
  }
  map.on('click', function(e) {
    if (trackActive) {
      trackOriginLL = e.latlng;
      fetch('http://localhost:9877/api/track-mode?lat='+e.latlng.lat+'&lon='+e.latlng.lng+'&bearing='+curBearing+'&lane='+curLane)
        .then(function(r){return r.json();}).then(function(d){ if(!d.error) drawLanes(d.geometry); });
      return;
    }
    waypoints.push([e.latlng.lat, e.latlng.lng]);
    drawWaypointMarkers(); recomputeRoute();
  });
  function undoWaypoint(){ if(!waypoints.length) return; waypoints.pop(); drawWaypointMarkers(); recomputeRoute(); }
  function toggleLoop(c){ loopClosed=c; if(waypoints.length>=2) recomputeRoute(); }
  function clearTrack() {
    waypoints=[]; trackPoints=[]; routeDistanceM=null; routeRequestSeq++;
    trackGlow.setLatLngs([]); trackLine.setLatLngs([]);
    for (var i=0;i<markers.length;i++) map.removeLayer(markers[i]);
    markers=[];
    if (runnerMarker) { map.removeLayer(runnerMarker); runnerMarker=null; }
    document.getElementById('trackInfo').textContent = 'Parcours effacé. Clique sur la carte.';
    document.getElementById('distVal').textContent = '0.00 km';
    sendTrack();
  }
  function sendTrack(){ fetch('http://localhost:9877/api/track',{method:'POST',body:JSON.stringify(trackPoints)}); }

  function setActivity(act, btn) {
    currentActivity = act;
    var bs = document.querySelectorAll('.act-btn');
    for (var i=0;i<bs.length;i++) bs[i].classList.remove('active');
    btn.classList.add('active');
    redrawTrack();
    if (runnerMarker) runnerMarker.setIcon(createRunnerIcon(act));
    fetch('http://localhost:9877/api/config?speed='+currentSpeed+'&activity='+act);
    if (waypoints.length >= 2) recomputeRoute();
  }
  function updateSpeed(val) {
    currentSpeed = parseFloat(val);
    document.getElementById('speedVal').textContent = currentSpeed.toFixed(1);
    var p = 60/currentSpeed, m = Math.floor(p), s = Math.round((p-m)*60);
    document.getElementById('paceVal').textContent = m+':'+(s<10?'0':'')+s+' /km';
    fetch('http://localhost:9877/api/config?speed='+currentSpeed+'&activity='+currentActivity);
  }
  function setSpeed(v){ document.getElementById('speedSlider').value = v; updateSpeed(v); }

  function toggleRun() {
    var b = document.getElementById('btnMain');
    if (!isRunning) {
      if (!trackActive && trackPoints.length < 2) { alert('Trace un parcours ou pose une piste !'); return; }
      fetch('http://localhost:9877/api/start?smooth='+smoothMs());
      isRunning = true; autoFollow = true; updateFollowButton();
      b.textContent = '⏹ STOPPER'; b.className = 'mainbtn btn-stop';
      document.getElementById('btnPause').style.display = 'block';
    } else {
      fetch('http://localhost:9877/api/stop');
      isRunning = false;
      b.textContent = '▶ LANCER LA SIMULATION'; b.className = 'mainbtn btn-start';
      document.getElementById('btnPause').style.display = 'none';
    }
  }
  function togglePause() {
    fetch('http://localhost:9877/api/pause').then(function(r){return r.json();}).then(function(d){
      document.getElementById('btnPause').textContent = d.paused ? '▶ REPRENDRE' : '⏸ PAUSE';
    });
  }

  function goToCoords() {
    var v = document.getElementById('gpsInput').value.trim();
    if (!v) return;
    var p = v.split(/[\\s,;]+/);
    if (p.length >= 2) {
      var la = parseFloat(p[0]), lo = parseFloat(p[1]);
      if (!isNaN(la) && !isNaN(lo)) map.setView([la, lo], 17);
    }
  }

  function saveTrack() {
    var n = document.getElementById('trackNameInput').value.trim();
    if (!n) { alert('Donne un nom au parcours !'); return; }
    if (trackPoints.length < 2) { alert('Trace un parcours d abord !'); return; }
    var s = JSON.parse(localStorage.getItem('rc_saved_tracks') || '{}');
    s[n] = {waypoints:waypoints, activity:currentActivity, loopClosed:loopClosed};
    localStorage.setItem('rc_saved_tracks', JSON.stringify(s));
    document.getElementById('trackNameInput').value = '';
    refreshTrackList();
  }
  function refreshTrackList() {
    var sel = document.getElementById('trackSelect');
    sel.innerHTML = '<option value="">— Charger un parcours —</option>';
    var s = JSON.parse(localStorage.getItem('rc_saved_tracks') || '{}');
    for (var k in s) { var o = document.createElement('option'); o.value=k; o.textContent=k; sel.appendChild(o); }
  }
  function loadTrack(name) {
    if (!name) return;
    var s = JSON.parse(localStorage.getItem('rc_saved_tracks') || '{}');
    var e = s[name];
    if (!e) return;
    clearTrack();
    if (Array.isArray(e)) { trackPoints = e; redrawTrack(); updateTrackInfo(true); map.setView(trackPoints[0],17); sendTrack(); return; }
    waypoints = e.waypoints || [];
    loopClosed = e.loopClosed !== false;
    document.getElementById('loopToggle').checked = loopClosed;
    drawWaypointMarkers();
    if (waypoints.length) map.setView(waypoints[0], 16);
    recomputeRoute();
  }

  refreshTrackList();
  loadAthlete();
  loadSessions();
</script>
</body>
</html>`;

// ===========================================================================
// §12  API HTTP
// ===========================================================================
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost:9877');
  const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };

  // ---------- page ----------
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(htmlContent);

  // ---------- simulation ----------
  } else if (url.pathname === '/api/start') {
    isRunning = true;
    isPaused = false;
    currentProgressMeters = 0;
    sessionDistance = 0;
    elevGain = 0; elevLoss = 0; laps = 0; elapsedS = 0;
    const startAlt = eleAtDistance(0);
    prevAlt = startAlt != null ? startAlt : baseAlt;
    if (idleInterval) { clearInterval(idleInterval); idleInterval = null; }
    const smooth = parseInt(url.searchParams.get('smooth') || '0', 10);
    if (smooth > 0 && warpFrom) { warpStart = Date.now(); warpMs = smooth; }
    if (!simInterval) simInterval = setInterval(tick, 250);
    broadcastCurrentPosition();
    json({ status: 'running', startAltitude: prevAlt, profileStatus: profileStatus });

  } else if (url.pathname === '/api/pause') {
    isPaused = !isPaused;
    json({ paused: isPaused });

  } else if (url.pathname === '/api/stop') {
    isRunning = false; isPaused = false;
    clearInterval(simInterval); simInterval = null;
    stopWorkout();
    broadcast({ type: 'stop' });
    updateIdleHeartbeat();
    broadcastCurrentPosition();
    json({ status: 'stopped', armed: armed });

  } else if (url.pathname === '/api/config') {
    const sp = parseFloat(url.searchParams.get('speed'));
    if (!isNaN(sp)) { manualSpeedKmh = sp; if (!wkActive) speedKmh = sp; }
    activity = url.searchParams.get('activity') || activity;
    json({ speed: speedKmh, activity: activity });

  // ---------- pont direct ----------
  } else if (url.pathname === '/api/arm') {
    const v = url.searchParams.get('on');
    armed = v == null ? true : (v === '1' || v === 'true');
    updateIdleHeartbeat();
    if (armed) broadcastCurrentPosition();
    console.log(armed ? '🎯 [PONT] ARMÉ — fix permanent actif.' : '⏸️  [PONT] désarmé.');
    json({ armed: armed, hasFix: !!currentFixPoint() });

  } else if (url.pathname === '/api/anchor') {
    const lat = parseFloat(url.searchParams.get('lat'));
    const lon = parseFloat(url.searchParams.get('lon'));
    const smooth = parseInt(url.searchParams.get('smooth') || '0', 10);
    if (isNaN(lat) || isNaN(lon)) { json({ error: 'lat/lon requis' }); }
    else {
      setAnchor(lat, lon, smooth);
      console.log('🎯 [ANCRE] Fix posé sur ' + lat.toFixed(5) + ', ' + lon.toFixed(5));
      json({ anchor: [lat, lon], armed: armed, smooth: smooth });
    }

  // ---------- profil athlète & VMA ----------
  } else if (url.pathname === '/api/athlete') {
    const num = (k, min, max, cur) => {
      const v = parseFloat(url.searchParams.get(k));
      return (!isNaN(v) && v >= min && v <= max) ? v : cur;
    };
    const had = url.searchParams.toString().length > 0;
    if (had) {
      athlete.age = Math.round(num('age', 10, 99, athlete.age));
      athlete.fcRepos = Math.round(num('fcRepos', 30, 110, athlete.fcRepos));
      athlete.fcMax = Math.round(num('fcMax', 120, 230, athlete.fcMax));
      athlete.vma = Math.round(num('vma', 6, 26, athlete.vma) * 10) / 10;
      athlete.poids = Math.round(num('poids', 30, 180, athlete.poids));
      if (athlete.fcMax <= athlete.fcRepos + 20) athlete.fcMax = athlete.fcRepos + 60;
      SESSIONS = buildSessions();
      console.log('❤️  [ATHLÈTE] âge ' + athlete.age + ' · FCrepos ' + athlete.fcRepos +
        ' · FCmax ' + athlete.fcMax + ' · VMA ' + athlete.vma + ' km/h (allure ' + paceString(athlete.vma) + '/km)');
      broadcast({ type: 'athlete', athlete: athlete, vmaPace: paceString(athlete.vma) });
    }
    json({
      athlete: athlete,
      tanaka: fcMaxTanaka(athlete.age),
      astrand: fcMaxAstrand(athlete.age),
      fcReserve: athlete.fcMax - athlete.fcRepos,
      vmaPace: paceString(athlete.vma),
      zones: ZONES.map(z => ({
        z: z.z, name: z.name, color: z.color,
        kmhLo: Math.round(athlete.vma * z.lo * 10) / 10,
        kmhHi: Math.round(athlete.vma * z.hi * 10) / 10,
        fcLo: hrForIntensity(z.lo), fcHi: hrForIntensity(z.hi)
      })),
      table: vmaTable(),
      predictions: predictions()
    });

  // ---------- séances ----------
  } else if (url.pathname === '/api/sessions') {
    json({ sessions: sessionCatalog(), families: ['Fractionné', 'Seuil', 'Pyramide', 'Tabata', 'Fartlek', 'Test'] });

  } else if (url.pathname === '/api/session') {
    const s = SESSIONS.filter(x => x.id === url.searchParams.get('id'))[0];
    if (!s) { json({ error: 'séance inconnue' }); }
    else {
      json({
        id: s.id, name: s.name, family: s.family, desc: s.desc,
        summary: sessionSummary(s),
        phases: s.phases.map(p => ({
          kind: p.kind, label: p.label,
          pctVma: Math.round(p.pctVma * 100),
          kmh: phaseTargetKmh(p),
          pace: paceString(phaseTargetKmh(p)),
          hr: hrForIntensity(p.pctVma),
          durationS: p.durationS || null,
          distanceM: p.distanceM || null,
          rep: p.rep || null, repTotal: p.repTotal || null
        }))
      });
    }

  } else if (url.pathname === '/api/workout/start') {
    const ok = startWorkout(url.searchParams.get('id'));
    json(ok ? workoutState() : { error: 'séance inconnue' });

  } else if (url.pathname === '/api/workout/stop') {
    stopWorkout();
    json({ active: false });

  } else if (url.pathname === '/api/workout/skip') {
    if (wkActive) { nextPhase(false); json(workoutState()); } else json({ error: 'aucune séance active' });

  } else if (url.pathname === '/api/workout') {
    json(workoutState());

  // ---------- piste d'athlétisme ----------
  } else if (url.pathname === '/api/track-mode') {
    if (url.searchParams.get('off') === '1') {
      trackMode = false;
      broadcast({ type: 'trackmode', active: false });
      console.log('🏟️  [PISTE] Mode piste désactivé.');
      json({ trackMode: false });
      return;
    }
    const lat = parseFloat(url.searchParams.get('lat'));
    const lon = parseFloat(url.searchParams.get('lon'));
    const lane = Math.min(TRACK_LANES, Math.max(1, parseInt(url.searchParams.get('lane') || '1', 10)));
    const brg = parseFloat(url.searchParams.get('bearing'));
    if (!isNaN(lat) && !isNaN(lon)) trackOrigin = [lat, lon];
    if (!isNaN(brg)) trackBearing = brg;
    if (!trackOrigin) { json({ error: 'point A (lat/lon) requis' }); return; }

    trackMode = true;
    trackLane = lane;
    trackLaneLength = laneLength(lane);
    rawTrack = buildLanePolyline(trackOrigin, trackBearing, lane, 2);
    trackCum = computeCumulative(rawTrack);
    totalTrackLengthMeters = trackLaneLength;  // longueur OFFICIELLE du couloir
    currentProgressMeters = 0;
    anchorPoint = rawTrack[0];
    laps = 0; sessionDistance = 0;
    profileStatus = 'fetching';
    trackEle = null;

    broadcast({
      type: 'trackmode', active: true, lane: lane,
      laneLength: Math.round(trackLaneLength * 100) / 100,
      lanes: laneTable(), bearing: trackBearing, origin: trackOrigin,
      straight: TRACK_STRAIGHT, kerbRadius: TRACK_KERB_R, laneWidth: TRACK_LANE_W,
      standard: 'World Athletics 400m'
    });
    broadcastCurrentPosition();
    updateIdleHeartbeat();

    const ref = rawTrack;
    buildElevationProfile(rawTrack, trackCum).then(p => {
      if (rawTrack !== ref) return;
      if (p) {
        trackEle = p; profileStatus = 'ok'; baseAlt = p[0];
        broadcast({ type: 'profile', elevation: 'ok', startAltitude: p[0], source: 'open-meteo' });
        broadcastCurrentPosition();
      }
    }).catch(() => {});

    console.log('🏟️  [PISTE] Couloir ' + lane + ' — ' + trackLaneLength.toFixed(2) + ' m — cap ' +
      trackBearing + '° — point A ' + trackOrigin[0].toFixed(5) + ', ' + trackOrigin[1].toFixed(5));
    json({
      trackMode: true, lane: lane,
      laneLength: Math.round(trackLaneLength * 100) / 100,
      lanes: laneTable(),
      geometry: buildAllLanes(trackOrigin, trackBearing)
    });

  // ---------- état global ----------
  } else if (url.pathname === '/api/status') {
    json({
      version: '3.0',
      armed: armed, running: isRunning, paused: isPaused,
      phones: phoneCount(),
      hasTrack: rawTrack.length > 1, hasFix: !!currentFixPoint(),
      anchor: anchorPoint, profileStatus: profileStatus,
      activity: activity, speedKmh: speedKmh,
      trackMode: trackMode, lane: trackMode ? trackLane : null,
      athlete: athlete, hr: Math.round(currentHr),
      workout: workoutState()
    });

  // ---------- trace libre ----------
  } else if (url.pathname === '/api/track') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let trackRef = null;
      try {
        const parsed = JSON.parse(body);
        const points = Array.isArray(parsed) ? parsed : parsed.points;
        if (!Array.isArray(points) || points.length < 2) {
          rawTrack = []; trackCum = []; trackEle = null;
          profileStatus = 'none'; totalTrackLengthMeters = 0; currentProgressMeters = 0;
          json({ distanceMeters: 0 });
          return;
        }
        const hasEle = typeof points[0][2] === 'number';
        if (trackMode) { trackMode = false; broadcast({ type: 'trackmode', active: false }); }
        rawTrack = points.map(p => [p[0], p[1]]);
        trackCum = computeCumulative(rawTrack);
        totalTrackLengthMeters = trackCum[trackCum.length - 1];
        currentProgressMeters = 0;
        trackEle = null;
        profileStatus = 'fetching';
        trackRef = rawTrack;
        anchorPoint = rawTrack[0];
        broadcastCurrentPosition();
        updateIdleHeartbeat();

        if (hasEle) {
          trackEle = movingAvg(points.map(p => p[2]), 2).map(e => Math.round(e * 10) / 10);
          profileStatus = 'client';
          baseAlt = trackEle[0];
          broadcast({ type: 'profile', elevation: 'ok', startAltitude: trackEle[0], source: 'client' });
          broadcastCurrentPosition();
        } else {
          buildElevationProfile(rawTrack, trackCum)
            .then(profile => {
              if (rawTrack !== trackRef) return;
              if (profile) {
                trackEle = profile; profileStatus = 'ok'; baseAlt = profile[0]; prevAlt = null;
                console.log('🛰️  [Altitude] Profil SRTM prêt — départ : ' + profile[0] + ' m / ' + rawTrack.length + ' pts');
                broadcast({ type: 'profile', elevation: 'ok', startAltitude: profile[0], source: 'open-meteo' });
                broadcastCurrentPosition();
              } else {
                profileStatus = 'fallback';
                console.warn('⚠️  [Altitude] API injoignable — altitude de repli : ' + baseAlt + ' m');
                broadcast({ type: 'profile', elevation: 'fallback', startAltitude: baseAlt });
              }
            })
            .catch(() => { profileStatus = 'fallback'; });
        }
        json({ distanceMeters: totalTrackLengthMeters, elevation: profileStatus });
      } catch (e) { json({ error: e.message }); }
    });

  } else {
    res.writeHead(404);
    res.end();
  }
});

// ===========================================================================
// §13  DÉMARRAGE
// ===========================================================================
function onHttpReady() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════════╗');
  console.log('  ║   RUNCREW STUDIO v3.0 — BANC D\'ESSAI GPS                     ║');
  console.log('  ╚══════════════════════════════════════════════════════════════╝');
  console.log('  🛰️  Altitude réelle SRTM (Open-Meteo)         → fini les 52 m figés');
  console.log('  🔌 Ponts ADB par appareil                     → multi-téléphones OK');
  console.log('  🎯 Pont armé (fix 1 Hz)                       → Pacer sans attente GPS');
  console.log('  🏟️  Piste 400 m, 8 couloirs                    → 400.00 → 453.03 m');
  console.log('  🏋️  Séances VMA à récup automatique            → ' + SESSIONS.length + ' programmes');
  console.log('  ❤️  Profil athlète VMA ' + athlete.vma + ' km/h · FCmax ' + athlete.fcMax + ' · FCrepos ' + athlete.fcRepos);
  console.log('');
  console.log('  → Dashboard : http://localhost:9877');
  console.log('');
  exec('start http://localhost:9877');
}

wsHttpServer.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('⚠️  Port 9876 occupé (ancien Studio ?) → libération automatique…');
    freePort(9876, () => wsHttpServer.listen(9876));
  } else console.error('[WS]', e.message);
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('⚠️  Port 9877 occupé → libération automatique…');
    freePort(9877, () => server.listen(9877, onHttpReady));
  } else console.error('[HTTP]', e.message);
});

wsHttpServer.listen(9876, () => {
  console.log('🛰️  Flux WebSocket en écoute sur le port 9876 — en attente des téléphones…');
});
server.listen(9877, onHttpReady);
