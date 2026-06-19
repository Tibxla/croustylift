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

## Reste ouvert (action hors-code)

- **Protection « mots de passe compromis » (Supabase Auth).** Désactivée (advisor
  `auth_leaked_password_protection`). SEUL point restant : un toggle dans le dashboard
  Supabase → Authentication → Policies (gratuit, aucun impact code, ~10 s). Côté code,
  `MIN_PASSWORD_LENGTH` a été relevé à 10.

## Fait depuis (pour mémoire)

- ✅ Split vendor : `manualChunks` (react, supabase) → chunk critique Capture
  152 → 94 kB gzip, Supabase isolé en chunk caché.
- ✅ `handleSaveDatedNote` lit la projection `stateRef` (aligné sur handleLog, M6).
- ✅ Garde-fou de shift de l'outbox robuste via `_seq` (identité unique stampée à
  l'enqueue ; repli `(type,id)` pour les ops héritées) + test de concurrence.
- ✅ `mergeProgress` aligne les `setId` par `(order, side)`, plus par index brut.
- ✅ Couverture : `reconstructExerciseExecutions` (rows→domaine) extraite et testée,
  + `overrides.test.ts` pour l'adaptateur `mergeRowWithOverride`.
