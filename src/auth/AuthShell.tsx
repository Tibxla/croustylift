// Coquille commune aux écrans d'entrée (Login, Mot de passe oublié, Réinitialisation).
// Colonne centrée verticalement, padding latéral ~30px, marque optionnelle en haut,
// titre / sous-titre, contenu, puis le footer mono « OFFLINE-FIRST · CHIFFRÉ » qui
// rappelle la promesse local-first / chiffré (DESIGN.md). Centralisé pour que les
// trois écrans partagent EXACTEMENT le même rythme et la même matière.
import { useState, type ReactNode } from 'react'

export function AuthShell({
  mark = true,
  title,
  titleSize = 32,
  subtitle,
  children,
  footer = true,
  backLabel,
  onBack,
}: {
  mark?: boolean
  title: string
  /** Taille du titre en px (32 sur Login, 30 sur les sous-écrans — cf. maquette). */
  titleSize?: number
  subtitle?: ReactNode
  children: ReactNode
  footer?: boolean
  /** Libellé du bouton retour haut (ex. « Connexion ») ; rendu seulement si `onBack`. */
  backLabel?: string
  onBack?: () => void
}) {
  return (
    <main className="flex min-h-screen flex-col bg-bg px-[30px] text-ink">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 mb-6 inline-flex items-center gap-1 self-start rounded px-1 py-1 text-[13px] font-medium text-ink-muted transition active:text-ink"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            {backLabel ?? 'Retour'}
          </button>
        )}
        {mark && <PlaquetteMark />}
        <h1
          className="font-semibold leading-[1.05] tracking-[-0.025em] text-ink"
          style={{ fontSize: `${titleSize}px` }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2.5 text-[15px] leading-[1.45] text-ink-muted">{subtitle}</p>
        )}
        <div className="mt-8">{children}</div>
      </div>
      {footer && (
        <p className="readout pb-7 pt-2 text-center text-xs tracking-[0.04em] text-ink-faint">
          OFFLINE-FIRST · CHIFFRÉ
        </p>
      )}
    </main>
  )
}

/**
 * Plaquette d'instrument du Login : squircle 62px (gradient surface-2→bg, bordure
 * hair-strong, liseré spéculaire + halo accent) contenant les 3 barres ascendantes
 * de la marque (faint / muted / accent avec glow). Reconstruite en div tokenisé
 * (pas une image bitmap) pour porter le halo accent que l'icône PWA ne rend pas. */
function PlaquetteMark() {
  return (
    <div
      aria-hidden="true"
      className="mb-[30px] flex h-[62px] w-[62px] items-end justify-center gap-1 rounded-[18px] border border-hair-strong pb-[15px]"
      style={{
        background: 'linear-gradient(150deg, var(--color-surface-2), var(--color-bg))',
        boxShadow: 'inset 0 1px 0 var(--spec), 0 16px 40px -16px var(--color-accent)',
      }}
    >
      <span className="w-1.5 rounded-[3px] bg-ink-faint" style={{ height: 11 }} />
      <span className="w-1.5 rounded-[3px] bg-ink-muted" style={{ height: 18 }} />
      <span
        className="w-1.5 rounded-[3px] bg-accent"
        style={{ height: 26, boxShadow: '0 0 14px var(--color-accent)' }}
      />
    </div>
  )
}

/** Label de champ : 12px, majuscules, ink-faint (signature des écrans d'entrée). */
export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string
  children: ReactNode
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-xs font-medium uppercase tracking-[0.04em] text-ink-faint"
    >
      {children}
    </label>
  )
}

/**
 * Champ mot de passe avec bascule afficher/masquer (icône œil), comme la maquette.
 * Le `.field` porte la matière (bordure hairline, halo accent au focus) ; l'œil est
 * un bouton ghost à droite, tap-target suffisant, jamais porté par la couleur seule
 * (libellé aria explicite).
 */
export function PasswordField({
  id,
  value,
  onChange,
  autoComplete,
  minLength,
  placeholder = '••••••••',
}: {
  id: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  minLength?: number
  placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        required
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field h-[54px] w-full rounded-[14px] pl-4 pr-12 text-base"
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
        aria-pressed={show}
        className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-ink-muted transition active:text-ink"
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {show ? (
            <>
              <path d="M9.9 4.2A10.5 10.5 0 0 1 12 4c6.5 0 10 8 10 8a18 18 0 0 1-2.4 3.4M6.6 6.6A18 18 0 0 0 2 12s3.5 8 10 8a10.5 10.5 0 0 0 5.4-1.5" />
              <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
              <path d="M3 3l18 18" />
            </>
          ) : (
            <>
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </div>
  )
}
