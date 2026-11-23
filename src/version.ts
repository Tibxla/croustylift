// Version du build, injectée par Vite (`define`, vite.config.ts).

/** Libellé affiché dans le bloc Compte : « a1b2c3d · 23/11/2026 19:45 ». */
export function formatVersion(commit: string, builtAtIso: string): string {
  const builtAt = new Date(builtAtIso)
  if (Number.isNaN(builtAt.getTime())) return commit
  const z = (n: number) => String(n).padStart(2, '0')
  const date = `${z(builtAt.getDate())}/${z(builtAt.getMonth() + 1)}/${builtAt.getFullYear()}`
  return `${commit} · ${date} ${z(builtAt.getHours())}:${z(builtAt.getMinutes())}`
}

export const APP_COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'inconnu'
export const APP_BUILT_AT: string = typeof __APP_BUILT_AT__ === 'string' ? __APP_BUILT_AT__ : ''
export const APP_VERSION_LABEL: string = formatVersion(APP_COMMIT, APP_BUILT_AT)
