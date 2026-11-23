/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** SHA court du commit du build (voir `buildCommit`, vite.config.ts). */
declare const __APP_COMMIT__: string
/** Date ISO du build. */
declare const __APP_BUILT_AT__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
