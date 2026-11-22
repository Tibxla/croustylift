// PROTOTYPE JETABLE · variante B « Carnet ».
// L'idée : l'app comme un carnet d'entraînement, zéro carte. En salle, toute la
// séance est un seul tableau aligné (un bloc par exo, une ligne par série,
// colonnes Réf. / Poids / Reps / RIR / Écart). Les séries à faire sont écrites
// d'avance, en fantôme, avec la Référence du même rang : valider la ligne telle
// quelle = un tap ; toucher une cellule ouvre le pavé en feuille basse. Le violet
// ne marque que la cellule en cours d'édition. Au calme, une liste de cotation.
import { useEffect, useRef, useState } from 'react';
import { kg, range, type ExercisePlan, type SessionFixture } from './fixtures';
import { Analyse } from './VariantB-analyse';
import { NumberPad, parseDraft, pressKey, type Draft, type Field } from './VariantB-pad';
import {
  TREND_CLASS,
  TREND_SIGN,
  deltaVsRef,
  fmtDate,
  fmtSet,
  signed1,
  trendOf,
  type SetVals,
} from './VariantB-shared';

export const name = 'Carnet';

type Tab = 'salle' | 'analyse';

interface Editing {
  exId: string;
  order: number;
  field: Field;
}

/** Une seule grille pour l'en-tête et toutes les lignes : les colonnes tombent juste. */
const GRID = 'grid grid-cols-[26px_minmax(0,1fr)_62px_44px_44px_82px] items-center';

const STYLES = `
@keyframes vb-sheet-in { from { transform: translateY(100%); } to { transform: none; } }
@keyframes vb-logged { from { background-color: var(--color-surface-2); } to { background-color: transparent; } }
@keyframes vb-unfold { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: no-preference) {
  .vb-sheet { animation: vb-sheet-in 220ms var(--ease-out-quint); }
  .vb-logged { animation: vb-logged 900ms var(--ease-out-quart); }
  .vb-unfold { animation: vb-unfold 200ms var(--ease-out-quart); }
}
/* Valeur pré-remplie, encore « sélectionnée » : le prochain chiffre la remplace. */
.vb-fresh { background-color: var(--color-accent-soft); border-radius: 4px; box-decoration-break: clone; }
`;

function refAt(ex: ExercisePlan, order: number): SetVals | undefined {
  return ex.reference?.sets[order - 1];
}

function toDraft(v: SetVals | undefined): Draft {
  return v
    ? { w: kg(v.weightKg), r: String(v.reps), i: String(v.rir), fresh: true }
    : { w: '', r: '', i: '', fresh: true };
}

export function VariantB({ session }: { session: SessionFixture }) {
  const [tab, setTab] = useState<Tab>('salle');
  const [logs, setLogs] = useState<Record<string, SetVals[]>>(() =>
    Object.fromEntries(
      session.exercises.map((e) => [
        e.id,
        e.loggedToday.map((s) => ({ weightKg: s.weightKg, reps: s.reps, rir: s.rir })),
      ]),
    ),
  );
  const [skipped, setSkipped] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(session.exercises.map((e) => [e.id, e.status === 'skipped'])),
  );
  const [focusId, setFocusId] = useState<string | null>(
    () => session.exercises.find((e) => e.status === 'in-progress')?.id ?? null,
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState<Draft>(toDraft(undefined));
  const [prefillNote, setPrefillNote] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const exById = (id: string) => session.exercises.find((e) => e.id === id);
  const logsOf = (id: string) => logs[id] ?? [];

  const openPad = (ex: ExercisePlan, wantedOrder: number, field: Field) => {
    const done = logsOf(ex.id);
    // Une ligne fantôme au-delà de la prochaine ouvre la prochaine : on ne saute pas de rang.
    const order = Math.min(wantedOrder, done.length + 1);
    const isCorrection = order <= done.length;
    const ref = refAt(ex, order);
    const last = done[done.length - 1];
    if (isCorrection) {
      setDraft(toDraft(done[order - 1]));
      setPrefillNote(null);
    } else if (ref) {
      setDraft(toDraft(ref));
      setPrefillNote(null);
    } else if (last) {
      setDraft(toDraft(last));
      setPrefillNote(`valeurs reprises de la série ${done.length}`);
    } else {
      setDraft(toDraft(undefined));
      setPrefillNote(null);
    }
    setEditing({ exId: ex.id, order, field });
  };

  const commit = (exId: string, order: number, vals: SetVals) => {
    const ex = exById(exId);
    if (!ex) return;
    const next = [...logsOf(exId)];
    if (order <= next.length) next[order - 1] = vals;
    else next.push(vals);
    setLogs((l) => ({ ...l, [exId]: next }));
    setFlash(`${exId}-${order}`);
    setEditing(null);
    if (next.length >= ex.sets[0]) {
      const idx = session.exercises.findIndex((e) => e.id === exId);
      const after = session.exercises
        .slice(idx + 1)
        .find((e) => !skipped[e.id] && logsOf(e.id).length < e.sets[0]);
      setFocusId(after?.id ?? null);
    } else {
      setFocusId(exId);
    }
  };

  // Ramène la ligne éditée au-dessus de la feuille.
  useEffect(() => {
    if (!editing) return;
    const raf = requestAnimationFrame(() => {
      const row = document.getElementById(`vb-row-${editing.exId}-${editing.order}`);
      const sheet = sheetRef.current;
      if (!row || !sheet) return;
      const r = row.getBoundingClientRect();
      const s = sheet.getBoundingClientRect();
      if (r.bottom > s.top - 12 || r.top < 90) row.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditing(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  const totalDone = session.exercises.reduce((a, e) => a + logsOf(e.id).length, 0);
  const totalPlanned = session.exercises.reduce((a, e) => a + (skipped[e.id] ? 0 : e.sets[0]), 0);
  const editingEx = editing ? exById(editing.exId) : undefined;

  return (
    <div className="flex flex-1 flex-col">
      <style>{STYLES}</style>
      <nav aria-label="Surfaces" className="flex items-center gap-5 px-4 pt-2">
        {(['salle', 'analyse'] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-current={tab === t ? 'page' : undefined}
            onClick={() => {
              setEditing(null);
              setTab(t);
            }}
            className={`h-11 min-w-11 border-b-2 px-1 text-[15px] ${
              tab === t ? 'border-ink font-semibold text-ink' : 'border-transparent text-ink-muted'
            }`}
          >
            {t === 'salle' ? 'Salle' : 'Analyse'}
          </button>
        ))}
        <span className="ml-auto text-[13px] tabular-nums text-ink-muted">
          {session.pendingSync === 0 ? 'synchro à jour' : `${session.pendingSync} en attente`}
        </span>
      </nav>
      <div className="mx-4 border-t border-hair" />

      {tab === 'analyse' ? (
        <Analyse session={session} />
      ) : (
        <main className="pb-6">
          <header className="flex items-end justify-between gap-4 px-4 pb-3 pt-4">
            <div className="min-w-0">
              <h1 className="text-[28px] font-semibold leading-[1.1] tracking-[-0.025em]">
                {session.seanceName}
              </h1>
              <p className="mt-1 whitespace-nowrap text-[13px] tabular-nums text-ink-muted">
                {session.routineName} · depuis {session.startedAt} · {session.elapsedMin} min
              </p>
            </div>
            <p className="shrink-0 text-right leading-none">
              <span className="readout text-[22px] font-medium text-ink">{totalDone}</span>
              <span className="readout text-[15px] text-ink-muted">/{totalPlanned}</span>
              <span className="mt-1.5 block text-[12px] text-ink-muted">séries</span>
            </p>
          </header>

          <div
            className={`${GRID} sticky top-0 z-20 h-8 border-b border-hair-strong bg-bg px-4 text-[12px] text-ink-muted`}
            aria-hidden="true"
          >
            <span>#</span>
            <span>Réf.</span>
            <span className="text-right">Poids</span>
            <span className="text-right">Reps</span>
            <span className="text-right">RIR</span>
            <span className="text-right">Écart</span>
          </div>

          {session.exercises.map((ex) => (
            <ExerciseBlock
              key={ex.id}
              ex={ex}
              done={logsOf(ex.id)}
              skipped={!!skipped[ex.id]}
              focused={focusId === ex.id}
              editing={editing?.exId === ex.id ? editing : null}
              draft={draft}
              flash={flash}
              onOpen={(order, field) => openPad(ex, order, field)}
              onQuickLog={(order) => {
                const ref = refAt(ex, order);
                if (ref) commit(ex.id, order, ref);
              }}
              onResume={() => {
                setSkipped((s) => ({ ...s, [ex.id]: false }));
                setFocusId(ex.id);
              }}
            />
          ))}

          <p className="px-4 pt-3 text-[12px] leading-[1.45] text-ink-muted">
            Réf. : la dernière fois dans {session.seanceName}, même rang de série. Écart : e1RM du
            jour moins e1RM de la réf., en kg.
          </p>
          <div className="px-4 pt-5">
            <button
              type="button"
              onClick={() => console.info('[proto B] clôture non simulée')}
              className="h-12 w-full rounded-[10px] border border-hair-strong text-[15px] font-medium text-ink active:bg-surface"
            >
              Clôturer la séance
            </button>
          </div>
        </main>
      )}

      {tab === 'salle' && editing && editingEx && (
        <div ref={sheetRef} className="sticky bottom-0 z-30 mt-auto">
          <NumberPad
            exerciseName={editingEx.name}
            order={editing.order}
            isCorrection={editing.order <= logsOf(editingEx.id).length}
            reference={refAt(editingEx, editing.order)}
            referenceDate={editingEx.reference?.date ?? null}
            prefillNote={prefillNote}
            draft={draft}
            field={editing.field}
            onField={(f) => {
              setEditing({ ...editing, field: f });
              setDraft((d) => ({ ...d, fresh: true }));
            }}
            onKey={(k) => setDraft((d) => pressKey(d, editing.field, k))}
            onValidate={() => {
              const vals = parseDraft(draft);
              if (vals) commit(editingEx.id, editing.order, vals);
            }}
            onClose={() => setEditing(null)}
          />
        </div>
      )}
    </div>
  );
}

function ExerciseBlock({
  ex,
  done,
  skipped,
  focused,
  editing,
  draft,
  flash,
  onOpen,
  onQuickLog,
  onResume,
}: {
  ex: ExercisePlan;
  done: SetVals[];
  skipped: boolean;
  focused: boolean;
  editing: Editing | null;
  draft: Draft;
  flash: string | null;
  onOpen: (order: number, field: Field) => void;
  onQuickLog: (order: number) => void;
  onResume: () => void;
}) {
  const prescription = `${range(ex.sets)} × ${range(ex.reps)} · RIR ${range(ex.rir)}`;
  const complete = done.length >= ex.sets[0];
  const status = skipped
    ? 'sauté'
    : complete
      ? `fait, ${done.length} séries`
      : focused || done.length > 0
        ? `en cours, ${done.length} sur ${ex.sets[0]}`
        : 'à faire';

  if (skipped) {
    return (
      <section className="border-b border-hair-strong px-4 py-3" aria-label={`${ex.name}, sauté`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-semibold text-ink-muted line-through decoration-1">
              {ex.name}
            </h2>
            <p className="text-[13px] tabular-nums text-ink-muted">
              {prescription} · sauté
            </p>
          </div>
          <button
            type="button"
            onClick={onResume}
            className="h-11 shrink-0 rounded-[8px] border border-hair-strong px-3.5 text-[14px] text-ink active:bg-surface"
          >
            Reprendre
          </button>
        </div>
      </section>
    );
  }

  const rows = Math.max(ex.sets[0], done.length);
  const canAddOptional = done.length >= ex.sets[0] && done.length < ex.sets[1];
  const optionalOrder = rows + 1;
  const nextOrder = done.length + 1;

  return (
    <section className="border-b border-hair-strong" aria-label={ex.name}>
      <div className="flex items-baseline justify-between gap-3 px-4 pb-1.5 pt-3.5">
        <h2 className="min-w-0 truncate text-[16px] font-semibold tracking-[-0.01em]">{ex.name}</h2>
        <span className={`shrink-0 text-[13px] tabular-nums ${focused ? 'font-medium text-ink' : 'text-ink-muted'}`}>
          {status}
        </span>
      </div>
      <p className="px-4 pb-2 text-[13px] tabular-nums text-ink-muted">
        {prescription}
        {ex.reference ? ` · réf. ${fmtDate(ex.reference.date)}` : ' · pas de référence'}
      </p>

      {Array.from({ length: rows }, (_, i) => i + 1).map((order) => {
        const logged = done[order - 1];
        const ref = refAt(ex, order);
        const isEditing = editing?.order === order;
        const key = `${ex.id}-${order}`;
        if (logged && !isEditing) {
          return (
            <DoneRow
              key={key}
              id={`vb-row-${key}`}
              order={order}
              vals={logged}
              refVals={ref}
              flash={flash === key}
              onOpen={(f) => onOpen(order, f)}
            />
          );
        }
        const isNext = order === nextOrder;
        return (
          <GhostRow
            key={key}
            id={`vb-row-${key}`}
            order={order}
            refVals={ref}
            current={isNext && focused}
            editing={isEditing ? editing : null}
            draft={draft}
            onOpen={(f) => onOpen(order, f)}
            onQuickLog={() => onQuickLog(order)}
          />
        );
      })}

      {canAddOptional &&
        (editing?.order === optionalOrder ? (
          <GhostRow
            id={`vb-row-${ex.id}-${optionalOrder}`}
            order={optionalOrder}
            refVals={refAt(ex, optionalOrder)}
            current
            editing={editing}
            draft={draft}
            onOpen={(f) => onOpen(optionalOrder, f)}
            onQuickLog={() => onQuickLog(optionalOrder)}
          />
        ) : (
          <button
            type="button"
            id={`vb-row-${ex.id}-${optionalOrder}`}
            onClick={() => onOpen(optionalOrder, 'w')}
            className={`${GRID} h-11 w-full border-t border-hair px-4 text-left text-[13px] text-ink-muted active:bg-surface`}
          >
            <span className="readout">{optionalOrder}</span>
            <span className="col-span-5">
              série facultative
              {refAt(ex, optionalOrder)
                ? ` · réf. ${fmtSet(refAt(ex, optionalOrder) as SetVals)}`
                : ', pas de réf. à ce rang'}
            </span>
          </button>
        ))}
    </section>
  );
}

function Delta({ vals, refVals }: { vals: SetVals; refVals: SetVals | undefined }) {
  const d = deltaVsRef(vals, refVals);
  if (d === null) return <span className="text-right text-[13px] text-ink-muted">sans réf.</span>;
  const t = trendOf(d, 0);
  return (
    <span className={`readout text-right text-[13px] ${TREND_CLASS[t]}`}>
      {TREND_SIGN[t]} {signed1(d)}
    </span>
  );
}

function DoneRow({
  id,
  order,
  vals,
  refVals,
  flash,
  onOpen,
}: {
  id: string;
  order: number;
  vals: SetVals;
  refVals: SetVals | undefined;
  flash: boolean;
  onOpen: (f: Field) => void;
}) {
  return (
    <button
      type="button"
      id={id}
      onClick={() => onOpen('w')}
      aria-label={`Série ${order} loggée : ${kg(vals.weightKg)} kg, ${vals.reps} reps, RIR ${vals.rir}. Corriger`}
      className={`${GRID} h-[45px] w-full scroll-mt-28 border-t border-hair px-4 text-left active:bg-surface ${
        flash ? 'vb-logged' : ''
      }`}
    >
      <span className="readout text-[13px] text-ink-muted">{order}</span>
      <span className="readout truncate text-[13px] text-ink-muted">{refVals ? fmtSet(refVals) : '·'}</span>
      <span className="readout text-right text-[16px] font-medium">{kg(vals.weightKg)}</span>
      <span className="readout text-right text-[16px] font-medium">{vals.reps}</span>
      <span className="readout text-right text-[16px] font-medium">{vals.rir}</span>
      <Delta vals={vals} refVals={refVals} />
    </button>
  );
}

function GhostRow({
  id,
  order,
  refVals,
  current,
  editing,
  draft,
  onOpen,
  onQuickLog,
}: {
  id: string;
  order: number;
  refVals: SetVals | undefined;
  current: boolean;
  editing: Editing | null;
  draft: Draft;
  onOpen: (f: Field) => void;
  onQuickLog: () => void;
}) {
  const ghost: Record<Field, string> = editing
    ? { w: draft.w, r: draft.r, i: draft.i }
    : {
        w: refVals ? kg(refVals.weightKg) : '',
        r: refVals ? String(refVals.reps) : '',
        i: refVals ? String(refVals.rir) : '',
      };
  const live = editing ? parseDraft(draft) : null;
  const tall = current || !!editing;

  const cell = (f: Field) => {
    const active = editing?.field === f;
    return (
      <button
        key={f}
        type="button"
        onClick={() => onOpen(f)}
        aria-label={`${f === 'w' ? 'Poids' : f === 'r' ? 'Reps' : 'RIR'} de la série ${order}`}
        className={`readout flex h-full items-center justify-end text-[16px] ${
          active
            ? 'font-medium text-accent-ink underline decoration-accent decoration-2 underline-offset-[7px]'
            : editing
              ? 'font-medium text-ink'
              : current
                ? 'text-ink-muted underline decoration-dotted decoration-1 underline-offset-[7px]'
                : 'text-ink-muted'
        }`}
      >
        {ghost[f] === '' ? ' ' : ghost[f]}
      </button>
    );
  };

  return (
    <div
      id={id}
      className={`${GRID} w-full scroll-mt-28 border-t border-hair px-4 ${tall ? 'h-14' : 'h-[45px]'} ${
        editing ? 'bg-surface-2' : tall ? 'bg-surface' : ''
      }`}
    >
      <span className={`readout text-[13px] ${tall ? 'font-semibold text-ink' : 'text-ink-muted'}`}>
        {order}
      </span>
      <button
        type="button"
        onClick={() => onOpen('w')}
        className={`flex h-full items-center truncate text-left text-[13px] text-ink-muted ${refVals ? 'readout' : ''}`}
      >
        {refVals ? fmtSet(refVals) : 'pas de réf.'}
      </button>
      {cell('w')}
      {cell('r')}
      {cell('i')}
      <span className="flex justify-end">
        {editing ? (
          live ? (
            <Delta vals={live} refVals={refVals} />
          ) : null
        ) : current ? (
          refVals ? (
            <button
              type="button"
              onClick={onQuickLog}
              aria-label={`Valider la série ${order} à l'identique de la référence`}
              className="h-11 w-[78px] rounded-[8px] bg-ink text-[14px] font-semibold text-bg active:opacity-85"
            >
              Valider
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpen('w')}
              className="h-11 w-[78px] rounded-[8px] border border-hair-strong text-[14px] font-medium text-ink active:bg-surface-2"
            >
              Saisir
            </button>
          )
        ) : null}
      </span>
    </div>
  );
}
