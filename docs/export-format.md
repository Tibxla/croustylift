# Format de l'export JSON (backup utilisateur)

Le bouton « Exporter mes données » (surface Séances, section Données) télécharge un backup JSON de tout le compte. Il sert l'auditabilité et de filet contre l'éviction du stockage local iOS. L'import est un suivi séparé ; ce format est pensé pour le rendre simple.

Code : `src/features/export/` (`export.ts` = coeur testé, `data.ts` = client + téléchargement, `ExportButton.tsx` = UI). Nom du fichier : `croustylift-backup-AAAA-MM-JJ.json`.

## Structure (version 1)

```jsonc
{
  "version": 1,                                // version du FORMAT, pas des données
  "exportedAt": "2026-06-18T10:00:00.000Z",    // ISO 8601 UTC, instant de l'export
  "data": {                                    // une clé par table, lignes BRUTES
    "exercises":           [ /* exos PERSO uniquement (owner_id non null) */ ],
    "exercise_notes":      [ /* notes d'instructions */ ],
    "exercise_overrides":  [ /* overrides perso des exos de base (user_id) */ ],
    "routines":            [ ... ],
    "routine_activations": [ /* historique de la routine courante */ ],
    "seances":             [ ... ],
    "seance_versions":     [ ... ],
    "prescriptions":       [ ... ],
    "executions":          [ ... ],
    "performed_sets":      [ /* séries loggées — colonnes : weight_kg, reps, side (unilatéral) */ ],
    "dated_notes":         [ /* notes datées */ ]
  }
}
```

Les listes de `data` sont ordonnées des **parents vers les enfants** (`exercises` avant `prescriptions`, `executions` avant `performed_sets`...) : un import peut les rejouer dans cet ordre sans violer de clé étrangère.

## Conventions

- **Lignes brutes** : chaque ligne est la forme exacte de la table Supabase (snake_case, `id` UUID, `created_at`/`updated_at` inclus). Un import futur réinsère telles quelles.
- **Scope RLS** : la collecte fait un `select *` par table sans filtre `owner_id` explicite ; les RLS côté serveur ne renvoient déjà que les données de l'utilisateur connecté (cf. `docs/adr/0003`).
- **Exos de base exclus** : `exercises` ne contient que les **exos perso** (`owner_id` non null). Le catalogue commun (exos de base, `owner_id` null) est partagé en lecture seule entre tous les utilisateurs (cf. `CONTEXT.md`) ; il n'est pas « les données de l'utilisateur » et sera déjà présent chez qui réimporte.
- **`exercise_overrides`** : overrides perso des exos de base (champ `user_id`, pas `owner_id`). Exportés tels quels, comme toutes les tables scopées par RLS.
- **Colonnes auto-incluses** : les colonnes ajoutées à des tables existantes sont exportées sans modification du format (lignes brutes). Actuellement incluses : `exercises.unilateral`, `exercises.primary_muscles`, `performed_sets.side` (côté unilatéral).

## Évolution

Le champ `version` permet à un import de reconnaître le format. Tout changement de structure (table ajoutée, forme de ligne modifiée) incrémente `EXPORT_FORMAT_VERSION` dans `src/features/export/export.ts`.
