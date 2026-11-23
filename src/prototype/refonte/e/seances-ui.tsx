// PROTOTYPE JETABLE · surface Séances. Pièces propres à l'édition du plan, en
// plus du kit : champ texte (le clavier est permis ici, on n'est pas en salle),
// feuille de nom, confirmation en ligne, rangée repliable, rangée d'action,
// ligne de réordonnancement. Mêmes règles que kit.tsx : aucun signal, aucun
// fond coloré, des mots plutôt que des icônes.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { PrimaryButton, SecondaryButton, Sheet, TextLink } from './kit';

/** La barre de bascule du prototype écoute ← → sur window : on la tient à l'écart. */
const keepArrows = (e: KeyboardEvent) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation();
};

/** Champ texte : libellé visible, 48 px, erreur sobre dessous. */
export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  autoFocus,
  type = 'text',
  hideLabel,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  hint?: ReactNode;
  placeholder?: string;
  autoFocus?: boolean;
  type?: 'text' | 'search';
  hideLabel?: boolean;
  onSubmit?: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  return (
    <div>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'block pb-1.5 text-[15px] font-semibold text-(--ink)'}>
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint={onSubmit ? 'done' : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          keepArrows(e);
          if (e.key === 'Enter' && onSubmit) onSubmit();
        }}
        className={`h-12 w-full rounded-(--r) bg-transparent px-3 text-[17px] text-(--ink) placeholder:text-(--faint) ${
          error ? 'border-2 border-(--ink)' : 'border border-(--muted)'
        }`}
      />
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-2 text-[14px] leading-[1.4] text-(--ink)">
          {error}
        </p>
      ) : (
        hint && <p className="mt-2 text-[14px] leading-[1.4] text-(--muted)">{hint}</p>
      )}
    </div>
  );
}

/** Zone de texte libre (note d'instructions). */
export function TextArea({ label, value, onChange, hint, placeholder }: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; placeholder?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block pb-1.5 text-[15px] font-semibold text-(--ink)">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        rows={4}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={keepArrows}
        className="block w-full resize-none rounded-(--r) border border-(--muted) bg-transparent px-3 py-2.5 text-[17px] leading-[1.45] text-(--ink) placeholder:text-(--faint)"
      />
      {hint && <p className="mt-2 text-[14px] leading-[1.4] text-(--muted)">{hint}</p>}
    </div>
  );
}

/** Feuille « un nom » : créer, renommer, dupliquer. Le bouton reste éteint tant
 *  que le nom est vide, inchangé ou déjà pris. */
export function NameSheet({
  open,
  title,
  label,
  initial = '',
  intro,
  submitLabel,
  validate,
  onSubmit,
  onClose,
  requireChange,
}: {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  intro?: ReactNode;
  submitLabel: string;
  validate: (name: string) => string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
  /** Renommer : le nom actuel ne compte pas comme une réponse. */
  requireChange?: boolean;
}) {
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      {open && (
        <NameForm
          key={initial}
          label={label}
          initial={initial}
          intro={intro}
          submitLabel={submitLabel}
          validate={validate}
          onSubmit={onSubmit}
          requireChange={!!requireChange}
        />
      )}
    </Sheet>
  );
}

function NameForm({
  label,
  initial,
  intro,
  submitLabel,
  validate,
  onSubmit,
  requireChange,
}: {
  label: string;
  initial: string;
  requireChange: boolean;
  intro?: ReactNode;
  submitLabel: string;
  validate: (name: string) => string | null;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const error = validate(name);
  const blank = name.trim() === '';
  const unchanged = requireChange && name.trim().replace(/\s+/g, ' ') === initial;
  const ok = !blank && !unchanged && !error;
  const submit = () => ok && onSubmit(name);
  return (
    <div className="px-5 pb-2 pt-1">
      {intro && <p className="mb-4 text-[15px] leading-[1.45] text-(--muted)">{intro}</p>}
      <TextField label={label} value={name} onChange={setName} error={error} autoFocus onSubmit={submit} />
      <div className="mt-4 flex">
        <PrimaryButton onClick={submit} disabled={!ok}>
          {submitLabel}
        </PrimaryButton>
      </div>
    </div>
  );
}

/** Confirmation en ligne (motif de la garde de déconnexion des Réglages). Le
 *  texte dit toujours ce qui sera perdu. `destructive` (une perte qui ne se
 *  défait pas) : l'option SÛRE devient le bouton (`keepLabel`) et la perte un
 *  lien souligné discret, comme partout dans l'app. Sinon (archivage, qui se
 *  défait), l'action est le bouton et « Annuler » le lien. */
export function Confirm({
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = false,
  keepLabel = 'Garder',
}: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  keepLabel?: string;
}) {
  return (
    <div role="alert" className="mx-5 my-3 border-l-[3px] border-(--ink) pl-3">
      <div className="text-[15px] leading-[1.45] text-(--ink)">{children}</div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4">
        {destructive ? (
          <>
            <SecondaryButton onClick={onCancel}>{keepLabel}</SecondaryButton>
            <TextLink tone="muted" onClick={onConfirm}>
              {confirmLabel}
            </TextLink>
          </>
        ) : (
          <>
            <SecondaryButton onClick={onConfirm}>{confirmLabel}</SecondaryButton>
            <TextLink tone="muted" onClick={onCancel}>
              Annuler
            </TextLink>
          </>
        )}
      </div>
    </div>
  );
}

/** En-tête d'une section repliée (archivées). Le compte se lit sans ouvrir. */
export function Disclosure({ label, count, open, onToggle, children }: { label: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  const id = useId();
  return (
    <section className="mt-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex min-h-12 w-full items-baseline justify-between gap-3 px-5 py-2 text-left"
      >
        <span className="text-[17px] font-semibold text-(--ink)">
          {label} <span className="font-normal text-(--muted)">· {count}</span>
        </span>
        <span className="text-[15px] text-(--muted) underline decoration-1 underline-offset-4">{open ? 'Masquer' : 'Afficher'}</span>
      </button>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** Action d'objet (renommer, archiver…) : un bouton secondaire pleine largeur,
 *  l'explication dessous. Plusieurs se suivent dans un `<ul>` sans filet. */
export function ActionRow({ label, meta, onClick }: { label: string; meta?: ReactNode; onClick: () => void }) {
  return (
    <li className="px-5 py-2">
      <SecondaryButton onClick={onClick} className="w-full">
        {label}
      </SecondaryButton>
      {meta && <p className="mt-1.5 text-[14px] leading-[1.4] text-(--muted)">{meta}</p>}
    </li>
  );
}

/** Ligne non actionnable d'une liste d'actions : dit pourquoi une action manque. */
export function ActionNote({ children }: { children: ReactNode }) {
  return <li className="px-5 py-2.5 text-[15px] leading-[1.45] text-(--muted)">{children}</li>;
}

/** Ligne en mode « Réordonner » : rang, nom (sur deux lignes au besoin), Monter
 *  et Descendre en mots. La dernière ligne déplacée garde le trait de gauche. */
export function ReorderRow({
  rank,
  title,
  meta,
  first,
  last,
  moved,
  onMove,
}: {
  rank: number;
  title: string;
  meta?: ReactNode;
  first: boolean;
  last: boolean;
  moved: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const btn =
    'e-press h-11 flex-none rounded-(--r) border-[1.5px] border-(--ink) bg-(--raise) px-3 text-[15px] font-semibold text-(--ink) active:bg-(--line) disabled:border-(--line) disabled:bg-transparent disabled:text-(--faint)';
  return (
    <li className="relative flex min-h-16 items-center gap-3 border-b border-(--line) px-5 py-2">
      {moved && <span aria-hidden className="absolute bottom-3 left-0 top-3 w-[3px] bg-(--ink)" />}
      <span className="w-6 flex-none text-[15px] text-(--faint)">{rank}</span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[17px] leading-[1.25] text-(--ink) ${moved ? 'font-semibold' : 'font-medium'}`}>{title}</span>
        {meta && <span className="mt-0.5 block text-[14px] text-(--muted)">{meta}</span>}
      </span>
      <button type="button" className={btn} disabled={first} aria-label={`Monter ${title}`} onClick={() => onMove(-1)}>
        Monter
      </button>
      <button type="button" className={btn} disabled={last} aria-label={`Descendre ${title}`} onClick={() => onMove(1)}>
        Descendre
      </button>
    </li>
  );
}
