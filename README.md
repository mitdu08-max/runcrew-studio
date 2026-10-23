# 🎮 RunCrew Studio (v3.0) — Banc d'Essai GPS & Simulateur Télémétrie

Outil de simulation matérielle et de banc d'essai GPS haute fidélité pour l'écosystème **RunCrew**.

---

## 🚀 Vue d'Ensemble

RunCrew Studio simule un coureur, cycliste ou randonneur en mouvement direct et injecte des trames GPS + cardio en temps réel sur les téléphones connectés en USB via ADB.

### 🌟 Fonctionnalités Clés
- **Altitude Réelle MNT (Open-Meteo SRTM 90m)** : Fini les altitudes figées à 50m. Studio interroge la topographie réelle du terrain le long du tracé.
- **Pont ADB Automatique Multi-Appareils** : Détecte les téléphones branchés en USB (`adb devices -l`) et configure les règles `adb reverse tcp:9876 tcp:9876`.
- **Mode Piste 400 m (8 Couloirs)** : Calcule la distance exacte selon le couloir (de 400.00 m au couloir 1 à 453.03 m au couloir 8) et oriente la piste selon n'importe quel cap.
- **Simulateur d'Allure & Séances VMA** : Programmes de fractionné (30/30, 200m, 400m, 800m, seuil) avec gestion automatique des phases de récupération.
- **Simulateur Cardio Suunto/BLE** : Simule les zones FC (Z1 à Z5) en fonction de la VMA de l'athlète ($FC_{max}$, $FC_{repos}$).
- **Injections Live & Tests Pacer** : Boutons instantanés pour tester les sur-régimes (+3 km/h), retards (-3 km/h) et alertes vocales du Pacer.

---

## 🔌 Architecture & Protocoles

| Canal | Port | Protocole | Rôle |
|---|---|---|---|
| **Télémétrie Mobile** | `9876` | WebSocket (`ws://127.0.0.1:9876`) | Injection brute de coordonnées 1 Hz dans `BackgroundService` |
| **Dashboard Web** | `9877` | HTTP (`http://localhost:9877`) | Interface de contrôle Leaflet / OSRM |

### Payload WebSocket (`type: 'position'`)
```json
{
  "type": "position",
  "lat": 43.4217,
  "lng": 6.675192,
  "speed": 3.05,
  "speedKmh": 11.0,
  "heading": 142.5,
  "altitude": 315.0,
  "accuracy": 3.0,
  "activity": "running",
  "hr": 154,
  "distanceMeters": 1420.5,
  "timestamp": 1726414480000
}
```

---

## 💻 Démarrage Rapide

### 1. Lancer le serveur Studio
```powershell
cd runcrew_studio
npm install
node server.js
```
Le Dashboard s'ouvre automatiquement sur `http://localhost:9877`.

### 2. Compiler en exécutable autonome (`RunCrew_Studio.exe`)
```powershell
./build_exe.ps1
```
L'exécutable autonome est généré directement sur le Bureau Windows via `pkg` (Node 18 x64).

---

## 📁 Structure du Répertoire
- `server.js` : Moteur complet Studio v3.0 (Serveur HTTP Leaflet + Serveur WebSocket télémétrie + moteur SRTM + ADB reverse).
- `build_exe.ps1` : Script PowerShell de compilation autonome de l'exécutable Desktop.
- `ui_web/` : Code source complet de la version modulaire React 19 / TypeScript / Vite / TailwindCSS / Lucide.
