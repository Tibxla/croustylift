// Feuille de correction d'UNE série loggée, ouverte en touchant sa case dans la
// bande (SetBand). Mêmes contrôles que l'instrument, sans clavier imposé : la
// lecture du poids (la toucher ouvre le clavier numérique, comme en salle), la
// règle, reps et RIR en un tap. Au-dessus, la Référence du rang corrigé (et du
// côté en unilatéral) ; sous la règle, le badge que la bande affichera, recalculé
// en direct par le même calcul que l'instrument (`computeSetBadges`).
//
// « Enregistrer » en bloc principal (rien ne change : la feuille se ferme sans
// écrire). « Supprimer la série » en lien, confirmé : l'option sûre est le
// bouton (« Garder la série »), la suppression un lien qui dit ce qui part et
// que les suivantes remontent d'un rang (ADR 0024). En unilatéral, on corrige le
// côté touché, et la suppression retire la série entière, gauche et droite,
// quand elles forment une paire sans ambiguïté (sinon le côté touché seul). Le
// message suit la règle du geste (`deletionPreview`, set-ranks.ts).
//
// La série est visée par son id, jamais par sa place : si elle disparaît pendant
// que la feuille est ouverte (réponse tardive de la base), le parent ne la monte
// plus. Montée par clé (id de la ligne) : ses valeurs repartent de la série.
import { useMemo, useState } from 'react';
import type { PerformedSet, Side } from '../../domain/types';
import { useReglages } from '../../settings/reglages';
import { NumberRow, PrimaryButton, Ruler, SecondaryButton, Sheet, Status, TextLink } from '../../ui';
import type { SessionExercise } from './fixtures';
import { formatWeight } from './format';
import { badgeStatus, computeSetBadges, computeSetBadgesBySide } from './set-badges';
import type { SetEntry } from './set-gestures';
import { deletionPreview } from './set-ranks';
import type { ExerciseProgress } from './state';
import { roundWeightKg } from './stepper-utils';
import { WeightReadout } from './WeightReadout';
import { weightGraduations } from './weight-graduations';

const REPS_ROW_MAX = 50;
const RIR_ROW_MAX = 10;
const RULER_MAX_KG = 500;

const sideWord = (s: Side) => (s === 'left' ? 'gauche' : 'droite');
const values = (s: SetEntry) => `${formatWeight(s.weightKg)} × ${s.reps} · RIR ${s.rir}`;


export function SetEditSheet({
  exercise,
  progress,
  setId,
  onSave,
  onDelete,
  onClose,
}: {
  exercise: SessionExercise;
  progress: ExerciseProgress;
  /** La ligne corrigée (présente dans `progress`, cf. le parent). */
  setId: string;
  /** Enregistre ce que l'utilisateur a RÉGLÉ, et cela seul (le parent ne fait rien si rien ne change). */
  onSave: (values: Partial<SetEntry>) => void;
  /** Supprime la série de cette ligne (les deux côtés d'une paire unilatérale). */
  onDelete: () => void;
  onClose: () => void;
}) {
  const index = progress.setIds.indexOf(setId);
  const orig = progress.sets[index] as PerformedSet;
  // Ce que l'utilisateur a réglé, colonne par colonne. Une colonne qu'il n'a pas
  // touchée suit la ligne : si une réponse tardive de la base la change pendant
  // que la feuille est ouverte, c'est la nouvelle valeur qui s'affiche, et elle
  // n'est pas réécrite à l'enregistrement.
  const [edits, setV] = useState<Partial<SetEntry>>({});
  const v = useMemo<SetEntry>(
    () => ({ weightKg: orig.weightKg, reps: orig.reps, rir: orig.rir, ...edits }),
    [orig.weightKg, orig.reps, orig.rir, edits],
  );
  const [ask, setAsk] = useState(false);
  const { stepKg } = useReglages();

  const unilateral = exercise.unilateral ?? false;
  const side = orig.side ?? null;
  // Le rang LU est la place de la série dans la bande (rangs distincts, triés),
  // comme la bande le numérote ; la Référence et le badge se lisent sur `order`,
  // comme `computeSetBadges`. Les deux coïncident sauf trou laissé ailleurs.
  const rank = [...new Set(progress.sets.map((s) => s.order))].sort((a, b) => a - b).indexOf(orig.order) + 1;
  const ref = exercise.reference?.find((r) => r.order === orig.order && r.side === orig.side) ?? null;

  // Le badge APRÈS correction : les séries de l'exo, celle-ci aux valeurs réglées.
  const badge = useMemo(() => {
    const sets = progress.sets.map((s, i) => (i === index ? { ...s, ...v } : s));
    const badges = unilateral
      ? computeSetBadgesBySide(
          sets,
          exercise.reference ?? null,
          exercise.personalRecordBySide ?? {
            left: { bestE1rm: null, bestE1rmSet: null, bestWeightReps: null },
            right: { bestE1rm: null, bestE1rmSet: null, bestWeightReps: null },
          },
        )
      : computeSetBadges(sets, exercise.reference ?? null, exercise.personalRecord ?? null);
    return badgeStatus(badges[index] ?? null);
  }, [progress.sets, index, v, unilateral, exercise.reference, exercise.personalRecord, exercise.personalRecordBySide]);

  // Ce que la suppression emporte, selon la règle du geste (`deletionPreview`) :
  // ses deux côtés seulement pour une paire sans ambiguïté, et les suivantes ne
  // remontent que si le rang se vide.
  const { bothSides, movedRanks: later } = deletionPreview(progress.sets, index);
  const what = side ? `Série ${rank}, ${sideWord(side)}` : `Série ${rank}`;
  const changed = v.weightKg !== orig.weightKg || v.reps !== orig.reps || v.rir !== orig.rir;
  const { majorEvery, midEvery } = weightGraduations(stepKg);

  const gone =
    bothSides
      ? `La série ${rank} sera supprimée, gauche et droite.`
      : `La série ${rank} (${side ? `${sideWord(side)}, ` : ''}${values(orig)}) sera supprimée.`;
  const moves =
    later > 0
      ? ` ${later > 1 ? `Les ${later} suivantes remontent` : 'La suivante remonte'} d’un rang.`
      : '';

  return (
    <Sheet
      open
      title={ask ? `Supprimer la série ${rank} ?` : `${what} · ${exercise.name}`}
      onClose={onClose}
      footer={
        ask ? undefined : (
          <PrimaryButton
            meta={values(v)}
            ariaLabel={`Enregistrer la série ${rank}${side ? ` ${sideWord(side)}` : ''}, ${values(v)}`}
            onClick={() => {
              if (changed) onSave(edits);
              onClose();
            }}
          >
            Enregistrer
          </PrimaryButton>
        )
      }
    >
      {ask ? (
        <div className="px-5 pb-2 pt-1">
          <p className="max-w-[36ch] text-[16px] leading-[1.45] text-ink">
            {gone}
            {moves}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <SecondaryButton onClick={() => setAsk(false)}>Garder la série</SecondaryButton>
            <TextLink tone="muted" ariaLabel={`Confirmer la suppression de la série ${rank}`} onClick={onDelete}>
              Supprimer la série
            </TextLink>
          </div>
        </div>
      ) : (
        <div className="pb-1">
          <p className="flex items-baseline justify-between gap-3 px-5 text-[14px]">
            {ref ? (
              <>
                <span className="text-muted">réf. série {rank}{side ? ` ${sideWord(side)}` : ''}</span>
                <span className="tnum font-medium text-ink">{values(ref)}</span>
              </>
            ) : (
              <span className="text-muted">
                {exercise.reference ? `Série ${rank} : rien à battre` : 'Pas encore de réf. dans cette séance'}
              </span>
            )}
          </p>
          <WeightReadout value={v.weightKg} onChange={(kg) => setV((p) => ({ ...p, weightKg: roundWeightKg(kg) }))} />
          <div className="mt-1">
            <Ruler
              key={stepKg}
              label="Poids de la série"
              steps={v.weightKg / stepKg}
              max={Math.max(Math.round(RULER_MAX_KG / stepKg), Math.ceil(v.weightKg / stepKg))}
              pxPerStep={Math.max(8, 11.2 * stepKg)}
              isMajor={(s) => s % majorEvery === 0}
              isMid={(s) => midEvery > 0 && s % midEvery === 0}
              majorLabel={(s) => formatWeight(s * stepKg)}
              format={(s) => `${formatWeight(roundWeightKg(s * stepKg))} kg`}
              onChange={(s) => setV((p) => ({ ...p, weightKg: roundWeightKg(s * stepKg) }))}
            />
          </div>
          {/* Le badge que la bande affichera, recalculé à chaque réglage. */}
          <p className="flex min-h-7 items-center gap-3 px-5 text-[14px]" aria-live="polite">
            {badge ? (
              <Status v={badge.v} word={badge.word} />
            ) : ref ? (
              <Status v="down" word="en deçà de la réf." />
            ) : null /* rien à juger : la ligne du haut le dit déjà, la place reste */}
          </p>
          <div className="mt-1 flex flex-col gap-0.5">
            <NumberRow
              label="Reps"
              min={1}
              max={Math.max(REPS_ROW_MAX, v.reps, exercise.prescription.reps.max)}
              value={v.reps}
              presc={[exercise.prescription.reps.min, exercise.prescription.reps.max]}
              refValue={ref?.reps ?? null}
              onPick={(n) => setV((p) => ({ ...p, reps: n }))}
            />
            <NumberRow
              label="RIR"
              min={0}
              max={Math.max(RIR_ROW_MAX, v.rir, exercise.prescription.rir.max)}
              value={v.rir}
              presc={[exercise.prescription.rir.min, exercise.prescription.rir.max]}
              refValue={ref?.rir ?? null}
              onPick={(n) => setV((p) => ({ ...p, rir: n }))}
            />
          </div>
          <div className="px-5 pt-1">
            <TextLink tone="muted" ariaLabel={`Supprimer la série ${rank}`} onClick={() => setAsk(true)}>
              Supprimer la série
            </TextLink>
          </div>
        </div>
      )}
    </Sheet>
  );
}
