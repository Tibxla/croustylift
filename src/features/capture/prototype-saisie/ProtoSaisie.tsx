// PROTOTYPE JETABLE · plan (tour 2, 25/11) : A d'origine et trois déclinaisons
// de A (A1 Allégée, A2 Côte à côte, A3 Pied léger), sur l'instrument réel et les
// vraies données du compte, choisies par `?variant=A|A1|A2|A3` et la barre de
// bascule ; sans paramètre, l'écran actuel ; glissé depuis le bord gauche vers
// le Sommaire commun à toutes ; AUCUNE écriture en base (bouchons). Le tour 1
// (B Tableau, C Étapes, D Trois cadrans) est au commit a4b83b8.
//
// Ce composant remplace `CapturePanel` quand une variante est choisie : il porte
// le brouillon commun (`useSaisieProto`), la barre du pouce (copie de celle de
// CapturePanel, mêmes places), les feuilles de correction et de notes, et des
// bouchons à la place de chaque écriture : Logger, Annuler, corriger, changer de
// côté, supprimer, notes, Terminer. Un Logger bouchonné ajoute la série à une
// surcouche EN MÉMOIRE (perdue au changement d'exo) pour qu'on voie la série
// suivante s'ouvrir ; la barre de bascule dit ce qui aurait été écrit.
import { useCallback, useMemo, useState, type Dispatch } from 'react';
import { isBlankNote } from '../../../domain/notes';
import type { PerformedSet, Side } from '../../../domain/types';
import { PrimaryButton, useCompact, useCompactTight } from '../../../ui';
import type { IndexItem } from '../ExerciseIndex';
import type { SessionExercise } from '../fixtures';
import { NotesSheet } from '../NotesSheet';
import { SetEditSheet } from '../SetEditSheet';
import { nextSetOrder, type CaptureAction, type ExerciseProgress } from '../state';
import { EdgeSwipeBack } from './EdgeSwipeBack';
import { setText } from './parts';
import { useSaisieProto, type Saisie } from './useSaisieProto';
import { protoSay, type VariantKey } from './variant';
import { VariantA } from './VariantA';
import { VariantA1 } from './VariantA1';
import { VariantA2 } from './VariantA2';
import { VariantA4 } from './VariantA4';

export interface VariantProps {
  s: Saisie;
  exercise: SessionExercise;
  /** Le réalisé, surcouche du prototype comprise. */
  progress: ExerciseProgress;
  index: IndexItem[];
  /** Rang de l'exo dans la séance et leur nombre. */
  exoPos: { n: number; total: number };
  compact: boolean;
  tight: boolean;
  onPick: (exerciseId: string) => void;
  onEdit: (setId: string) => void;
  onNotes: () => void;
  hasNote: boolean;
}

const BAR_BTN =
  'ui-press flex h-12 min-w-0 flex-col items-start justify-center rounded-block border-[1.5px] border-ink bg-raise px-2.5 text-left active:bg-line [@media(max-width:339px)]:px-2';
const BAR_TITLE = 'w-full truncate whitespace-nowrap text-[16px] font-medium leading-tight text-ink [@media(max-width:339px)]:text-[15px]';
const BAR_GRID = 'mb-1.5 grid grid-cols-[1fr_minmax(56px,76px)_1fr] gap-2 [@media(max-width:339px)]:grid-cols-[1fr_minmax(48px,60px)_1fr]';

const sideWord = (s: Side) => (s === 'left' ? 'gauche' : 'droite');

function logLabel(side: Side | null, rank: number, plannedMax: number): string {
  if (side) return `Logger ${sideWord(side)} · série ${rank}`;
  return rank > plannedMax ? 'Logger une de plus' : `Logger la série ${rank}`;
}

export function ProtoSaisie({
  variant,
  exercise: realExercise,
  progress: real,
  index,
  next,
  done,
  total,
  canFinish,
  datedNote,
  dispatch,
}: {
  variant: Exclude<VariantKey, 'actuel'>;
  exercise: SessionExercise;
  progress: ExerciseProgress;
  index: IndexItem[];
  next: { exerciseId: string; name: string; resume: string | null } | null;
  done: number;
  total: number;
  canFinish: boolean;
  datedNote: string;
  dispatch: Dispatch<CaptureAction>;
}) {
  // `&uni=1` : l'exo affiché passe en unilatéral, pour voir le choix du côté
  // dans chaque variante sans toucher au catalogue (le compte de test n'en a pas).
  const exercise = useMemo(
    () => (new URLSearchParams(window.location.search).get('uni') === '1' ? { ...realExercise, unilateral: true } : realExercise),
    [realExercise],
  );
  // Surcouche en mémoire : les séries « loggées » par le bouchon.
  const [fake, setFake] = useState<{ sets: PerformedSet[]; ids: string[] }>({ sets: [], ids: [] });
  const progress = useMemo<ExerciseProgress>(
    () => ({ ...real, sets: [...real.sets, ...fake.sets], setIds: [...real.setIds, ...fake.ids] }),
    [real, fake],
  );
  const s = useSaisieProto(exercise, progress);
  const compact = useCompact();
  const tight = useCompactTight();
  const [editId, setEditId] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const closeEdit = useCallback(() => setEditId(null), []);
  const closeNotes = useCallback(() => setNotesOpen(false), []);
  const isFake = (id: string) => fake.ids.includes(id);

  const log = () => {
    const side = s.side ?? undefined;
    const set: PerformedSet = { order: nextSetOrder(progress, side), weightKg: s.weightKg, reps: s.reps, rir: s.rir, side };
    setFake((f) => ({ sets: [...f.sets, set], ids: [...f.ids, `proto-${Date.now()}`] }));
    protoSay(`Bouchon · Logger écrirait la série ${s.rank}${side ? ` ${sideWord(side)}` : ''} : ${setText(set)}. Rien n'est envoyé, la série vit en mémoire.`);
  };
  const lastSet = progress.sets[progress.sets.length - 1] ?? null;
  const undo = () => {
    if (fake.sets.length > 0) {
      setFake((f) => ({ sets: f.sets.slice(0, -1), ids: f.ids.slice(0, -1) }));
      protoSay('Bouchon · Annuler retirerait la dernière série. Retirée de la mémoire du prototype.');
    } else if (lastSet) {
      protoSay(`Bouchon · Annuler supprimerait la série ${lastSet.order}${lastSet.side ? ` ${sideWord(lastSet.side)}` : ''} (${setText(lastSet)}). Rien n'est supprimé.`);
    }
  };

  const exoN = Math.max(1, index.findIndex((it) => it.exerciseId === exercise.exerciseId) + 1);
  const hasNote =
    !isBlankNote(datedNote) || !isBlankNote(exercise.perExerciseNote) || !!(exercise.previousDatedNote && !isBlankNote(exercise.previousDatedNote.body));
  const vp: VariantProps = {
    s,
    exercise,
    progress,
    index,
    exoPos: { n: exoN, total: index.length },
    compact,
    tight,
    onPick: (id) => dispatch({ type: 'open-exercise', exerciseId: id }),
    onEdit: setEditId,
    onNotes: () => setNotesOpen(true),
    hasNote,
  };
  const label = logLabel(s.side, s.rank, s.plannedMax);
  const values = setText(s);

  return (
    <EdgeSwipeBack onBack={() => dispatch({ type: 'back-to-picker' })}>
      {variant === 'A' && <VariantA {...vp} />}
      {variant === 'A1' && <VariantA1 {...vp} />}
      {variant === 'A2' && <VariantA2 {...vp} />}
      {/* A3 : le corps de A1, seul le pied change (plus bas). */}
      {variant === 'A3' && <VariantA1 {...vp} />}
      {variant === 'A4' && <VariantA4 {...vp} />}

      <div data-zone="pied" className="sticky bottom-0 z-10 mt-auto bg-bg px-5 pb-[calc(0.75rem+var(--safe-bottom))] pt-1 [@media(max-height:700px)]:pb-[calc(0.5rem+var(--safe-bottom))]">
        {variant === 'A3' || variant === 'A4' ? (
          // Pied léger : deux liens soulignés à place fixe (cibles de 44 px),
          // Annuler au milieu ; seul Logger reste un bloc plein.
          <div className="mb-1 grid h-11 grid-cols-[1fr_auto_1fr] items-center gap-2">
            <button
              type="button"
              onClick={() => dispatch({ type: 'back-to-picker' })}
              aria-label={`Sommaire de la séance, ${done} sur ${total} faits`}
              className="-ml-2 flex h-11 min-w-0 items-baseline justify-self-start whitespace-nowrap px-2 text-[16px] text-ink active:opacity-70"
              style={{ alignItems: 'center' }}
            >
              <span className="underline decoration-1 underline-offset-4">‹ Sommaire</span>
              <span className="tnum ml-1.5 text-[14px] text-muted">
                {done}/{total}
              </span>
            </button>
            {lastSet ? (
              <button type="button" onClick={undo} aria-label="Annuler la dernière série" className="flex h-11 items-center px-2 text-[15px] text-muted underline decoration-1 underline-offset-4 active:opacity-70">
                Annuler
              </button>
            ) : (
              <span aria-hidden />
            )}
            {next ? (
              <button
                type="button"
                onClick={() => dispatch({ type: 'open-exercise', exerciseId: next.exerciseId })}
                aria-label={`Exo suivant, ${next.name}`}
                className="-mr-2 flex h-11 items-center justify-self-end whitespace-nowrap px-2 text-[16px] text-ink underline decoration-1 underline-offset-4 active:opacity-70"
              >
                Exo suivant ›
              </button>
            ) : canFinish ? (
              <button
                type="button"
                onClick={() => protoSay('Bouchon · Terminer ouvrirait la fin de séance (rien n’est enregistré ici).')}
                className="-mr-2 flex h-11 items-center justify-self-end px-2 text-[16px] text-ink underline decoration-1 underline-offset-4"
              >
                Terminer ›
              </button>
            ) : (
              <span aria-hidden />
            )}
          </div>
        ) : (
        <div className={BAR_GRID}>
          <button type="button" onClick={() => dispatch({ type: 'back-to-picker' })} aria-label={`Sommaire de la séance, ${done} sur ${total} faits`} className={BAR_BTN}>
            <span className={BAR_TITLE}>Sommaire</span>
            <span className="tnum w-full truncate text-[13px] leading-tight text-muted">
              {done} sur {total} faits
            </span>
          </button>
          {lastSet ? (
            <button type="button" onClick={undo} aria-label="Annuler la dernière série" className="flex h-12 min-w-0 flex-col items-center justify-center px-1 text-center active:opacity-70">
              <span className="text-[16px] leading-tight text-ink underline decoration-1 underline-offset-4">Annuler</span>
              <span className="tnum truncate text-[13px] leading-tight text-muted">{lastSet.side ? sideWord(lastSet.side) : `série ${lastSet.order}`}</span>
            </button>
          ) : (
            <span aria-hidden />
          )}
          {next ? (
            <button type="button" onClick={() => dispatch({ type: 'open-exercise', exerciseId: next.exerciseId })} aria-label={`Exo suivant, ${next.name}`} className={BAR_BTN}>
              <span className={BAR_TITLE}>Exo suivant</span>
              <span className="w-full truncate text-[13px] leading-tight text-muted">{next.name}</span>
            </button>
          ) : canFinish ? (
            <button type="button" onClick={() => protoSay('Bouchon · Terminer ouvrirait la fin de séance (rien n’est enregistré ici).')} className={BAR_BTN}>
              <span className={BAR_TITLE}>Terminer</span>
              <span className="truncate text-[13px] leading-tight text-muted">la séance</span>
            </button>
          ) : (
            <span aria-hidden />
          )}
        </div>
        )}
        <PrimaryButton over={label} ariaLabel={`${label}, ${values}`} press={false} onClick={log} className="w-full [@media(max-height:800px)]:h-12">
          <span className="tnum">{values}</span>
        </PrimaryButton>
      </div>

      {editId !== null && progress.setIds.includes(editId) && (
        <SetEditSheet
          key={editId}
          exercise={exercise}
          progress={progress}
          setId={editId}
          onSave={(values) => {
            if (isFake(editId)) {
              const i = fake.ids.indexOf(editId);
              setFake((f) => ({ ...f, sets: f.sets.map((x, j) => (j === i ? { ...x, ...values } : x)) }));
            }
            protoSay(`Bouchon · la correction écrirait ${JSON.stringify(values).replace(/"/g, '')}. ${isFake(editId) ? 'Appliquée en mémoire.' : 'Rien n’est envoyé.'}`);
          }}
          onChangeSide={(side) => protoSay(`Bouchon · la série passerait côté ${sideWord(side)}. Rien n’est envoyé.`)}
          onDelete={() => {
            if (isFake(editId)) {
              const i = fake.ids.indexOf(editId);
              setFake((f) => ({ sets: f.sets.filter((_, j) => j !== i), ids: f.ids.filter((_, j) => j !== i) }));
            }
            protoSay(`Bouchon · Supprimer effacerait cette série. ${isFake(editId) ? 'Retirée de la mémoire.' : 'Rien n’est supprimé.'}`);
            setEditId(null);
          }}
          onClose={closeEdit}
        />
      )}
      <NotesSheet
        key={`notes-${exercise.exerciseId}`}
        open={notesOpen}
        onClose={closeNotes}
        name={exercise.name}
        datedNote={datedNote}
        previous={exercise.previousDatedNote ?? null}
        instructions={exercise.perExerciseNote}
        onSaveDatedNote={() => protoSay('Bouchon · la note du jour serait enregistrée. Rien n’est envoyé.')}
        onSaveInstructions={() => protoSay('Bouchon · la note d’instructions serait enregistrée. Rien n’est envoyé.')}
      />
    </EdgeSwipeBack>
  );
}
