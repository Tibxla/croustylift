# Intent — Tracker de musculation mobile

## 1. Produit en une phrase

Tracker de musculation mobile pour toi et quelques potes (multi-user) : capture minimale des séries en salle, analyse de la progression au calme.

- **But** : hypertrophie. Indicateur principal = progresser sur les mêmes lifts dans le temps.
- **Utilisateurs** : toi + quelques potes (multi-user, petite échelle informelle — pas un produit commercial). Capture sur iPhone ; analyse sur tel **ou PC**.
- **Contraintes dures** : budget **0 €** (free tier Supabase), capture **mobile-first iOS**, analyse **multi-device**, données **synchronisées** entre appareils.

## 2. Idée mère / clé de voûte

L'analyse ne se fait jamais en salle (téléphone posé, ou plus tard sur PC). Conséquence structurante : **deux surfaces distinctes**.

- **Capture** — en salle, minimale, zéro-friction, survit au background.
- **Analyse** — au calme, riche, courbes et comparaisons.

Cette séparation résout seule la tension entre logger vite (cramé en salle) et logger beaucoup (besoin de données pour l'analyse) : elle autorise un écran de capture dépouillé et déporte toute la complexité côté analyse.

## 3. Plateforme & architecture

Décidé en prolongement de la session.

- **Type d'app** : **PWA** installable (Ajout à l'écran d'accueil iOS — ni App Store ni compte dev Apple 99 $/an). 0 €.
- **Front** : Vite + React + TypeScript + Tailwind. (Next écarté : pas de SSR utile pour une app de ce type.)
- **Backend / DB** : **Supabase** — Postgres + **Auth** (email / magic link) + **RLS**. Free tier suffit largement (50k MAU, 500 Mo). *Caveat free tier : projet mis en pause après 7 j d'inactivité — non bloquant à l'usage régulier.*
- **Multi-user** : chaque user authentifié ; **RLS** (`user_id = auth.uid()`) isole les données. Pas de billing, pas d'admin, pas de team-management.
- **Local-first / offline** : la **capture en salle fonctionne offline** — le téléphone met en cache exos + dernières perfs (pour afficher la cible « à battre ») et **met les écritures en file d'attente**, puis **synchronise vers Supabase** au retour du réseau. Élimine le saboteur « wifi de salle pourri → séance perdue ».
- **Analyse** : lecture **live depuis Supabase** (tel ou PC).
- **Couche de sync** : Dexie (IndexedDB) comme cache + file d'écritures, ou RxDB avec réplication Supabase. Le modèle « déviation = événement append-only » facilite la synchro. *Point le plus complexe du build — à concevoir avec soin.*
- **Graphes** : Recharts (ou uPlot si besoin ultra-léger).
- **e1RM / calculs** : fonctions TypeScript pures, aucune lib.
- **Hébergement** : Cloudflare Pages ou Vercel (free tier). 0 €.

## 4. Décisions verrouillées

### Écran Capture (zéro-friction)

- Nom de l'exo en cours = roi de l'écran ; sert à se réorienter en <1s après un context-switch (notif, scroll, discussion).
- Co-roi : cible « X kg × N à battre » = dernière perf sur l'exo (ligne dernière-fois / à-battre).
- Historique inline pendant la série : perf des dernières fois sur l'exo, visible comme référence.
- Logger une série = 1 tap sur place, cible déjà affichée, zéro menu, zéro navigation.
- Saisie 100% numérique au pouce (steppers +/- ou pavé custom). **Zéro clavier OS texte.** Poids ET reps.
- Track par série : poids + reps + RIR, chaque série est un track distinct (série 1 ≠ série 2).
- Ordre des exos libre : écran « je tape l'exo que j'attaque », tracé séparément du template.
- Temps de repos entre séries = **non tracké**.
- BPM moyen + durée de séance = saisis **à la main en fin de séance** (pas de capteur, pas de chrono auto).
- BPM et durée affichés sur le même graphe (métriques liées).
- **Pas de cran de progression calculé** : l'app affiche la dernière perf comme référence (à battre = dernière fois), elle ne propose pas de cible auto-incrémentée.

### Flexibilité & auditabilité (déviations)

- Toute déviation (skip, annulation, ajout, swap) = **événement loggé**. Le template d'origine est conservé à côté → le log expose template VS réel, auditable.
- Règle d'intégrité algo : une série non faite = **trou** dans la courbe (donnée absente), jamais une chute à zéro. Distinguer « pas fait » (exclu) de « fait moins bien » (compté).
- 1re série skippée ou changée = trou (pas de point ce jour). Acceptable car si l'exo est bon, la 1re série est la bonne la grande majorité du temps → trous rares.

### Modèle de données

- Définition d'exo, avec **tag groupe-musculaire** (requis pour l'analyse de volume et la pente par muscle).
- Note **par exo** : instructions spécifiques, persistante, attachée à la définition de l'exo.
- Note **datée** sur un exo un jour donné : contexte d'une perf, attachée à l'exécution (pas à la définition).
- Template de routine (le plan prévu) distinct du log réel.
- **Bloc** = période où une routine était active, **détecté automatiquement** (pas de saisie manuelle de bornes).
- Log brut des lifts accessible directement, pas seulement les e1RM estimés.
- Toutes les données sont **scopées par `user_id`** (RLS Supabase) — chaque user ne voit que les siennes.
- **Catalogue d'exos** : un **set de base commun, en lecture seule** (exos courants pré-remplis) + **exos perso** créés par chaque user par-dessus.
- **Routines / séances** : propres à chaque user, **pas de partage entre potes** (v1).

### Formule d'overload

- Métrique de progression = **e1RM RIR-ajusté de la 1re série** = courbe primaire.
  - e1RM standard suppose la série à l'échec (RIR 0) ; comme le RIR est loggé, ajuster `reps_to_failure = reps + RIR` avant calcul.
  - Formule retenue : **Epley** → `e1RM = poids × (1 + (reps + RIR) / 30)`. Epley plutôt que Brzycki car stable au-delà de 10-12 reps. Réversible (données brutes conservées → recalcul possible à tout moment).
- « Seule la 1re série compte » pour la courbe primaire (série fraîche = proxy de force max / tension mécanique). Séries suivantes = résistance à la fatigue / capacité de travail → graphes secondaires.
- Deux signaux bedrock pour l'hypertrophie : (a) tension mécanique = e1RM 1re série ; (b) volume hebdo/muscle = driver de croissance.
- Volume hebdo brut seul = signal bidon : la fréquence compte autant. On compare des **routines** (volume + fréquence ensemble), pas un chiffre de volume.
- Comparaison de blocs = superposer la **pente** de progression de l'e1RM 1re série par exo.
  - Pente exprimée en **% de gain d'e1RM / semaine** (pente relative) → neutralise le niveau de départ et les rendements décroissants.
  - Gagnant = pente la plus raide. Verdict « volume gagnant » = vitesse de progression du lift uniquement (pas de mensurations ni photos ; proxy accepté).
  - Nécessite un minimum de points par bloc.
- Superposition de plusieurs courbes pour comparer des blocs/routines (ex. 2 vs 4 séries triceps /2j sur 4 mois).

## 5. Scope v1 — MoSCoW

**Must**
- Deux surfaces séparées Capture / Analyse.
- **Comptes (Supabase Auth) + isolation RLS par user.**
- **Catalogue d'exos de base (lecture seule) + exos perso par user.**
- **Capture offline-résiliente** : cache local + file d'écritures (IDs UUID générés client), sync vers Supabase au retour réseau, conflits en **last-write-wins** par ligne (cf. ADR 0003).
- Écran Capture zéro-friction (nom-roi, cible à-battre, saisie numérique au pouce, log 1 tap).
- Track par série : poids + reps + RIR.
- Ordre des exos libre, tracé séparément du template.
- Déviations loggées comme événements ; template conservé à côté.
- Trou ≠ zéro dans la courbe.
- e1RM RIR-ajusté de la 1re série, courbe primaire par exo.
- Note par exo + note datée par exécution.
- Tag groupe-musculaire sur les exos.
- Log brut des lifts consultable.

**Should**
- Détection automatique des blocs.
- Comparaison de blocs par superposition de pentes %.
- Graphes secondaires (séries suivantes : fatigue / capacité de travail).

**Could**
- BPM moyen + durée saisis en fin de séance, graphe lié.
- Export / backup (cf. caveat éviction du stockage iOS).

**Won't (cette fois)**
- Partage de routines/séances entre potes.
- Temps de repos entre séries.
- Cible de progression auto-incrémentée / cran calculé.
- Mensurations, photos.
- Tracking de force max comme objectif (le but est l'hypertrophie).

## 6. Questions ouvertes / à trancher

- **Stratégie de sync** : last-write-wins ou journal append-only ? (conflits rares car un user = un appareil actif à la fois ; le modèle « déviation = événement » pousse vers l'append-only).
- **Durée de séance** : tranché → **auto-chronométrée** (du lancement de la séance à la clôture), aucune saisie manuelle. Le BPM moyen reste manuel et optionnel.
- Seuil « minimum de points par bloc » pour valider une comparaison de pentes à définir.
- Contenu initial du **catalogue d'exos de base** (quels exos pré-remplis) à lister.
