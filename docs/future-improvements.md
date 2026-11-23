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
  Polices restreintes au sous-ensemble latin de Geist et Geist Mono (59 ko précachés).
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

- **Exo au poids du corps : le poids du corps n'est pas demandé** (ADR 0013, amendement
  du 2026-11-23). Saisi à 0 kg, l'exo se juge aux reps effectives. Lesté, son e1RM ne
  porte que sur le lest (5 kg × 8 puis 10 kg × 8 se lit « +100 % »), et ses séances
  restées à 0 kg sortent des courbes en kilos, comptées sous le graphe. Une seule série
  chargée fait basculer tout l'exo en kilos ; la corriger dans le journal le ramène en
  reps. Seule la saisie du poids du corps lèverait ces limites.

- **Pente de la carte : le bloc en cours, pour toute la routine** (ADR 0016, amendement
  du 2026-11-23). La pente du badge ne couvre plus que le bloc en cours, période écrite
  sous le graphe. Une retouche de n'importe quelle séance de la routine courante ouvre
  un bloc pour toutes (ADR 0001) : chaque carte reste sans pente le temps de refaire
  trois séances, et le dit. Une période propre à chaque séance l'éviterait, au prix
  d'une seconde définition du bloc.

## Résiduels connus du lot 3 (2026-11-23)

Le lot 3 s'est arrêté après une relecture, un tour de corrections et une vérification
(règle d'arrêt des relectures). Ce que la vérification et l'intégration ont laissé
ouvert est listé ici. Tous ces cas sont rares : stockage de l'appareil plein, deux
onglets ou deux appareils, réseau lent, file enfilée par une version antérieure.
Gravité : importante (une donnée peut être perdue ou fausse), mineure (gêne, sans
perte), finition.

### File d'écritures et stockage plein

- **Écriture ancienne envoyée après une correction déjà partie** (finition). Stockage
  plein, deux onglets : une écriture tenue en mémoire par l'un est désormais replacée
  dans la file à son instant d'enfilement, donc avant une correction de la même ligne
  encore en file. Si l'autre onglet a DÉJÀ envoyé sa correction, l'ancienne part après
  et gagne en base : c'est le last-write-wins de l'ADR 0003, accepté. Piste, si le cas
  se présente : dater les écritures d'une même ligne côté base.
- **Un envoi par écriture** (finition). Le flush fait une requête par écriture. Mesuré
  à environ 40 ms l'une : laissé tel quel, le regroupement compliquerait la
  quarantaine, qui se décide par écriture.

### Comptes

- **Invité hors ligne après un stockage plein** (finition). L'obligation de définir son
  mot de passe est tenue par le serveur et relue sur la session (ADR 0019). Sans
  session (démarrage en session locale), seule la copie de l'appareil la porte : si le
  stockage était plein à l'arrivée, l'invité entre hors ligne, jusqu'à la première
  session validée, qui le renvoie à l'écran de mot de passe. À faire avant de s'y
  fier : une invitation réelle de bout en bout (le mécanisme est vérifié dans la source
  du serveur d'auth et par tests, pas sur le projet).

### Base et import

- **Réordonnancement des séances : fonction prête, éteinte.** `reorder_seances`
  (migration 0023) est écrite et son appel aussi, derrière `REORDER_SEANCES_RPC`,
  laissé à faux tant que la migration n'est pas appliquée. D'ici là, un `UPDATE` par
  séance, sans transaction.

### Messages, tests, build

- **Aucun test de composant.** Le projet n'a pas de bibliothèque de rendu DOM. La
  logique des écrans est extraite en fonctions pures testées (`surface-switch.ts`,
  `seance-dirty.ts`, `pwa/reload-guards.ts`) ; le câblage des composants (garde de
  sortie, blocages de rechargement, brouillons) n'est vérifié qu'en navigateur.
- **Exports sans consommateur hors tests** (finition) : `loadDatedNote`
  (`notes/data.ts`), `listRefused` (`capture/outbox.ts`) et `initialState`
  (`capture/state.ts`). `upperA` (`capture/fixtures.ts`) est le jeu d'essai des tests,
  gardé tel quel. Les autres exports sans appelant extérieur servent dans leur propre
  fichier : ce sont des `export` posés pour les tests, pas du code mort.
