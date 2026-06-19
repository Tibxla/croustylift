# Clôture de séance : repart vierge, garanti par un `closed_at` en base

Clôturer une séance pose les métriques de fin (durée chronométrée, BPM moyen optionnel) sur l'exécution et affiche le récap dans la foulée, puis **nettoie l'état de capture local**. Au retour en Capture (changement d'onglet, reload, réouverture le même jour), on repart sur une **capture vierge** (ou le choix de séance) : on ne restaure aucun état « séance terminée », et la séance rangée n'est pas non plus ramenée par le filet Supabase. L'état de capture d'une séance **en cours** (non clôturée) reste, lui, restauré. Le récap d'une séance passée se consulte dans le journal.

Pour que ce « repart vierge » soit FIABLE — et pas seulement tributaire du nettoyage du cache local (fragile : cache survivant, quota, frontière minuit) ni contredit par la réhydratation Supabase — la clôture **matérialise un `closed_at` en base** sur l'exécution (via l'op outbox `updateExecution`, migration 0009). La réhydratation au montage (`loadTodayExecution`) **exclut les exécutions clôturées** (`closed_at is null`) : une séance rangée n'est plus réhydratée, et un nouveau log ouvre une **exécution neuve** au lieu de se rattacher à la close.

## Pourquoi

- **Esprit du produit.** La Capture fait « un seul boulot, saisir vite » (PRODUCT.md) ; une fois rangée, la séance appartient au passé. Son récap vit déjà dans le journal (vue Analyse), il n'a pas à squatter l'écran de salle.
- **Supprime le piège par construction.** L'ancien comportement (réafficher « Séance terminée » au remontage) coinçait l'utilisateur sur un écran de fin et l'obligeait à « Nouvelle séance » pour repartir.
- **Le `closed_at` en base est nécessaire.** Sans lui, « repart vierge » était une illusion : le filet de réhydratation (Supabase fait foi au reload) ramenait la dernière exécution du jour — la clôturée — et un nouveau log y créait soit un doublon orphelin (id fantôme), soit s'y rattachait. Seul un marqueur durable côté base permet de l'exclure de façon fiable.

## Alternatives écartées

- **Persister l'état close et réafficher « Séance terminée » au remontage** (le comportement d'origine) : piège l'utilisateur sur l'écran de fin. Le récap est de toute façon dans le journal.
- **Clôture purement locale, sans `closed_at` en base** (première version de cet ADR) : le « repart vierge » n'était pas tenu dès qu'une exécution clôturée existait en base — elle était réhydratée au reload. Un marqueur en base est requis.
- **Reprendre l'exécution du jour après clôture** (la réhydrater telle quelle) : utile contre la clôture accidentelle, mais brouille la frontière entre séances et ré-ouvre une séance rangée. La correction d'une clôture accidentelle passe par l'éditeur de séance passée (journal).

## Conséquences

- `closedAt` (epoch ms) disparaît de l'état de capture *persisté* ; le geste de clôture appelle `clearPersisted` ET pose un `closed_at` (ISO) en base via `updateExecution`.
- Colonne `executions.closed_at timestamptz` (migration 0009, nullable = en cours) ; `loadTodayExecution` filtre `closed_at is null`.
- Le récap de fin n'est visible que dans la foulée immédiate de la clôture (état mémoire) et, ensuite, dans le journal.
- Après clôture, re-logger la même séance le même jour ouvre une **nouvelle exécution** (l'ancienne est exclue de la réhydratation) — plus de doublon orphelin sous un id fantôme.
- **À ne pas confondre** : on n'exclut que les exécutions *closes* ; l'état d'une séance *en cours* (non clôturée) reste réhydraté, indispensable à l'offline (ne pas perdre les séries loggées sur un reload).
