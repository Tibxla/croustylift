# Suppression d'une exécution en hard delete (pas de soft delete)

Depuis le journal, l'utilisateur peut supprimer une **exécution** entière (un jour de séance avec ses séries et ses notes datées). La suppression est un **hard delete** : une opération d'outbox `deleteExecution` enfile un unique `DELETE FROM executions WHERE id`, et la **cascade DB** (`performed_sets` et `dated_notes` sont en `on delete cascade`) efface les lignes filles. Pas de colonne `deleted_at`, pas de corbeille, pas d'annulation. L'action vit dans l'éditeur de séance passée (`PastSessionEditor`), derrière une confirmation in-app qui chiffre ce qui sera effacé (date, nombre de séries et d'exercices).

## Pourquoi

- **Cohérent avec la couche existante.** `deleteSet` et `deleteDatedNote` sont déjà des hard delete idempotents par id (ADR 0003). `deleteExecution` est le prolongement exact du même chemin d'écriture : outbox FIFO, idempotent par id, un seul mécanisme de sync.
- **Rien à invalider côté analyse.** Aucun dérivé n'est matérialisé (pas de table de records, pas de cache e1RM ou de blocs). Référence, e1RM, PR et blocs se recalculent à la lecture, donc la cascade DB + un rechargement du journal suffisent à faire reculer la référence et nettoyer les courbes.
- **Risque de résurrection déjà acté négligeable.** Le cas « même ligne éditée sur deux appareils offline » est documenté comme quasi impossible en solo (ADR 0003) : un seul utilisateur par compte. On supprime de surcroît une exécution passée, déjà entièrement synchronisée.

## Alternatives écartées

- **Soft delete (`deleted_at`)** : imposerait un filtre `deleted_at is null` sur tous les chemins de lecture (référence, raw-log, e1rm, PR, blocs). Surface d'oubli large pour gagner une annulation dont le besoin n'est pas établi. À reconsidérer le jour où une corbeille devient un vrai besoin produit.
- **Vider l'exécution série par série** via l'éditeur existant : laisse une coquille d'exécution sans série, qui pollue le journal et fausse les compteurs. Supprimer l'entrée doit retirer l'exécution elle-même.
- **Purger activement la file d'outbox de cette exécution avant le delete** : micro-optimisation bancale (`deleteSet` ne porte que l'id de la série, pas l'`executionId`). Le FIFO joue les ops en attente puis le delete cascade tout : état final correct, à coût marginal.

## Conséquences

- Suppression **irréversible**, atténuée par une confirmation qui nomme la conséquence concrète.
- Nouvelle op d'outbox `deleteExecution` (idempotente par id) et sa fonction de sync (`DELETE` par id, RLS scopé).
- La **cascade DB** est le seul mécanisme de nettoyage des séries et notes datées : à préserver si l'on touche aux clés étrangères `performed_sets.execution_id` / `dated_notes.execution_id`.
- Après suppression, le journal et l'analyse se rechargent (même voie que `onSaved` après une correction).
