// PROTOTYPE JETABLE · variante B « Carnet » : le pavé numérique en feuille basse.
// Jamais le clavier OS : uniquement des <button>. Les trois champs de la ligne
// sont dans la feuille, une seule ouverture suffit. Le premier chiffre tapé
// remplace la valeur pré-remplie (la Référence du rang), comme une calculette.
import { kg } from './fixtures';
import {
  MINUS,
  TREND_CLASS,
  TREND_SIGN,
  deltaVsRef,
  fmtDate,
  fmtSet,
  signed1,
  trendOf,
  type SetVals,
} from './VariantB-shared';

export type Field = 'w' | 'r' | 'i';

export interface Draft {
  w: string;
  r: string;
  i: string;
  /** Le prochain chiffre remplace la valeur au lieu de s'y ajouter. */
  fresh: boolean;
}

export function parseDraft(d: Draft): SetVals | null {
  const w = Number.parseFloat(d.w.replace(',', '.'));
  const r = Number.parseInt(d.r, 10);
  const i = Number.parseInt(d.i, 10);
  if (!Number.isFinite(w) || w <= 0) return null;
  if (!Number.isFinite(r) || r < 1) return null;
  if (!Number.isFinite(i) || i < 0) return null;
  return { weightKg: w, reps: r, rir: i };
}

const MAX_LEN: Record<Field, number> = { w: 5, r: 2, i: 2 };

export function pressKey(d: Draft, field: Field, key: string): Draft {
  const cur = d[field];
  if (key === 'del') return { ...d, [field]: cur.slice(0, -1), fresh: false };
  if (key === ',') {
    if (field !== 'w') return d;
    if (d.fresh || cur === '') return { ...d, w: '0,', fresh: false };
    if (cur.includes(',')) return d;
    return { ...d, w: `${cur},`, fresh: false };
  }
  if (key.startsWith('step:')) {
    const step = Number.parseFloat(key.slice(5));
    const base = Number.parseFloat(cur.replace(',', '.'));
    const next = Math.max(0, (Number.isFinite(base) ? base : 0) + step);
    const rounded = Math.round(next * 100) / 100;
    return { ...d, [field]: field === 'w' ? kg(rounded) : String(Math.round(rounded)), fresh: true };
  }
  // Chiffre.
  if (d.fresh) return { ...d, [field]: key, fresh: false };
  if (cur.length >= MAX_LEN[field]) return d;
  // Une seule décimale après la virgule (pas de 82,55).
  if (field === 'w' && /,\d$/.test(cur)) return d;
  return { ...d, [field]: cur === '0' ? key : `${cur}${key}`, fresh: false };
}

const FIELD_LABEL: Record<Field, string> = { w: 'Poids', r: 'Reps', i: 'RIR' };
const FIELD_UNIT: Record<Field, string> = { w: 'kg', r: '', i: '' };

export function NumberPad({
  exerciseName,
  order,
  isCorrection,
  reference,
  referenceDate,
  prefillNote,
  draft,
  field,
  onField,
  onKey,
  onValidate,
  onClose,
}: {
  exerciseName: string;
  order: number;
  isCorrection: boolean;
  reference: SetVals | undefined;
  referenceDate: string | null;
  prefillNote: string | null;
  draft: Draft;
  field: Field;
  onField: (f: Field) => void;
  onKey: (k: string) => void;
  onValidate: () => void;
  onClose: () => void;
}) {
  const parsed = parseDraft(draft);
  const delta = parsed ? deltaVsRef(parsed, reference) : null;
  const steps =
    field === 'w'
      ? [
          { k: 'step:2.5', label: '+2,5' },
          { k: 'step:1.25', label: '+1,25' },
          { k: 'step:-1.25', label: `${MINUS}1,25` },
          { k: 'step:-2.5', label: `${MINUS}2,5` },
        ]
      : [
          { k: 'step:1', label: '+1' },
          { k: 'step:-1', label: `${MINUS}1` },
        ];

  return (
    <section
      aria-label={`Saisie de la série ${order}`}
      className="vb-sheet border-t border-hair-strong bg-surface px-4 pb-[64px] pt-1"
    >
      <div className="flex items-center justify-between">
        <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em]">
          {exerciseName}
          <span className="font-normal text-ink-muted">
            {' '}
            · {isCorrection ? 'corriger la série' : 'série'} {order}
          </span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="-mr-2 h-11 shrink-0 px-2 text-[14px] text-ink-muted active:text-ink"
        >
          Fermer
        </button>
      </div>

      <div className="flex items-baseline justify-between gap-3 text-[13px] text-ink-muted">
        <span className="truncate tabular-nums">
          {reference && referenceDate
            ? `réf. ${fmtDate(referenceDate)} : ${fmtSet(reference)}`
            : 'pas de référence à ce rang'}
          {prefillNote ? `, ${prefillNote}` : ''}
        </span>
        {delta !== null && (
          <span className={`readout shrink-0 ${TREND_CLASS[trendOf(delta, 0)]}`}>
            {TREND_SIGN[trendOf(delta, 0)]} {signed1(delta)}
          </span>
        )}
      </div>

      <div className="mt-2 grid grid-cols-3">
        {(['w', 'r', 'i'] as const).map((f) => {
          const active = f === field;
          const value = draft[f];
          return (
            <button
              key={f}
              type="button"
              onClick={() => onField(f)}
              aria-pressed={active}
              className={`flex h-[68px] flex-col items-start justify-end border-b-2 pb-1.5 text-left ${
                active ? 'border-accent' : 'border-hair'
              }`}
            >
              <span className="text-[12px] font-medium text-ink-muted">{FIELD_LABEL[f]}</span>
              <span
                className={`readout text-[32px] font-medium leading-none tracking-[-0.03em] ${
                  active ? 'text-accent-ink' : 'text-ink'
                }`}
              >
                <span className={active && draft.fresh && value !== '' ? 'vb-fresh' : ''}>
                  {value === '' ? ' ' : value}
                </span>
                {FIELD_UNIT[f] && value !== '' && (
                  <span className="ml-1 text-[14px] font-normal text-ink-muted">{FIELD_UNIT[f]}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-4 grid-rows-4 gap-1.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del'].map((k, idx) => {
          const col = (idx % 3) + 1;
          const row = Math.floor(idx / 3) + 1;
          const disabled = k === ',' && field !== 'w';
          return (
            <button
              key={k}
              type="button"
              disabled={disabled}
              onClick={() => onKey(k)}
              aria-label={k === 'del' ? 'Effacer' : k === ',' ? 'Virgule' : k}
              style={{ gridColumn: col, gridRow: row }}
              className="readout h-12 rounded-[8px] bg-surface-2 text-[22px] text-ink active:bg-[var(--surface-2-hover)] disabled:bg-transparent disabled:text-transparent"
            >
              {k === 'del' ? '⌫' : k}
            </button>
          );
        })}
        {steps.map((s, idx) => (
          <button
            key={s.k}
            type="button"
            onClick={() => onKey(s.k)}
            style={{
              gridColumn: 4,
              gridRow: steps.length === 4 ? idx + 1 : `${idx * 2 + 1} / span 2`,
            }}
            className="readout rounded-[8px] border border-hair-strong text-[16px] text-ink active:bg-surface-2"
          >
            {s.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={!parsed}
        onClick={onValidate}
        className="mt-3 h-14 w-full rounded-[10px] bg-ink text-[16px] font-semibold text-bg active:opacity-85 disabled:opacity-35"
      >
        {isCorrection ? `Corriger la série ${order}` : `Valider la série ${order}`}
      </button>
    </section>
  );
}
