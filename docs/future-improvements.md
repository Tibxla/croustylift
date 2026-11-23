# Améliorations futures

Ce fichier garde la trace de ce que les audits (2026-06-19, 2026-11-22) ont fait
livrer et des décisions actées : des limites connues, acceptées en connaissance de
cause. Ce n'est pas une liste de tâches.

Aucune dette cachée : tout défaut connu que le lot 3 a laissé ouvert est inscrit plus
bas, dans « Résiduels connus du lot 3 », avec sa gravité et une piste. Ce qui n'y
figure pas n'est pas connu.

## Fait (pour mémoire)

- ✅ **3 bugs reproduits** : compteur unilatéral (équivalent-séries), métriques durée/BPM
  rechargées après suppression, séance clôturée non réhydratée (garde `duration_min` +
  backfill `closed_at` migration 0010 appliqué en prod).
- ✅ **Résilience** : error boundary de rendu (racine + par surface), crash hooks
  `LoginScreen` (hooks avant return conditionnel).
- ✅ **Perf** : lazy-load de l'Analyse et vendors en chunks séparés (`react`, `supabase`
  au lancement ; `recharts` avec l'Analyse seulement). Leur hash ne change pas d'un
  déploiement à l'autre : seul le code de l'app est retéléchargé. Chaque chunk a un
  budget gzip, vérifié en CI (`scripts/bundle-size.mjs`, qui fait foi pour les chiffres).
  Polices restreintes aux sous-ensembles latins.
- ✅ **Domaine** : gardes division par zéro (`meanY`) et fourchette inversée (`min>max`).
- ✅ **Sync/outbox** : reset orphelin compensé (`deleteExecution`), `handleSaveDatedNote`
  sur projection `stateRef` (M6), garde de tête outbox robuste via `_seq`, `mergeProgress`
  aligné par `(order, side)`.
- ✅ **Types** : `noUncheckedIndexedAccess` activé + 167 accès indexés durcis.
- ✅ **Hooks** : preset react-hooks v7 (React-Compiler). Vrais findings corrigés
  (`static-components`, `immutability`, `preserve-manual-memoization`) ;
  `set-state-in-effect` et `refs` en `warn` (patterns légitimes, projet sans Compiler).
- ✅ **Outillage** : ESLint (react-hooks rétabli), CI GitHub Actions (lint + tests +
  build, verte), scripts `lint`/`typecheck`, `engines`, `.nvmrc`, licence MIT.
- ✅ **PWA** : `viewport-fit=cover` + safe-area, favicon SVG, icône maskable plein-bord
  (PNG et SVG).
- ✅ **Mise à jour de l'app installée** : le service worker neuf s'active seul, la page
  ouverte choisit quand recharger (lancement ou changement d'onglet), jamais pendant une
  séance, une saisie ou une récupération de mot de passe ; reprise par un
  rechargement unique si un chunk est introuvable ; version du build affichée dans le
  bloc Compte (`src/pwa/`).
- ✅ **Barres du bas sur iPhone** : document non défilable quand le contenu tient,
  remesure forcée de la fenêtre après le clavier et au retour au premier plan, relevé de
  diagnostic par appui long sur la barre d'onglets (`src/viewport/`).
- ✅ **Sécurité et CI** : CSP `connect-src` limitée à l'hôte du projet Supabase ; workflow
  en lecture seule, actions épinglées par SHA, plafond de warnings ESLint, budget de
  taille ; contrastes des tokens mesurés par `npm run contrast`.
- ✅ **Couverture** : `reconstructExerciseExecutions` (rows→domaine) et `mergeRowWithOverride`
  (adaptateur d'override) extraites/testées.

## Décisions actées (ne pas re-flaguer en TODO)

- **Revalidation du cache de lecture hors-ligne (ADR 0012)** : la revalidation ne sait
  rejouer que les lectures déjà vues dans la session en cours (registre mémoire de
  `lib/read-cache`). La Référence n'en dépend PLUS, à ses deux bouts. Tant qu'une série
  attend, la dérivation fusionne les écritures de l'outbox (ADR 0014) : une séance
  capturée hors-ligne sert de repère dès la saisie. Dès qu'elle est acquittée, la copie
  d'historique de son exo est relue depuis le réseau, à la fin de tout flush, sans attendre
  la relance (`refreshExerciseRows`, ADR 0020). Les lectures d'une même clé pouvant se
  croiser, la copie ne s'écrit que sous gardes d'ordre : dernière réponse écrite, seuil
  posé par la relecture d'après acquittement, purge et compte. Une copie en retard d'une
  série écrite ailleurs est rattrapée par sa revalidation de fond, et la Capture montée
  suit ce changement sans remontage (ADR 0020, amendement du 2026-11-23). Reste : hors
  ligne, rien ne revalide, la copie garde son retard jusqu'au retour du réseau.

- **Protection « mots de passe compromis » (advisor `auth_leaked_password_protection`)** :
  fonctionnalité **Supabase Pro (payante)**, hors de portée du free tier. Laissée
  désactivée en connaissance de cause ; mitigation gratuite en place : `MIN_PASSWORD_LENGTH`
  relevé à 10. À ne reconsidérer que si le projet passe au plan Pro.

- **Import JSON et noms uniques (migration 0013)** : l'import upserte par `id`. Restaurer
  sa propre sauvegarde ne heurte rien (mêmes ids), mais importer dans un compte qui porte
  déjà une routine du même nom sous un autre id lève une violation d'unicité (23505),
  remontée brute par l'import, qui n'écrit alors rien (transaction unique, migration
  0024). Cas marginal ; piste si ça arrive : traduire l'erreur dans `ImportButton` et
  proposer de renommer.

- **Séance retouchée en plein entraînement** : une exécution garde la version de séance
  sous laquelle elle est née (`upsertExecution` est une insertion seule, sa réaffirmation
  ne réécrit ni version, ni date, ni lancement). La Capture remontée recharge le template
  de cette version-là (`adoptedVersionId`), et l'appareil qui tient la séance relit son
  exécution par son id. Sans état local (autre appareil, stockage vidé), l'exécution
  ouverte du jour se retrouve par séance, toutes versions confondues. Reste, sans effet
  démontré : un lancement réancré hors ligne sur une exécution déjà en base n'atteint plus
  `started_at` (le réancrage ne vise qu'une exécution pas encore née, ADR 0011).

- **Séance close ou supprimée dont l'écriture attend encore** : `loadTodayExecution`
  n'adopte pas une exécution que l'outbox clôt ou supprime (`isExecutionRetiredInQueue`),
  sinon une séance rangée sur un réseau qui flanche était reprise à la réouverture. Une
  clôture ou une suppression sortie de la file relève les lignes qu'elle a touchées : zéro
  ligne veut dire que l'exécution n'existe pas en base, donc qu'il n'y a rien à reprendre
  (ADR 0021, amendement du 2026-11-23).

## Résiduels connus du lot 3 (2026-11-23)

Le lot 3 s'est arrêté après une relecture, un tour de corrections et une vérification
(règle d'arrêt des relectures). Ce que la vérification et l'intégration ont laissé
ouvert est listé ici. Tous ces cas sont rares : stockage de l'appareil plein, deux
onglets ou deux appareils, réseau lent, file enfilée par une version antérieure.
Gravité : importante (une donnée peut être perdue ou fausse), mineure (gêne, sans
perte), finition.

### Notes datées

- **Rejeu d'une ancienne file : effacement acquitté sans effet** (importante). Une file
  enfilée avant l'identité par couple peut contenir l'écriture d'une note sous son id
  déterministe, puis son effacement, qui ne porte que cet id. Si la note du couple vit
  en base sous un id historique, l'écriture vise la bonne ligne mais l'effacement en
  vise une autre, touche zéro ligne et sort de la file : la note saisie puis effacée
  reste. Piste : avant le premier envoi, compléter les effacements hérités à partir des
  écritures en file du même compte et du même id (`capture/sync.ts`, `notes/data.ts`).
- **Réponse tardive qui réaffiche une note effacée** (mineure). Si un autre onglet
  acquitte l'effacement pendant que la réponse de la base, qui porte encore la note,
  est en route, la Capture l'adopte de nouveau. Piste : passer au rapprochement les
  écritures de notes relevées avant et après la lecture, comme pour les séries
  (`reconcileDatedNotes`).
- **Note adoptée visible à la réouverture seulement** (finition). Une note adoptée par
  une réponse tardive pendant que le panneau de l'exo est ouvert n'apparaît dans le
  champ qu'à sa réouverture. Sans perte : une saisie faite entre-temps est écrite sur la
  ligne du couple. Piste : resemer le champ tant qu'il n'a pas été touché
  (`useAutosavedNote`).

### File d'écritures et stockage plein

- **Mise à jour retenue après le retour du stockage** (mineure). Stockage plein puis
  place libérée : « Mettre à jour » ne retente aucune écriture de la file, la mise à
  jour reste retenue jusqu'au prochain enfilement ou acquittement. Piste : retenter la
  persistance à la demande de mise à jour, puis réévaluer (`pwa/reload-guards.ts`).
- **Ordre des écritures sous repli mémoire** (mineure). La file relue place les
  écritures persistées avant celles tenues en mémoire. Deux onglets, stockage plein :
  une ancienne note d'instructions gardée en mémoire par l'un peut partir après la
  correction persistée par l'autre, et l'écraser. Piste : garder l'ordre des écritures
  d'une même ligne entre onglets, ou les dater (`outbox.ts`).
- **Adoption tardive sous stockage plein** (mineure). L'adoption de l'exécution du jour
  juge le tableau « intact » sur sa copie enregistrée. Si le stockage a refusé
  l'ouverture d'un exo ou un ajout, la copie paraît intacte et l'adoption remonte le
  tableau, brouillon ou exo ajouté perdus. Piste : décider sur l'état courant du
  tableau, pas sur sa copie (`CaptureScreen.tsx`).
- **Éviction d'un exo ajouté à la séance en cours** (mineure). L'éviction des copies
  protège les exos des templates, pas un exo ajouté ou remplacé dans la séance en
  cours : ses copies évincées, la réouverture hors ligne l'ignore. Piste : protéger
  aussi les exos des dispositions reprenables (`cache-eviction.ts`).
- **Un envoi par écriture** (finition). Le flush fait une requête par écriture. Mesuré
  à environ 40 ms l'une : laissé tel quel, le regroupement compliquerait la
  quarantaine, qui se décide par écriture.

### Capture, reprise

- **Insertion en file absente du calcul de rang** (mineure). Une série ajoutée depuis
  le Journal à une exécution ouverte, encore en file à la reprise, n'entre pas dans le
  réalisé de la Capture : la série suivante peut reprendre son rang. Piste : appliquer
  à la réponse les insertions en file de l'exécution avant de calculer le rang
  (`capture/data.ts`).
- **Brouillon unilatéral réamorcé** (mineure). Une réponse tardive qui ajoute le côté
  manquant fait basculer le sélecteur de côté, et le brouillon en cours (poids, reps,
  RIR) est réinitialisé. Piste : tenir le côté choisi pour une partie du brouillon
  touché (`ExerciseCapture.tsx`).

### Comptes

- **Invité hors ligne après un stockage plein** (finition). L'obligation de définir son
  mot de passe est tenue par le serveur et relue sur la session (ADR 0019). Sans
  session (démarrage en session locale), seule la copie de l'appareil la porte : si le
  stockage était plein à l'arrivée, l'invité entre hors ligne, jusqu'à la première
  session validée, qui le renvoie à l'écran de mot de passe. À faire avant de s'y
  fier : une invitation réelle de bout en bout (le mécanisme est vérifié dans la source
  du serveur d'auth et par tests, pas sur le projet).

### Base et import

- **Import et archivage : verrous pris en ordre inverse** (mineure). `import_user_data`
  prend le verrou du compte avant les verrous de ligne, le trigger d'archivage de la
  migration 0021 fait l'inverse. Les deux gestes lancés au même instant peuvent
  s'interbloquer ; Postgres le détecte et annule l'un des deux (`40P01`), qui se
  relance. Déduit de la lecture, aucune course jouée au banc. Piste : une fonction
  d'archivage qui prend le verrou du compte d'abord, et la course à deux sessions dans
  `supabase/tests/banc/lancer.sh`.
- **Sauvegarde dont une routine archivée a été réactivée depuis** : refusée en entier
  (mineure). L'état final laisserait pour courante une routine archivée. Le message de
  la base dit quoi faire : définir une autre routine courante, puis réimporter
  (`docs/export-format.md`).
- **Réordonnancement des séances : fonction prête, éteinte.** `reorder_seances`
  (migration 0023) est écrite et son appel aussi, derrière `REORDER_SEANCES_RPC`,
  laissé à faux tant que la migration n'est pas appliquée. D'ici là, un `UPDATE` par
  séance, sans transaction.

### Réseau

- **Lecture qui pend : jusqu'à environ 87 s avant l'échec** (mineure). Le délai d'une
  requête est de 20 s, mais `postgrest-js` rejoue de lui-même une lecture échouée, trois
  fois, avec 1 s, 2 s puis 4 s d'attente. Les écritures ne sont pas rejouées. Piste :
  `.retry(false)` sur les lectures du chemin d'ouverture, ou un délai plus court pour
  elles.

### Messages, tests, build

- **Aucun test de composant.** Le projet n'a pas de bibliothèque de rendu DOM. La
  logique des écrans est extraite en fonctions pures testées (`surface-switch.ts`,
  `seance-dirty.ts`, `pwa/reload-guards.ts`) ; le câblage des composants (garde de
  sortie, blocages de rechargement, brouillons) n'est vérifié qu'en navigateur.
- **Deux warnings `react-hooks/refs` dans `CaptureScreen.tsx`** (finition) : une ref lue
  à l'initialisation du réducteur, une autre écrite au rendu. Le plafond de warnings
  (14) les fige.
- **Inter toujours embarquée** (finition) : seconde de pile, environ 133 ko de polices
  en précache. À caler sur les polices de la refonte visuelle.
- **Exports sans consommateur** (finition) : `summarizeBlocks`, `describeNoteKind`,
  `loadDatedNote`, `initialState`, `upperA`, et les autres exports sans appelant, pas
  relus.
