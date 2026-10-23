import { AnimatePresence, motion } from "framer-motion";
import {
  X, Bug, FileDown, CheckCircle2, Ruler, Database, Spline, Waves, Play, AlertTriangle,
} from "lucide-react";
import rawServer from "../assets/fix/server.js?raw";
import rawPs1 from "../assets/fix/RunCrew_Recompile.ps1?raw";

function dl(name: string, content: string) {
  const u = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}

const STEPS = [
  { icon: Ruler, title: "Échantillonnage intelligent", text: "1 relevé tous les ~110 m le long de la géométrie OSRM (30 à 180 points), pas un seul point au hasard." },
  { icon: Database, title: "Open-Meteo SRTM 90 m", text: "API d'élévation gratuite et sans clé, requêtes par lots de 96 coordonnées avec retry automatique." },
  { icon: Spline, title: "Interpolation keyed-by-distance", text: "Chaque point de la trace reçoit une altitude interpolée par recherche binaire sur la distance cumulée." },
  { icon: Waves, title: "Lissage MA5 + seuil anti-bruit", text: "Moyenne glissante sur 5 points ; D+/D− calculés avec seuil de 0,6 m pour ignorer le bruit du MNT." },
  { icon: Play, title: "Départ = altitude réelle", text: "Ton 1er clic déclenche immédiatement un relevé : au lancement, l'altitude affichée est celle du terrain, 315 m." },
];

export default function DiagnosticModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 26, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-line bg-panel-2/70 px-5 py-4">
              <div>
                <h2 className="text-[15px] font-extrabold tracking-wide text-white">
                  DIAGNOSTIC — <span className="text-amberx">POURQUOI 52 M AU LIEU DE 315 M ?</span>
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-500">Analyse du moteur GPS + correctif prêt à compiler</p>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg border border-line p-1.5 text-slate-400 transition-colors hover:border-rose-500/50 hover:text-rose-400"
              >
                <X size={16} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              {/* bugs */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-extrabold tracking-wide text-rose-400">
                    <Bug size={13} /> BUG N°1 — ALTITUDE FIGÉE ≈ 52 M
                  </div>
                  <div className="num overflow-x-auto rounded-lg bg-ink p-2.5 text-[10.5px] leading-relaxed text-rose-300">
                    altitude = 50 + sin(progress<br />* 0.005) * 15
                  </div>
                  <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">
                    L'altitude était une <b className="text-slate-200">sinusoïde synthétique</b> centrée sur 50 m.
                    À progress = 0 → 50 m pile, puis dérive vers ~52 m. Le terrain n'était jamais consulté.
                  </p>
                </div>
                <div className="rounded-xl border border-amberx/30 bg-amberx/5 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-extrabold tracking-wide text-amberx">
                    <AlertTriangle size={13} /> BUG N°2 — POINT À 315 M IGNORÉ
                  </div>
                  <div className="num overflow-x-auto rounded-lg bg-ink p-2.5 text-[10.5px] leading-relaxed text-amber-200">
                    waypoints = [[lat, lon]…]<br />// aucune élévation
                  </div>
                  <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">
                    Les points cliqués ne transportaient que <b className="text-slate-200">lat/lon</b>. Aucune requête
                    d'élévation n'existait — le départ à 315 m ne pouvait jamais remonter.
                  </p>
                </div>
              </div>

              {/* fix pipeline */}
              <div>
                <h3 className="mb-2.5 text-[11px] font-extrabold tracking-[0.16em] text-volt">
                  LE CORRECTIF — MOTEUR D'ÉLÉVATION v2 (celui qui tourne dans cette démo)
                </h3>
                <div className="space-y-2">
                  {STEPS.map(({ icon: Icon, title, text }, i) => (
                    <div key={title} className="flex items-start gap-3 rounded-xl border border-line bg-panel-2/60 p-3">
                      <div className="num mt-0.5 text-[10px] font-bold text-slate-600">{String(i + 1).padStart(2, "0")}</div>
                      <Icon size={15} className="mt-0.5 shrink-0 text-volt" />
                      <div>
                        <div className="text-[12px] font-bold text-white">{title}</div>
                        <div className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{text}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* résultat */}
              <div className="rounded-xl border border-volt/30 bg-volt/5 p-4">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-extrabold tracking-wide text-volt">
                  <CheckCircle2 size={13} /> RÉSULTAT
                </div>
                <div className="num grid grid-cols-3 gap-2 text-center text-[10px]">
                  <div className="text-slate-500" />
                  <div className="font-bold text-rose-400">AVANT</div>
                  <div className="font-bold text-volt">APRÈS</div>
                  {[
                    ["Démarrage", "50 → ~52 m", "315 m réels"],
                    ["Profil", "sinusoïde inventée", "SRTM par distance"],
                    ["D+ / D−", "absents", "calculés en direct"],
                    ["Pente", "nulle", "% instantané lissé"],
                  ].map(([label, a, b]) => (
                    <FragmentRow key={label} label={label} a={a} b={b} />
                  ))}
                </div>
              </div>

              {/* downloads */}
              <div className="rounded-xl border border-line bg-panel-2/60 p-4">
                <h3 className="mb-3 text-[11px] font-extrabold tracking-[0.16em] text-white">
                  APPLIQUER LE CORRECTIF À TON .EXE
                </h3>
                <ol className="mb-4 space-y-1.5 text-[11.5px] leading-relaxed text-slate-400">
                  <li><span className="num font-bold text-volt">1.</span> Télécharge <b className="text-slate-200">server.js</b> et remplace l'ancien dans <span className="num text-slate-300">C:\Users\ATony\RunnerDashboard</span></li>
                  <li><span className="num font-bold text-volt">2.</span> Télécharge et lance <b className="text-slate-200">RunCrew_Recompile.ps1</b> (libère les ports, recompile avec pkg, tunnel ADB, démarre)</li>
                  <li><span className="num font-bold text-volt">3.</span> L'exe démarre : altitude réelle dès le 1er point, D+/D− et profil sur ta carte habituelle</li>
                </ol>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => dl("server.js", rawServer)}
                    className="flex items-center gap-2 rounded-xl bg-volt px-4 py-2.5 text-[12px] font-extrabold text-ink transition-shadow hover:shadow-[0_0_24px_rgba(0,230,118,.45)]"
                  >
                    <FileDown size={14} /> SERVER.JS CORRIGÉ
                  </button>
                  <button
                    onClick={() => dl("RunCrew_Recompile.ps1", rawPs1)}
                    className="flex items-center gap-2 rounded-xl border border-amberx/50 bg-amberx/10 px-4 py-2.5 text-[12px] font-extrabold text-amberx transition-colors hover:bg-amberx/20"
                  >
                    <FileDown size={14} /> RUNCREW_RECOMPILE.PS1
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FragmentRow({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <>
      <div className="rounded bg-panel-2 px-2 py-1.5 text-left font-semibold text-slate-400">{label}</div>
      <div className="rounded bg-rose-500/10 px-2 py-1.5 font-semibold text-rose-300">{a}</div>
      <div className="rounded bg-volt/10 px-2 py-1.5 font-semibold text-volt">{b}</div>
    </>
  );
}
