# Améliorations futures

Ce fichier garde la trace de ce que les audits (2026-06-19, 2026-11-22) ont fait
livrer et des décisions actées : des limites connues, acceptées en connaissance de
cause. Ce n'est pas une liste de tâches.

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
  posé par la relecture d'après acquittement, purge et compte. Le retard résiduel ne
  concerne que les lectures qui n'ont pas de source locale équivalente. Piste si ça
  devenait gênant : réchauffer les copies des séances de la routine courante après un
  flush au boot.

- **Protection « mots de passe compromis » (advisor `auth_leaked_password_protection`)** :
  fonctionnalité **Supabase Pro (payante)**, hors de portée du free tier. Laissée
  désactivée en connaissance de cause ; mitigation gratuite en place : `MIN_PASSWORD_LENGTH`
  relevé à 10. À ne reconsidérer que si le projet passe au plan Pro.

- **Import JSON et noms uniques (migration 0013)** : l'import upserte par `id`. Restaurer
  sa propre sauvegarde ne heurte rien (mêmes ids), mais importer dans un compte qui porte
  déjà une routine du même nom sous un autre id lève une violation d'unicité (23505),
  remontée brute par l'import. Cas marginal (restauration croisée entre comptes) ; piste
  si ça arrive : traduire l'erreur dans `ImportButton` et proposer de renommer.

- **Import JSON et journal des archivages (migration 0014)** : restaurer une sauvegarde
  dont l'état `archived_at` d'une séance diffère de la base déclenche le trigger
  d'archivage (événement daté de la restauration) PUIS upserte les événements du
  fichier : un événement en double est possible, donc une coupure de bloc de plus à
  la date de l'import. Restaurer sa sauvegarde la plus récente ne le déclenche pas
  (même état). Piste si ça gêne : désactiver l'écriture d'événement quand l'upsert
  vient de l'import.

- **Séance retouchée en plein entraînement** : une exécution garde la version de séance
  sous laquelle elle est née (`upsertExecution` est une insertion seule, sa réaffirmation
  ne réécrit ni version, ni date, ni lancement). L'appareil qui tient
  la séance relit son exécution par son id (`loadTodayExecution`, id de l'état local),
  quelle que soit sa version. Conséquence assumée : un lancement réancré hors ligne sur
  une exécution déjà en base n'atteint plus `started_at`.

- **Séance close ou supprimée dont l'écriture attend encore** : `loadTodayExecution`
  n'adopte pas une exécution que l'outbox clôt ou supprime (`isExecutionRetiredInQueue`),
  sinon une séance rangée sur un réseau qui flanche était reprise à la réouverture.
