// Pièces propres à l'édition du plan (Séances), en plus du kit : feuille « un
// nom » (créer, renommer, copier) et ligne de réordonnancement. Aucun signal,
// aucun fond coloré, des mots plutôt que des icônes (DESIGN.md).
import { useState, type ReactNode } from 'react';
import { errorMessage } from '../../lib/error-message';
import { FieldError, PrimaryButton, Sheet, TextField } from '../../ui';

/** Un nom tel qu'il sera enregistré : espaces de bord retirés, espaces internes réduits. */
function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Feuille « un nom » : créer, renommer, copier. Le bouton reste éteint tant
 *  que le nom est vide (ou inchangé, pour un renommage). L'écriture est
 *  attendue : un refus (nom déjà pris, réseau) s'affiche sous le champ, en
 *  français (`errorMessage`), et la feuille reste ouverte. */
export function NameSheet({
  open,
  title,
  label,
  initial = '',
  intro,
  submitLabel,
  busyLabel = 'Enregistrement…',
  onSubmit,
  onClose,
  requireChange = false,
}: {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  intro?: ReactNode;
  submitLabel: string;
  busyLabel?: string;
  /** Résolu = enregistré : le parent ferme la feuille (ou navigue). */
  onSubmit: (name: string) => Promise<void>;
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
          busyLabel={busyLabel}
          onSubmit={onSubmit}
          requireChange={requireChange}
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
  busyLabel,
  onSubmit,
  requireChange,
}: {
  label: string;
  initial: string;
  intro?: ReactNode;
  submitLabel: string;
  busyLabel: string;
  onSubmit: (name: string) => Promise<void>;
  requireChange: boolean;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = cleanName(name);
  const ok = clean !== '' && !(requireChange && clean === cleanName(initial)) && !busy;

  async function submit() {
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(clean);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form
      className="px-5 pb-2 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {intro && <p className="mb-4 text-[15px] leading-[1.45] text-muted">{intro}</p>}
      <TextField label={label} value={name} onChange={setName} autoFocus enterKeyHint="done" />
      {error && <FieldError>{error}</FieldError>}
      <div className="mt-4 flex">
        <PrimaryButton type="submit" disabled={!ok}>
          {busy ? busyLabel : submitLabel}
        </PrimaryButton>
      </div>
    </form>
  );
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
  disabled = false,
  onMove,
}: {
  rank: number;
  title: string;
  meta?: ReactNode;
  first: boolean;
  last: boolean;
  moved: boolean;
  /** Un déplacement est en vol (écriture en base) : les deux boutons attendent. */
  disabled?: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const btn =
    'ui-press h-11 flex-none rounded-block border-[1.5px] border-ink bg-raise px-3 text-[15px] font-semibold text-ink active:bg-line disabled:border-line disabled:bg-transparent disabled:text-faint';
  return (
    <li className="relative flex min-h-16 items-center gap-3 border-b border-line px-5 py-2">
      {moved && <span aria-hidden className="absolute bottom-3 left-0 top-3 w-[3px] bg-ink" />}
      <span className="tnum w-6 flex-none text-[15px] text-faint">{rank}</span>
      <span className="min-w-0 flex-1">
        <span className={`block break-words text-[17px] leading-[1.25] text-ink ${moved ? 'font-semibold' : 'font-medium'}`}>{title}</span>
        {meta && <span className="mt-0.5 block text-[14px] text-muted">{meta}</span>}
      </span>
      <button type="button" className={btn} disabled={first || disabled} aria-label={`Monter ${title}`} onClick={() => onMove(-1)}>
        Monter
      </button>
      <button type="button" className={btn} disabled={last || disabled} aria-label={`Descendre ${title}`} onClick={() => onMove(1)}>
        Descendre
      </button>
    </li>
  );
}
