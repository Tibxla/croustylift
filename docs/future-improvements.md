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
  au lancement ; l'Analyse et les écrans de second rang à la demande). Leur hash ne change pas d'un
  déploiement à l'autre : seul le code de l'app est retéléchargé. Chaque chunk a un
  budget gzip, vérifié en CI (`scripts/bundle-size.mjs`, qui fait foi pour les chiffres).
  Police restreinte au sous-ensemble latin d'Inter Variable (`src/fonts.css`).
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
  0024). Cas marginal ; piste si ça arrive : traduire l'erreur dans l'import (`export/data-import.ts`) et
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
  n'adopte pas une exécution qu'une écriture locale clôt ou supprime (`isExecutionRetired`),
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
  plein, deux onglets : une écriture tenue en mémoire par l'un garde son numéro
  d'enfilement, qui suit l'horloge, donc sa place avant une correction de la même ligne
  encore en attente (registre d'écritures, ADR 0025). Si l'autre onglet a DÉJÀ envoyé sa
  correction, l'ancienne part après et gagne en base, sur les colonnes qu'elle écrit :
  c'est le last-write-wins de l'ADR 0003, accepté. Piste, si le cas se présente : dater
  les écritures d'une même ligne côté base.
- **Appareil plein dès la première ouverture, ancienne file vide** (importante, rare, acceptée le 25/11 ; ADR 0025, « Limites connues »). Le verrou de l'ancienne file ne peut pas être posé : un onglet resté sur l'ancienne version peut envoyer lui-même ce qu'il enfile, avant une écriture plus ancienne du registre. La ligne de synchro dit « Stockage plein ». Disparaît avec la reprise de l'ancien format (après le 2026-12-31).
- **Envoi arrêté sous stockage plein** (mineure, sans perte). Un refus de la base que l'appareil ne peut pas écrire arrête la passe : plus rien ne part tant que la place n'est pas revenue, saisies indépendantes comprises (ADR 0025, « Passe arrêtée »). Pistes : un geste « Libérer de la place » dans Réglages (copies de lecture, séances en cours oubliées), et laisser partir les écritures qui ne dépendent pas de celle qui bloque.
- **Écriture héritée sans compte, attribuée trop tard** (mineure, rare ; ADR 0025, « Limites connues »). Le patch différé d'`adoptLegacyOps` est abandonné si l'écriture change de révision à son entrée au registre : elle reste sans compte jusqu'au démarrage suivant et part après des saisies plus récentes. Piste : attribuer le compte à l'admission, sous le verrou, à partir du compte relevé au démarrage. Disparaît avec la reprise de l'ancien format.
- **Arrêt de la passe commun aux comptes, et acquittement qui modifie** (mineure, stockage plein). L'arrêt ne regarde pas le compte ; un acquittement qui doit aussi modifier une écriture restante arrête la passe. Sans perte, visible. Piste : sonder par compte, et écrire les modifications avant de retirer.
- **Sources réduites après l'enregistrement** (mineure, stockage plein et app tuée entre deux écritures). Piste : réduire les sources avant d'écrire l'enregistrement.
- **Saisie tenue en mémoire, page fermée** (importante, rare). Stockage plein et hors ligne : une saisie que l'appareil a refusée ne tient qu'en mémoire. Le rechargement par l'app est refusé, mais fermer l'onglet la perd. Piste : IndexedDB en second support pour ces seules saisies.
- **Écriture acquittée non gardée sous stockage plein** (mineure). Elle cède la place au lieu de rester dix minutes : une réponse de la base partie avant son acquittement peut la faire manquer à l'écran jusqu'à la lecture suivante.
- **Deux onglets, chacun avec des saisies en mémoire** (mineure). Stockage plein : un onglet ne voit pas les saisies que l'autre tient en mémoire. Chacun envoie les siennes à sa passe ; l'ordre entre les deux suit les passes, pas les gestes.
- **Version inconnue du registre** (finition). Un onglet resté sur une version plus
  ancienne que celle qui a écrit le registre n'envoie plus rien et demande de recharger ;
  ce qu'on y saisit d'ici là ne tient qu'en mémoire. Piste, à la première montée de
  format : laisser à l'ancienne version une clé de dépôt que la nouvelle reprend.
- **Reprise de l'ancien format** (à retirer après le 2026-12-31). La conversion de la
  file et de la quarantaine d'avant le registre, et leur reprise en continu
  (`settleLegacy`, `fromLegacy`), ne servent qu'aux onglets restés sur l'ancienne version.
- **État de séance retenu en mémoire, réécrit par-dessus un autre onglet** (mineure,
  acceptée). Stockage plein, deux onglets : l'onglet A quitte la Capture avec son état
  refusé, retenu en mémoire. L'onglet B écrit ensuite une disposition plus récente de
  la même séance, ou la clôt. La place revenue, la prochaine demande de rechargement
  dans A réécrit son ancien état : la disposition de B est écrasée, ou la séance
  close redevient reprenable. Piste : retenir la version persistée au moment du refus
  et la comparer avant la nouvelle tentative ; en cas d'écriture concurrente,
  respecter la clôture et garder la plus récente (`retryPersistCaptureState`,
  `capture/state.ts`).
- **Un envoi par écriture** (finition). Le flush fait une requête par écriture. Mesuré
  à environ 40 ms l'une : laissé tel quel, le regroupement compliquerait le
  refus, qui se décide par écriture.

### Comptes

- **Invité hors ligne après un stockage plein** (finition). L'obligation de définir son
  mot de passe est tenue par le serveur et relue sur la session (ADR 0019). Sans
  session (démarrage en session locale), seule la copie de l'appareil la porte : si le
  stockage était plein à l'arrivée, l'invité entre hors ligne, jusqu'à la première
  session validée, qui le renvoie à l'écran de mot de passe. À faire avant de s'y
  fier : une invitation réelle de bout en bout (le mécanisme est vérifié dans la source
  du serveur d'auth et par tests, pas sur le projet).

### Messages, tests, build

- **Presque aucun test de composant.** Le projet n'a pas de bibliothèque de rendu DOM :
  seul `capture/SetBand.test.tsx` rend un composant, en HTML statique
  (`renderToStaticMarkup`). La logique des écrans est extraite en fonctions pures testées (`surface-switch.ts`,
  `seance-dirty.ts`, `pwa/reload-guards.ts`) ; le câblage des composants (garde de
  sortie, blocages de rechargement, brouillons) n'est vérifié qu'en navigateur.
- **Exports sans consommateur hors tests** : `initialState` (`capture/state.ts`) et
  `upperA` (`capture/fixtures.ts`) sont des auxiliaires des tests, gardés tels quels.
  Les autres exports sans appelant extérieur servent dans leur propre fichier : ce
  sont des `export` posés pour les tests, pas du code mort.

## Résiduels connus de la branche d'intégration (2026-11-24)

Trois constats de gravité moyenne de la dernière vérification, laissés ouverts. La
barre de livraison est tenue : aucun ne perd ni ne fausse une donnée en usage normal
(un seul appareil, réseau intermittent). Ils demandent deux onglets ouverts en même
temps, un import simultané, ou un mode de test inhabituel.

- **Deux onglets peuvent encore écraser une copie fraîche du Journal** (importante, à
  deux onglets seulement). Chaque lecture d'écran note la génération d'acquittement
  partagée (`lib/read-cache.ts`) à son départ et la revérifie juste avant d'écrire, sans
  rien d'asynchrone entre les deux. Mais rien ne verrouille ces deux gestes contre les
  autres onglets. Scénario : l'onglet A relève la génération et part lire le Journal ;
  l'onglet B acquitte un DELETE (génération changée), relit et écrit la copie fraîche ;
  si l'intercalage tombe entre la vérification et l'écriture de A, sa réponse d'avant le
  DELETE écrase la copie, et la séance supprimée revient au Journal, y compris hors
  ligne, jusqu'à la relecture suivante. Fenêtre de l'ordre de l'instruction, reproduite
  avec un stockage instrumenté. Piste : un verrou commun aux onglets
  (`navigator.locks`) autour du changement de génération, du marquage des copies, et du
  couple vérification puis écriture.
- **Deux onglets : vider la mémoire des exécutions acquittées peut emporter un
  acquittement de l'autre onglet** (importante, à deux onglets seulement). La ligne de
  « Quelle séance ? » garde les exécutions acquittées (`capture/seance-meta.ts`) jusqu'à
  une lecture de la méta acceptée. Scénario : l'onglet A mémorise une suppression
  acquittée (`sync.ts`, `ackedInMeta`) mais n'a pas encore changé la génération
  d'acquittement ; l'onglet B, dont la lecture est partie avant, relève la génération
  inchangée, écrit sa copie, puis vide la mémoire partagée ; A change ensuite la
  génération, trop tard. La date de l'exécution supprimée reparaît jusqu'à la
  relecture suivante. Changer la génération AVANT de mémoriser ne suffit pas seul.
  Piste : la même que pour le Journal, un verrou commun aux onglets
  (`navigator.locks`) autour du couple vérification puis écriture, et du vidage.
- **Un désarchivage peut s'interbloquer avec un import simultané** (mineure, sans
  perte). Le trigger `seances_en_fin` (migration 0026) prend le verrou de la routine
  alors que l'UPDATE du désarchivage tient déjà la ligne de la séance archivée. Un
  import complet (`import_user_data`, 0024) qui tient la routine par son UPSERT, puis
  attend cette même séance, ferme le cycle. Postgres détecte l'interblocage et annule
  l'une des deux transactions : le geste (désarchiver, ou restaurer la sauvegarde)
  échoue avec une erreur et est à relancer ; rien n'est écrit à moitié. Piste :
  prendre le verrou de la routine avant celui de la séance sur le chemin du
  désarchivage (une fonction `unarchive_seance` qui verrouille la routine, puis met à
  jour la séance), et couvrir le scénario au banc avec deux sessions.
- **`sync-vues.test.ts` échoue en `--no-isolate`** (finition, tests seulement). Sans
  isolation, les fichiers de test partagent le même registre de modules et le même
  état de module (copies, file, mocks) : `sync-vues.test.ts` échoue après
  `reference-fraicheur.test.ts`, et l'inverse échoue aussi en thread unique. Cause
  exacte non isolée. Les modes normal,
  `--pool=threads` et `--pool=threads` en thread unique passent (BroadcastChannel isolé
  par fichier, `src/test/broadcast-isolation.ts`). Piste, si ce mode devient utile :
  réinitialiser l'état des modules entre fichiers (`vi.resetModules` et mocks à
  restaurer), ou le refuser dans la configuration.

À contrôler au premier appel réel après l'application de 0027 : PostgREST doit rendre
un OBJET JSON pour `create_seance`, qui renvoie un composite sans SETOF, et non un
tableau à un élément. `createSeance` (`authoring/data.ts`) le suppose ; le test unitaire
simule un objet et le banc passe par psql. Une création depuis l'app, une fois 0027 en
base, le tranche : si c'était un tableau, l'éditeur s'ouvrirait sur une séance sans id.

Alléger index.js (84,7 ko gzip le 2026-11-25, budget relevé à 89 000 à la fusion du
registre d'écritures), d'abord en retirant la reprise de l'ancien format après le
2026-12-31 (cf. l'en-tête des clés `LEGACY_*` de `capture/outbox.ts`).
