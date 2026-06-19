# Logging unilatéral : deux côtés par série, e1RM côté faible

Sur un exercice marqué `unilateral`, une série se logge un côté à la fois. Les deux saisies (gauche et droite) d'une même série partagent le **même** `set_order` et portent un `side` distinct : deux lignes `performed_sets` au même rang, chacune avec ses propres poids/reps/RIR. Le côté est **choisi à la saisie** via un sélecteur G/D, sans ordre imposé (on peut commencer par la droite). Pour la progression, le point de courbe est l'e1RM du **côté faible** (le plus bas des deux) sur la première série.

## Pourquoi

Un exo unilatéral n'a pas une charge mais deux, potentiellement déséquilibrées. Stocker les deux côtés dans la même série (même `order`) garde l'appariement explicite et auditable sans nouvelle table. Le côté faible dicte la charge réelle et le risque de déséquilibre : c'est lui qui doit piloter la lecture de progression, pas une moyenne qui masquerait l'écart. Imposer « gauche puis droite » aurait cassé la capture zéro-friction dès qu'on entame une série par le mauvais côté.

## Alternatives écartées

- **Une ligne par série avec deux jeux de valeurs** : alourdit le schéma `performed_sets` (colonnes gauche/droite) et complique l'append-only ; deux lignes au même `order` réutilisent le modèle existant.
- **Deux exécutions séparées (une par côté)** : casse l'idée d'une série = un rang, et le diff de déviations.
- **e1RM moyen ou côté fort** : noie le déséquilibre que l'analyse cherche justement à révéler.

## Conséquences

- L'appariement des côtés se fait par `set_order` ; un seul côté loggé (saisie incomplète) reste une série entamée, sans côté fabriqué.
- L'édition d'une exécution passée est consciente du `side` : il est porté de bout en bout (chargement → diff → outbox → DB) et `reorderSets` recompacte par **série logique** (les deux côtés gardent un `order` commun), sinon l'édition dé-apparierait gauche/droite.
- Le décompte de séries (ADR 0006) traite la paire G/D comme une seule série logique.
