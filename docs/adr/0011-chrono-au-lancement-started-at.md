# Chrono au lancement explicite, `started_at` en base

Une séance se **démarre** par un geste explicite — un écran de lancement présent **même quand la routine courante n'a qu'une seule séance** (plus de séance « déjà mise » sans l'avoir choisie). Ce geste **lance le chrono** : `started_at` (epoch ms en mémoire, `timestamptz` en base) vaut **l'instant du lancement**, jamais celui du premier set.

La durée chronométrée (récap de clôture, ADR 0009) est **lancement → clôture**.

L'exécution n'étant créée en base **qu'au premier set** (règle anti-orpheline : « une exécution n'existe que par ses séries »), `started_at` est **mémorisé au lancement** (état + localStorage) puis **recopié tel quel** dans la ligne `executions` quand elle naît, via l'`upsertExecution` déjà enfilé.

Un lancement **expire au bout d'1 h sans aucun set** : à la réouverture on repropose l'écran de lancement ; si un premier set arrive tout de même plus d'1 h après le lancement, `started_at` est **réancré sur ce set** (le lancement périmé est jeté). Reprendre une séance **en cours** (sets déjà loggés, non clôturée) ne repasse pas par le lancement et conserve le `started_at` d'origine.

## Pourquoi

- **Un vrai moment de départ.** Sans geste de lancement, le chrono démarrait au montage de l'écran (ouverture de l'onglet) : la durée intégrait le temps de choisir la séance, se changer, s'échauffer — gonflée. Pire, avec une seule séance l'app la chargeait direct, sans aucun « départ » perceptible.
- **`started_at` durable en base.** Symétrique de `closed_at` (ADR 0009). Sans colonne, la valeur ne vivait qu'en localStorage (fragile : cache vidé, quota, multi-appareil) et `hydratedState` la réinitialisait à `Date.now()` au remontage — la durée pouvait sauter. Une colonne ferme le bug pour de bon.
- **Anti-orpheline préservée.** Écrire `started_at` au premier set (et non créer la ligne au lancement) garde l'invariant « pas d'exécution sans série » : démarrer puis ne rien logger ne laisse aucune trace en base.
- **Garde-fou d'1 h.** Un lancement oublié (téléphone rangé, séance annulée) produirait une durée absurde de plusieurs heures. L'expiration borne le chrono à un départ réel.

## Alternatives écartées

- **Chrono au montage de l'écran** (comportement d'origine) : durée gonflée, pas de départ perceptible, reset au remontage sans cache.
- **Chrono au premier set** : ne répond pas au besoin (« je veux *lancer* ma séance, et ça lance le chrono ») et laisse l'écran de lancement sans effet sur la mesure.
- **Créer l'exécution au lancement** (pour écrire `started_at` tout de suite) : fabrique une exécution orpheline si on démarre sans rien logger — exactement ce que l'anti-orpheline (ADR 0009) évite.
- **`started_at` en localStorage seul** : non durable (cache vidé, multi-appareil), perpétue le risque de reset.

## Conséquences

- Colonne `executions.started_at timestamptz` (migration 0011, nullable = inconnu/legacy), additive. Aucun backfill : les exécutions anciennes gardent `started_at` null et leur `duration_min` déjà figé.
- L'op outbox `upsertExecution` porte `startedAt` ; `loadTodayExecution` lit `started_at` pour réhydrater le chrono d'une séance en cours.
- L'écran de lancement (`SeancePicker`) devient le passage **obligé**, y compris pour une routine à une seule séance ; il ne s'affiche pas pour reprendre une séance en cours.
- L'état de capture porte un `startedAt` posé au lancement, persisté ; l'expiration (> 1 h sans set) le réancre au premier set ou repropose le lancement.
- `elapsedMinutesSince` reste la source de la durée (lancement → clôture), inchangée dans son calcul.
