// ESLint flat config — réintroduit le garde-fou perdu du scaffold Vite React-TS.
// Le projet portait des `eslint-disable react-hooks/exhaustive-deps` SANS qu'ESLint
// ni le plugin soient installés : la règle ne tournait plus (ni en local ni en CI),
// donc les omissions de dépendances d'effets ne distinguaient plus l'intentionnel de
// l'oubli. On rétablit les DEUX règles historiques react-hooks (rules-of-hooks +
// exhaustive-deps) + react-refresh. On NE branche PAS le preset `recommended` de
// react-hooks v6 (qui embarque les règles React-Compiler : set-state-in-effect,
// refs, immutability…) : c'est un gros chantier à part, hors du périmètre « rétablir
// le garde-fou ». Cf. docs/future-improvements.md.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Sorties de build, copies de worktrees (résidu .claude) et harnais de dev non
  // trackés (*-harness.tsx, à la racine OU dans .screenshots/) hors lint.
  { ignores: ['dist', 'dev-dist', '.claude', 'coverage', '**/*-harness.tsx'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      // Le preset v7 embarque les règles React-Compiler. Deux d'entre elles flaguent
      // SYSTÉMATIQUEMENT des patterns légitimes ici (le projet n'utilise PAS le
      // Compiler) → on les rétrograde en `warn` (visibles, non bloquantes) plutôt que
      // de refactorer du code qui marche ou d'empiler des eslint-disable :
      //   - set-state-in-effect : le « reset à loading » en tête des effets de
      //     chargement (un setState synchrone par écran), idiome de fetch-in-effect ;
      //   - refs : les miroirs de ref INTENTIONNELS et documentés de la capture
      //     (stateRef synchrone du bug M6, init-ref de réhydratation, templateIdsRef).
      // Les autres règles Compiler (static-components, immutability, purity,
      // preserve-manual-memoization…) restent en `error` : elles attrapent de vrais
      // problèmes, déjà corrigés.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Convention `_` = volontairement inutilisé (déstructuration partielle,
      // param ignoré) : on respecte le préfixe au lieu de le signaler.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // La directive `/// <reference types="vitest/config" />` (vite.config.ts) est
      // l'idiome Vite/Vitest : on autorise le triple-slash.
      '@typescript-eslint/triple-slash-reference': 'off',
    },
  },
)
