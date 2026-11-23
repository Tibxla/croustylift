# Format de l'export JSON (backup utilisateur)

Le bouton « Exporter mes données » (surface Séances, section Données) télécharge un backup JSON de tout le compte. Il sert l'auditabilité et de filet contre l'éviction du stockage local iOS. Le bouton « Importer mes données » le restaure dans le compte.

Code : `src/features/export/` (`export.ts` et `import.ts` = coeurs testés, `data.ts` et `data-import.ts` = client, téléchargement et lecture du fichier, `ExportButton.tsx` et `ImportButton.tsx` = UI). Nom du fichier : `croustylift-backup-AAAA-MM-JJ.json`.

## Structure (version 2)

```jsonc
{
  "version": 2,                                // version du FORMAT, pas des données
  "exportedAt": "2026-06-18T10:00:00.000Z",    // ISO 8601 UTC, instant de l'export
  "data": {                                    // une clé par table, lignes BRUTES
    "exercises":           [ /* exos PERSO uniquement (owner_id non null) */ ],
    "exercise_notes":      [ /* notes d'instructions */ ],
    "exercise_overrides":  [ /* overrides perso des exos de base (user_id) */ ],
    "routines":            [ ... ],
    "routine_activations": [ /* historique de la routine courante */ ],
    "seances":             [ /* colonne archived_at : null = active */ ],
    "seance_archive_events": [ /* journal daté des archivages de séance (v2, ADR 0017) */ ],
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

- **Lignes brutes** : chaque ligne est la forme exacte de la table Supabase (snake_case, `id` UUID, `created_at`/`updated_at` inclus). L'import les réinsère telles quelles.
- **Scope RLS** : la collecte fait un `select *` par table sans filtre `owner_id` explicite ; les RLS côté serveur ne renvoient déjà que les données de l'utilisateur connecté (cf. `docs/adr/0003`).
- **Exos de base exclus** : `exercises` ne contient que les **exos perso** (`owner_id` non null). Le catalogue commun (exos de base, `owner_id` null) est partagé en lecture seule entre tous les utilisateurs (cf. `GLOSSARY.md`) ; il n'est pas « les données de l'utilisateur » et sera déjà présent chez qui réimporte.
- **Import garanti sur l'instance d'origine seulement** (limite assumée, audit 2026-06-19) : comme les exos de base sont exclus, les lignes qui les RÉFÉRENCENT (`exercise_notes`, `exercise_overrides`, `prescriptions`, `performed_sets`, `dated_notes`) ne portent que leur **UUID**. L'import suppose donc le même catalogue de base aux mêmes UUID — vrai sur le **même projet Supabase** (le cas visé : filet anti-éviction du stockage local iOS), mais PAS sur une autre instance (les UUID de base y sont régénérés au seed, `gen_random_uuid()`) où ces FK lèveraient une `23503`. Un vrai portage cross-instance demanderait de re-résoudre les exos de base par **nom** à l'import — hors périmètre du filet de sauvegarde.
- **`exercise_overrides`** : overrides perso des exos de base (champ `user_id`, pas `owner_id`). Exportés tels quels, comme toutes les tables scopées par RLS.
- **Colonnes auto-incluses** : les colonnes ajoutées à des tables existantes sont exportées sans modification du format (lignes brutes). Actuellement incluses : `exercises.unilateral`, `exercises.primary_muscles`, `performed_sets.side` (côté unilatéral), `routines.archived_at`, `seances.archived_at`.

## Cohérence de la sauvegarde

L'export n'est pas un instantané : chaque table est lue à part, page par page (ADR 0022). Une ligne dont le parent manque à la lecture est écartée (`withoutRowsNewerThanTheirParent`) : une série dont l'exécution a été écrite pendant l'export, ou une note liée à un exo perso supprimé entre deux lectures. Les liens `exercise_id` sont vérifiés contre tout le catalogue lu, exos de base compris. Le fichier produit se restaure donc toujours.

## Import

L'import envoie le champ `data` en un seul appel à la fonction de base `import_user_data` (migration 0024), qui écrit les douze tables dans une transaction, parents avant enfants. Une erreur sur une ligne annule tout : le compte reste comme avant.

- **Sous la RLS de l'appelant** : les lignes ne tombent que dans le compte connecté. Le fichier d'un autre compte est refusé.
- **Upsert par `id`** : réimporter le même fichier ne crée aucun doublon, la ligne en base est remplacée par celle du fichier.
- **Notes datées** : la note du fichier remplace celle que la base porterait, sous un autre id, pour le même exercice dans la même exécution.
- **Journal des archivages** : inséré sans réécriture (un événement déjà en base reste tel quel, migration 0022). Pendant l'import, le trigger d'archivage n'écrit rien : l'état `archived_at` et le journal viennent tous deux du fichier. En fin d'import, chaque séance du fichier est rapprochée : si le dernier événement du journal fusionné contredit son état (la base a connu un archivage ou un désarchivage après la sauvegarde), un événement correctif daté de la restauration est ajouté, pour que l'Analyse et le plan disent la même chose. Un événement du fichier daté dans le futur est ramené à l'instant de l'import.
- **Routine courante** : c'est l'état final du fichier qui est jugé. La base refuse qu'une routine archivée soit la routine courante (migration 0021) ; l'import écrit donc les routines, puis leurs activations, et n'applique qu'ensuite les archivages nouveaux. Une sauvegarde « A archivée, B courante » se restaure ainsi sur un compte où A est redevenue courante entre-temps (B supprimée). La routine courante du compte ne s'archive pas, même par un import : une sauvegarde où une routine est archivée, restaurée sur un compte où cette routine a été activée APRÈS la date de la sauvegarde, se restaure en entier sauf cet archivage. L'import ne retire aucune activation, celle du compte reste donc la plus récente, et la routine reste courante et active. Pour l'archiver ensuite : définir une autre routine comme courante, puis l'archiver ou réimporter. Seul un fichier invalide par lui-même reste refusé en entier (il crée une routine déjà archivée et en fait la courante).
- **Sauvegarde plus ancienne que le schéma** : une colonne absente du fichier prend sa valeur par défaut. `prepareForRestore` complète ce que la base exige désormais : `unilateral` à false, muscles principaux repris de `muscle_group`, une seule note datée par exercice et par exécution (la plus récente).

## Évolution

Le champ `version` permet à un import de reconnaître le format. Tout changement de structure (table ajoutée, forme de ligne modifiée) incrémente `EXPORT_FORMAT_VERSION` dans `src/features/export/export.ts`.

- **v2 (2026-09-13)** : table `seance_archive_events` et colonne `archived_at` sur `routines` et `seances` (ADR 0017). L'import lit toujours une sauvegarde **v1** : elle précède l'archivage, son journal est lu vide.
