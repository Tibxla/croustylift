# Améliorations futures

Findings d'audit (2026-06-19) volontairement reportés, avec leur raison. Les bugs
reproduits et les findings high/medium ont été corrigés dans la même passe ; ce qui
suit est ce qui mérite un lot dédié ou une décision.

## Passes dédiées (gros blast radius)

- **`noUncheckedIndexedAccess` (tsconfig.app.json).** Typerait `arr[i]` / `map[k]`
  comme potentiellement `undefined` et forcerait des gardes — pertinent sur un domaine
  local-first plein d'accès indexés. Mais l'activer révèle plusieurs dizaines de sites
  à durcir : à faire en une passe isolée, pas mêlé à des correctifs fonctionnels.
- **Règles React-Compiler de `eslint-plugin-react-hooks` v7 (`recommended`).** On n'a
  branché que les deux règles historiques (`rules-of-hooks`, `exhaustive-deps`). Le
  preset complet ajoute `set-state-in-effect`, `refs`, `immutability`,
  `preserve-manual-memoization`… (~40 signalements). Plusieurs sont de vrais points
  d'attention (état dérivé en effet) ; à trier dans un lot dédié.
- **Split vendor du chunk principal.** Le lazy-load de l'Analyse a sorti recharts du
  chunk critique (Capture : 266 → 152 kB gzip). Le chunk principal reste ~565 kB
  (React + Supabase + fontsource). Un `build.rollupOptions.output.manualChunks`
  (vendor split) réduirait encore le premier chargement. Optionnel.

## Décisions / actions hors-code

- **Protection « mots de passe compromis » (Supabase Auth).** Désactivée (advisor
  `auth_leaked_password_protection`). Toggle dans le dashboard Supabase →
  Authentication → Policies (gratuit, aucun impact code). Optionnel : relever
  `MIN_PASSWORD_LENGTH` (8 → 10-12) dans `src/auth/LoginScreen.tsx`.
- **Champ `license` (package.json).** Repo public sans licence = « tous droits
  réservés » par défaut. Décision du mainteneur (MIT recommandé si partage assumé)
  → ajouter `"license"` + fichier `LICENSE`.
- **Migration `0010_backfill_closed_at`.** Écrite (`supabase/migrations/`), pas encore
  appliquée en prod (hygiène de données ; le filtre `loadTodayExecution` couvre déjà
  le symptôme côté code). À pousser via `supabase db push` ou le dashboard.

## Petites dettes (low, non urgentes)

- `handleSaveDatedNote` (CaptureScreen) ne lit pas la projection `stateRef` comme
  `handleLog` (fix M6) → double note datée possible sur deux saves très rapprochés.
  Pas de corruption (la plus récente gagne). Aligner sur `handleLog` si on retouche.
- Garde-fou de shift de l'outbox (`outbox.ts`) identifie la tête par `(type, id)`,
  non unique pour `upsertExerciseNote`/`updateExecution` ré-enfilés. Fenêtre étroite
  (mutation concurrente). Rendre l'identité robuste (référence d'objet / jeton).
- `mergeProgress` (state.ts) aligne les `setId` par index : sur un unilatéral au cache
  pré-id ET loggé à l'envers (droite d'abord), peut apparier les côtés croisés.
  Aligner par `(order, side)`.
- Couverture de test : transformation rows Supabase → domaine (`capture/data.ts`,
  `loadExerciseExecutions` : `toSide`, regroupement, garde orpheline) et mapping
  `mergeRowWithOverride` (`exercises/overrides.ts`) testés seulement indirectement.
