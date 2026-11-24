// Kit E · champs au clavier (noms, recherche, e-mail, mot de passe, note), plus
// le message d'erreur, le bloc d'avis et les marques de case et d'option.
//
// Le clavier n'est admis que pour du texte libre, jamais pour un chiffre mesuré
// (DESIGN.md : règle, rangées de numéros, steppers).
//
// Champ : fond levé, contour gris repère (3,4:1, assez pour repérer le champ),
// rayon de bloc, texte de 17 px (au moins 16 px : iOS zoome sinon). Focus : UN
// seul indicateur (registre U17), le contour passe au blanc cassé et double
// (filet intérieur net, sans flou) ; le contour global de `:focus-visible` est
// retiré par `.focus-own`. Erreur : « Erreur : » puis la phrase sous le champ,
// entre deux filets (`Alert`), reliée par `aria-describedby` ; jamais de rouge,
// jamais le signal. Un champ a toujours un nom : libellé visible, ou masqué mais lu
// (`hideLabel`, registre U37). Pas de placeholder qui imite une valeur (U32).
import { useId, useState, type ReactNode, type Ref } from 'react';
import { Icon } from './icons';
import { Alert } from './states';

export const FIELD_CLASS =
  'focus-own w-full min-w-0 rounded-block border border-dim bg-raise px-3.5 text-[17px] text-ink placeholder:text-faint focus:border-ink focus:shadow-[inset_0_0_0_1px_var(--color-ink)] aria-[invalid=true]:border-ink disabled:text-muted';

/** Message sous un champ (ou d'un formulaire). `role="alert"` : lu dès qu'il paraît. */
export function FieldError({ id, children, className = '' }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <Alert id={id} className={`mt-2 py-2 ${className}`}>
      {children}
    </Alert>
  );
}

/** Bloc d'information ou de garde : entre deux filets, titre, texte, actions dessous. */
export function Notice({
  title,
  children,
  actions,
  role,
  className = '',
}: {
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
}) {
  return (
    <div role={role} className={`border-y border-line py-3 ${className}`}>
      {title && <p className="text-[16px] font-semibold leading-[1.35] text-ink">{title}</p>}
      {children && <div className={`${title ? 'mt-1' : ''} text-[15px] leading-[1.45] text-muted`}>{children}</div>}
      {actions && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">{actions}</div>}
    </div>
  );
}

type FieldType = 'text' | 'email' | 'password' | 'search';

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Libellé lu mais non affiché (la section porte déjà le titre). */
  hideLabel?: boolean;
  error?: string | null;
  hint?: ReactNode;
  type?: FieldType;
  id?: string;
  name?: string;
  autoComplete?: string;
  placeholder?: string;
  enterKeyHint?: 'done' | 'next' | 'go' | 'search' | 'send';
  inputMode?: 'email' | 'text' | 'search';
  maxLength?: number;
  autoFocus?: boolean;
  required?: boolean;
  disabled?: boolean;
  /** Action en mots ou icône à droite du libellé (« Afficher »). */
  trailing?: ReactNode;
  /** Entrée hors formulaire : valide (un formulaire, lui, se soumet seul). */
  onEnter?: () => void;
  onBlur?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}

/** Champ texte d'une ligne, 48 px, libellé au-dessus. */
export function TextField({
  label,
  value,
  onChange,
  hideLabel = false,
  error,
  hint,
  type = 'text',
  id: givenId,
  name,
  autoComplete = 'off',
  placeholder,
  enterKeyHint,
  inputMode,
  maxLength = 80,
  autoFocus,
  required,
  disabled,
  trailing,
  onEnter,
  onBlur,
  inputRef,
  className = '',
}: TextFieldProps) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errId : '', hint && !error ? hintId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      {hideLabel ? (
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
      ) : (
        <div className="flex min-h-8 items-end justify-between gap-3 pb-1.5">
          <label htmlFor={id} className="text-[15px] font-semibold text-ink">
            {label}
          </label>
          {trailing}
        </div>
      )}
      <input
        ref={inputRef}
        id={id}
        name={name}
        type={type}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        enterKeyHint={enterKeyHint ?? (onEnter ? 'done' : undefined)}
        inputMode={inputMode}
        maxLength={maxLength}
        autoFocus={autoFocus}
        required={required}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize={type === 'text' ? 'sentences' : 'none'}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={
          onEnter
            ? (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onEnter();
                }
              }
            : undefined
        }
        className={`${FIELD_CLASS} h-12`}
      />
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-[14px] leading-[1.4] text-muted">
          {hint}
        </p>
      )}
      {error && <FieldError id={errId}>{error}</FieldError>}
    </div>
  );
}

/** Mot de passe : « Afficher » à droite du libellé (œil barré quand il est en clair). */
export function PasswordField(props: Omit<TextFieldProps, 'type' | 'trailing' | 'hideLabel'>) {
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
          className="-mb-1.5 -mr-2.5 inline-flex h-11 w-11 items-center justify-center text-muted active:text-ink"
        >
          <Icon name={shown ? 'eye-off' : 'eye'} />
        </button>
      }
    />
  );
}

/** Zone de texte libre (note d'instructions, note d'exo). */
export function TextArea({
  label,
  value,
  onChange,
  hideLabel = false,
  hint,
  placeholder,
  id: givenId,
  rows = 3,
  maxLength = 500,
  onBlur,
  className = '',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hideLabel?: boolean;
  hint?: ReactNode;
  placeholder?: string;
  id?: string;
  rows?: number;
  maxLength?: number;
  onBlur?: () => void;
  className?: string;
}) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const hintId = `${id}-hint`;
  return (
    <div className={className}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'block pb-1.5 text-[15px] font-semibold text-ink'}>
        {label}
      </label>
      {hint && (
        <p id={hintId} className="-mt-0.5 mb-2 text-[14px] leading-[1.4] text-muted">
          {hint}
        </p>
      )}
      <textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={`${FIELD_CLASS} block min-h-24 resize-y py-3 leading-[1.45]`}
      />
    </div>
  );
}

/** Case à cocher carrée : cochée = carré blanc cassé plein + coche du fond. */
export function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[4px] border ${
        checked ? 'border-ink bg-ink text-bg' : 'border-muted'
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
        checked ? 'border-ink bg-ink' : 'border-muted'
      }`}
    >
      {checked && <span className="h-2 w-2 rounded-full bg-bg" />}
    </span>
  );
}

/** Bouton de soumission invisible : Entrée valide le formulaire, l'action reste en bas. */
export function ImplicitSubmit() {
  return <button type="submit" tabIndex={-1} aria-hidden className="sr-only" />;
}
