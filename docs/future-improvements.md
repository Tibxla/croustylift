# Améliorations futures

Findings d'audit (2026-06-19). Les bugs reproduits et les findings high/medium ont
été corrigés sur `fix/reported-bugs-and-audit` ; les gros chantiers reportés
(`noUncheckedIndexedAccess`, preset react-hooks v7, licence) ont été traités sur
`chore/hardening-types-hooks`. Ce qui suit est ce qui reste réellement ouvert.

## Fait (pour mémoire)

- ✅ `noUncheckedIndexedAccess` activé + 167 accès indexés durcis (gardes côté source,
  assertions côté tests).
- ✅ Preset react-hooks v7 (React-Compiler) activé. Vrais findings corrigés
  (`static-components`, `immutability`, `preserve-manual-memoization`).
  `set-state-in-effect` et `refs` laissés en `warn` : ils flaguent systématiquement
  des patterns légitimes (reset-à-loading des effets de chargement ; miroirs de ref
  intentionnels M6/init de la capture). Le projet n'utilise pas le React Compiler.
- ✅ Licence MIT. ✅ Backfill `closed_at` (migration 0010) appliqué en prod.

## Reste ouvert

- **Split vendor du chunk principal (optionnel).** Le lazy-load de l'Analyse a sorti
  recharts du chunk critique (Capture : 266 → 152 kB gzip). Le chunk principal reste
  ~565 kB (React + Supabase + fontsource). Un `build.rollupOptions.output.manualChunks`
  réduirait encore le premier chargement.
- **Protection « mots de passe compromis » (Supabase Auth).** Désactivée (advisor
  `auth_leaked_password_protection`). Toggle dans le dashboard Supabase →
  Authentication → Policies (gratuit, aucun impact code). Optionnel : relever
  `MIN_PASSWORD_LENGTH` (8 → 10-12) dans `src/auth/LoginScreen.tsx`.

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
