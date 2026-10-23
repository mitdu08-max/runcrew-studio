# RunCrew Studio — audit visuel & pistes d’évolution

## Périmètre

Cette passe porte sur `ui_web`, l’interface React/Vite du banc d’essai. Le moteur historique de `server.js` conserve ses fonctions ADB, WebSocket, cardio et séances. Les nouveaux scénarios de l’interface React sont **locaux à ce simulateur** ; leur transmission au téléphone nécessite le raccordement au pont de `server.js`.

## Ce qui était déjà solide

- Un vrai cas d’usage technique : construction d’itinéraire, élévation SRTM et simulation par distance.
- Un profil d’altitude interactif relié à la position sur la carte.
- Des choix honnêtes en cas de panne : repli en segments directs et absence de profil inventé.
- Une identité sombre et un vert RunCrew déjà reconnaissables.
- La sauvegarde locale des parcours et l’export GPX avec élévations.

## Problèmes identifiés et corrigés

- **Compilation bloquée** : le diagnostic référençait deux fichiers absents. Les téléchargements utilisent maintenant les vrais `server.js` et `build_exe.ps1` du dépôt.
- **Diagnostic imposé à l’ouverture** : il masquait la découverte de l’application. Il est désormais disponible à la demande dans « Guide technique ».
- **Hiérarchie trop dense** : la colonne unique de 380 px mélangeait préparation, pilotage et télémétrie. Elle est organisée en deux onglets avec des actions de session toujours accessibles.
- **Lisibilité** : les libellés essentiels, valeurs, états et contrôles ont gagné en taille et en contraste ; les effets de glow ont été réduits.
- **Carte partiellement masquée** : le profil n’est plus superposé aux contrôles Leaflet. La carte se redimensionne avec le panneau et recadre une nouvelle trace.
- **Édition limitée** : les waypoints sont maintenant déplaçables, listés avec leurs coordonnées et supprimables individuellement. Le tracé est verrouillé pendant une session.
- **Absence de retour de contexte** : un HUD indique l’état, la progression, le chrono, l’allure, le GPS et la fin estimée du tour.
- **Petits écrans** : les réglages deviennent un panneau latéral mobile avec fond de recouvrement.

## Ajouts orientés « banc d’essai »

1. **Horloge ×1, ×2, ×4 et ×8** pour rejouer rapidement de longues sessions sans changer l’allure de consigne.
2. **Scénarios GPS nominal, dégradé et perte** avec gigue, cap instable, précision variable et conservation du dernier fix.
3. **Cercle de précision GPS** sur la carte pour visualiser la dégradation au lieu de se fier uniquement à une valeur numérique.
4. **Journal horodaté** des actions et changements de scénario, avec temps de session simulé.
5. **Rapport JSON** contenant configuration, waypoints, métriques du parcours, dernière télémétrie et événements.
6. **Export CSV** du journal pour annotation dans Excel ou Sheets.
7. **Boucle d’exemple** pour arriver à un test exploitable sans comprendre toute l’interface au préalable.
8. **Raccourcis clavier** : Espace pour lancer/mettre en pause/reprendre, Ctrl/Cmd+Z pour annuler un point, Échap pour fermer les panneaux.

## Recommandations prioritaires

### P0 — Réunifier le prototype et le banc matériel

Brancher `ui_web` sur les API et le WebSocket de `server.js`, puis afficher des états strictement réels : téléphone détecté, ADB reverse actif, dernier paquet reçu, fréquence effective et erreurs. Éviter tout indicateur « connecté » fondé sur un simple état visuel.

### P1 — Transformer le journal en véritable outil de non-régression

- Ajouter des **scénarios programmés** : par exemple « GPS dégradé à 00:30, perte à 01:00, retour nominal à 01:15 ».
- Ajouter des **assertions de test** : dérive maximale, durée sans fix, reprise du Pacer, continuité du chrono et tolérance d’altitude.
- Produire un verdict **réussi / échec** avec la valeur mesurée et le seuil attendu.
- Permettre la comparaison de deux rapports pour visualiser les régressions entre deux versions de RunCrew.
- Créer un **paquet de reproduction** : rapport + GPX + configuration + version de l’application.

### P1 — Élargir les formats et la reprise de travail

- Importer un GPX en conservant sa géométrie d’origine plutôt qu’en le réduisant à quelques waypoints.
- Sauvegarder automatiquement le brouillon du parcours et proposer de le restaurer après rechargement.
- Ajouter un bouton « Dupliquer » sur les parcours sauvegardés pour créer des variantes de test.

### P2 — Robustesse et accessibilité

- Ajouter des tests unitaires pour la géodésie, l’interpolation d’altitude, les changements de tour et l’accélération du temps.
- Ajouter des tests d’interface pour les raccourcis, la perte/reprise GPS et les exports.
- Prévoir un fond de carte de secours et un état hors-ligne explicite ; les services OSRM, Open-Meteo et les tuiles restent des dépendances réseau.
- Vérifier les contrastes au niveau WCAG AA et conserver la prise en charge de `prefers-reduced-motion`.

## Idées de scénarios souvent oubliés

- Saut d’horloge du téléphone ou timestamps non monotones.
- Deux téléphones recevant le même flux avec des latences différentes.
- Reprise après mise en veille de l’application ou perte du WebSocket.
- Tracé qui traverse l’antiméridien ou coordonnées à très faible précision.
- Altitude manquante sur une partie seulement du profil.
- Changement d’allure pendant une perte GPS, puis rattrapage à la reconnexion.
- Test de longue durée pour détecter dérive mémoire, accumulation d’événements et baisse de fréquence.
