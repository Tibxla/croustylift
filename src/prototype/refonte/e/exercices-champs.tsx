// PROTOTYPE JETABLE · socle E. Champs de saisie au clavier (noms, e-mail, mot de
// passe, note), cases à cocher et options exclusives, partagés par Exercices et
// Compte. Le clavier n'est admis que pour du texte libre, jamais pour un chiffre.
//
// Champ : fond --raise, contour --dim (3,4:1, assez pour repérer le champ),
// rayon --r, texte 17 px. Focus : contour blanc cassé, plus le contour net de
// :focus-visible (index.css, blanc cassé ici), sans halo. Erreur : la phrase sous le champ, posée sur
// un trait blanc cassé à gauche (motif de la garde de Réglages), reliée par
// aria-describedby ; jamais de rouge, jamais le signal.
import { useId, useState, type ReactNode } from 'react';
import { Icon } from './icons';

const FIELD =
  'h-12 w-full min-w-0 rounded-(--r) border border-(--dim) bg-(--raise) px-3.5 text-[17px] text-(--ink) placeholder:text-(--faint) outline-none focus:border-(--ink) aria-[invalid=true]:border-(--ink)';

/** Message sous un champ (ou d'un formulaire). `role="alert"` : lu dès qu'il paraît. */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-2 border-l-[3px] [font-variant-numeric:normal] border-(--ink) pl-3 text-[15px] leading-[1.4] text-(--ink)">
      {children}
    </p>
  );
}

/** Bloc d'information ou de garde : trait à gauche, texte, actions dessous. */
export function Notice({ title, children, actions, tone = 'ink' }: { title?: ReactNode; children?: ReactNode; actions?: ReactNode; tone?: 'ink' | 'muted' }) {
  return (
    <div className={`border-l-[3px] pl-3 ${tone === 'ink' ? 'border-(--ink)' : 'border-(--muted)'}`}>
      {title && <p className="text-[16px] font-semibold leading-[1.35] text-(--ink)">{title}</p>}
      {children && <div className={`${title ? 'mt-1' : ''} text-[15px] leading-[1.45] text-(--muted)`}>{children}</div>}
      {actions && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">{actions}</div>}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  autoComplete,
  placeholder,
  enterKeyHint,
  maxLength = 80,
  autoFocus,
  trailing,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  hint?: ReactNode;
  type?: 'text' | 'email' | 'password' | 'search';
  autoComplete?: string;
  placeholder?: string;
  enterKeyHint?: 'done' | 'next' | 'go' | 'search' | 'send';
  maxLength?: number;
  autoFocus?: boolean;
  /** Action en mots à droite du libellé (« Afficher »). */
  trailing?: ReactNode;
  inputMode?: 'email' | 'text' | 'search';
}) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  return (
    <div className="px-5 pt-4">
      <div className="flex min-h-8 items-end justify-between gap-3 pb-1.5">
        <label htmlFor={id} className="text-[15px] font-semibold text-(--ink) [font-variant-numeric:normal]">
          {label}
        </label>
        {trailing}
      </div>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        enterKeyHint={enterKeyHint}
        inputMode={inputMode}
        maxLength={maxLength}
        autoFocus={autoFocus}
        spellCheck={false}
        autoCapitalize={type === 'text' ? 'sentences' : 'none'}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD}
      />
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-[14px] leading-[1.4] text-(--muted)">
          {hint}
        </p>
      )}
      {error && <FieldError id={errId}>{error}</FieldError>}
    </div>
  );
}

/** Mot de passe : l'œil à droite du libellé (barré quand le mot est en clair). */
export function PasswordField(props: Omit<Parameters<typeof TextField>[0], 'type' | 'trailing'>) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      {...props}
      type={shown ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          aria-pressed={shown}
          aria-label={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          onClick={() => setShown((s) => !s)}
          className="-mb-1.5 -mr-2.5 inline-flex h-11 w-11 items-center justify-center text-(--muted) active:text-(--ink)"
        >
          <Icon name={shown ? 'eye-off' : 'eye'} />
        </button>
      }
    />
  );
}

/** Zone de texte (note d'instructions). */
export function TextArea({
  label,
  value,
  onChange,
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        rows={3}
        maxLength={500}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD} h-auto min-h-24 resize-none py-3 leading-[1.45]`}
      />
      {hint && <p className="mt-1.5 text-[14px] text-(--muted)">{hint}</p>}
    </div>
  );
}

/** Case à cocher carrée : cochée = carré blanc cassé plein + coche du fond. */
export function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[4px] border ${
        checked ? 'border-(--ink) bg-(--ink) text-(--bg)' : 'border-(--muted)'
      }`}
    >
      {checked && (
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M2.5 7.5 5.5 10.5 11.5 3.5" />
        </svg>
      )}
    </span>
  );
}

/** Option exclusive : rond vide, ou rond blanc cassé avec un point du fond. */
export function RadioMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border ${
        checked ? 'border-(--ink) bg-(--ink)' : 'border-(--muted)'
      }`}
    >
      {checked && <span className="h-2 w-2 rounded-full bg-(--bg)" />}
    </span>
  );
}

/** Bouton de soumission invisible : Entrée valide le formulaire, l'action reste en bas. */
export function ImplicitSubmit() {
  return <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />;
}
