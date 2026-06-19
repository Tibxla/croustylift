// Panneau de capture d'un exo. Nom = roi ; « dernière fois » = co-roi à battre ;
// saisie par steppers au pouce ; « Logger la série » en 1 tap.
import { useEffect, useMemo, useState } from 'react';
import { estimateE1rm } from '../../domain/e1rm';
import {
  currentSetOrder,
  defaultSide,
  sidesDoneAt,
  weakSideE1rm,
} from '../../domain/unilateral';
import { deriveDeviations } from '../../domain/deviation';
import { isBlankNote } from '../../domain/notes';
import { isE1rmRecord, isWeightRepsRecord, type PersonalRecord } from '../../domain/pr';
import type { PerformedSet, Side } from '../../domain/types';
import type { SessionExercise } from './fixtures';
import type { ExerciseProgress } from './state';
import { resolveExerciseNoteSave } from './state';
import { Stepper } from './Stepper';
import { seedDraft } from './capture-seed';
import { NoteField } from '../notes/NoteField';
import { DeviationBadge, deviationVisual } from './DeviationBadge';
import { formatE1rm, formatPrescription, formatSet, formatRange, formatWeight } from './format';

interface ExerciseCaptureProps {
  exercise: SessionExercise;
  progress: ExerciseProgress;
  /** Corps de la note datée du jour pour cet exo (issue #26), '' si aucune. */
  datedNote: string;
  onUndoLast: () => void;
  onSkip: () => void;
  onBack: () => void;
  /**
   * Remonte le brouillon de la série courante vers la barre d'action fixe (qui
   * commit). Pour un exo unilatéral, `side` porte le côté choisi (issue #63).
   */
  onDraftChange: (draft: {
    weightKg: number;
    reps: number;
    rir: number;
    side?: Side;
  }) => void;
  /** Enregistre la note datée du jour (corps vidé = note effacée). */
  onSaveDatedNote: (body: string) => void;
  /**
   * Enregistre la note d'INSTRUCTIONS de l'exo, éditée sur place (issue #52).
   * Corps vidé = note supprimée. La persistance + la MAJ optimiste sont gérées
   * par le parent ; ici on remonte juste le corps saisi.
   */
  onSaveExerciseNote: (body: string) => void;
}

const WEIGHT_STEP = 2.5;
const WEIGHT_FINE = 1.25;

export function ExerciseCapture({
  exercise,
  progress,
  datedNote,
  onUndoLast,
  onSkip,
  onBack,
  onDraftChange,
  onSaveDatedNote,
  onSaveExerciseNote,
}: ExerciseCaptureProps) {
  const { prescription, reference, perExerciseNote } = exercise;
  const loggedCount = progress.sets.length;

  // Logging unilatéral (issue #46, sélecteur #63) : une série se complète quand
  // ses DEUX côtés sont loggés au même set_order, dans l'ordre qu'on veut.
  // L'utilisateur CHOISIT le côté (sélecteur G/D plus bas) ; `currentSide` porte
  // ce choix. Le compteur de SÉRIES complètes (= saisies droites loggées : toute
  // série complète a un droit, peu importe l'ordre) sert au compteur, à la cible
  // « à battre » et au statut de fin. Bilatéral : currentSide null, une saisie =
  // une série.
  const unilateral = exercise.unilateral ?? false;
  const completedSets = unilateral
    ? progress.sets.filter((s) => s.side === 'right').length
    : loggedCount;

  // Côté CHOISI pour la prochaine saisie (issue #63). Amorcé sur le côté MANQUANT
  // de la série en cours (`defaultSide`) ; ré-amorcé au changement d'exo ou après
  // un log/annulation (même déclencheur que le brouillon : exerciseId + loggedCount),
  // pour reproposer le côté qui reste à faire sans jamais le FORCER (l'utilisateur
  // peut basculer). Bilatéral : pas de côté, l'état n'est pas affiché.
  const [selectedSide, setSelectedSide] = useState<Side>(() => defaultSide(progress.sets));
  useEffect(() => {
    if (unilateral) setSelectedSide(defaultSide(progress.sets));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.exerciseId, loggedCount, unilateral]);
  const currentSide: Side | null = unilateral ? selectedSide : null;

  // Records personnels (issue #34), dérivés de l'historique. Une série loggée
  // AUJOURD'HUI qui dépasse le record est marquée « Record ». On compare au
  // record COURANT (historique + séries du jour déjà loggées avant elle) : ainsi
  // une seule série du jour porte le marqueur par mesure, pas toutes celles qui
  // battent l'ancien record. Récord absent (premier passage) = aucun marqueur,
  // pour ne pas crier « record » sur la toute première série jamais faite.
  const recordFlags = useMemo(
    () => computeRecordFlags(progress.sets, exercise.personalRecord ?? null),
    [progress.sets, exercise.personalRecord],
  );

  // Brouillon de la série courante (steppers), pré-rempli par `seedDraft` (issue
  // #58, logique pure testée) : poids reporté de la dernière série loggée dès la
  // 2ᵉ, reps cadrées sur la borne basse prescrite. Ré-amorcé au changement d'exo
  // ou au log/annulation d'une série (dépendances exerciseId + loggedCount).
  const seed = useMemo(
    () => seedDraft({ prescription, reference: reference ?? null, loggedSets: progress.sets }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exercise.exerciseId, loggedCount],
  );

  const [weightKg, setWeightKg] = useState(seed.weightKg);
  const [reps, setReps] = useState(seed.reps);
  const [rir, setRir] = useState(seed.rir);

  // Quand on change d'exo ou qu'on logge/annule une série, on ré-amorce le brouillon.
  useEffect(() => {
    setWeightKg(seed.weightKg);
    setReps(seed.reps);
    setRir(seed.rir);
  }, [seed]);

  // Remonte le brouillon courant vers la barre d'action fixe (qui commit le log).
  // Pour un exo unilatéral, on y joint le côté CHOISI (issue #63) : c'est ce côté
  // que la barre écrira, au bon set_order. Bilatéral : pas de côté.
  useEffect(() => {
    onDraftChange?.({ weightKg, reps, rir, side: currentSide ?? undefined });
  }, [weightKg, reps, rir, currentSide, onDraftChange]);

  // La série « à battre » à la position courante (co-roi). Masquée pour un exo
  // unilatéral (issue #46) : la comparaison par côté (G vs D) sort du périmètre
  // de la cible « dernière fois » par position.
  const refToBeat =
    unilateral ? null : reference?.find((s) => s.order === loggedCount + 1) ?? null;

  // Statut de fin (si au moins le minimum prescrit est atteint), en SÉRIES
  // complètes (une série unilatérale = gauche + droite). Le badge de déviation
  // reste cantonné au bilatéral (le diff prescription/réel par côté est hors #46).
  const reachedMin = completedSets >= prescription.sets.min;
  const deviations = deriveDeviations(prescription, progress.sets);
  const finishVisual = deviationVisual(deviations, prescription.sets, completedSets);

  // e1RM de la 1ʳᵉ série loggée (touche domaine, readout discret). Pour un exo
  // unilatéral, c'est le CÔTÉ FAIBLE de la 1ʳᵉ série (issue #46), aligné avec le
  // point de la courbe primaire (cf. weakSideE1rm). Bilatéral : e1RM simple.
  const firstE1rm = weakSideE1rm(progress.sets);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-32 pt-3">
      {/* Retour au sélecteur */}
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 mb-2 inline-flex items-center gap-1.5 self-start rounded-lg py-2 pr-3 text-sm font-medium text-ink-muted transition active:text-ink"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Tous les exercices
      </button>

      {/* Nom = roi */}
      <h2 className="text-3xl font-bold leading-tight tracking-tight text-ink">
        {exercise.name}
      </h2>

      {/* Cible prescrite */}
      <p className="readout mt-1.5 text-sm text-ink-muted">
        Cible{' '}
        {formatPrescription(prescription.sets, prescription.reps, prescription.rir)}
      </p>

      {/* Co-roi : « dernière fois » à battre */}
      <div className="mt-3 rounded-2xl bg-surface px-4 py-3">
        {refToBeat ? (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm text-ink-muted">À battre · dernière fois</span>
            <span className="readout text-base font-medium text-ink">
              {formatSet(refToBeat)}
            </span>
          </p>
        ) : reference ? (
          <p className="text-sm text-ink-muted">
            Dernière fois : <span className="readout">{reference.length}</span> séries
            seulement. Au-delà, surpasse-toi.
          </p>
        ) : (
          <p className="text-sm text-ink-muted">
            Premier passage sur cet exercice. Aucune référence à battre.
          </p>
        )}
      </div>

      {/* Note d'INSTRUCTIONS de l'exo (issue #52, ex-#26) : référence persistante,
          désormais repliable ET éditable sur place. key=exerciseId pour ré-amorcer
          le pli/brouillon au changement d'exo. L'info (en-tête, états) tient au
          texte + au glyphe, jamais à la couleur seule. */}
      <ExerciseNoteSection
        key={exercise.exerciseId}
        value={perExerciseNote}
        onSave={onSaveExerciseNote}
      />


      {/* Séries déjà loggées (mono, alignées) */}
      {loggedCount > 0 && (
        <ol className="mt-4 flex flex-col gap-1.5">
          {progress.sets.map((s, i) => {
            // Badges « battu »/record désactivés en unilatéral (issue #46) : la
            // comparaison par côté (et le record historique mêlant les côtés)
            // sort du périmètre. Le côté est porté par un libellé texte explicite.
            const beats =
              !unilateral &&
              refToBeatAt(reference, s.order) &&
              estimateE1rm(s.weightKg, s.reps, s.rir) >=
                estimateE1rm(
                  refToBeatAt(reference, s.order)!.weightKg,
                  refToBeatAt(reference, s.order)!.reps,
                  refToBeatAt(reference, s.order)!.rir,
                );
            const record = unilateral ? null : recordFlags[i];
            return (
              <li
                key={`${s.order}-${s.side ?? 'bi'}`}
                className="flex items-center gap-3 rounded-xl bg-surface px-4 py-2.5"
              >
                <span className="readout w-6 shrink-0 text-sm text-ink-muted tabular-nums">
                  {s.order}
                </span>
                {/* Côté (issue #46) : libellé texte, jamais la couleur seule. */}
                {s.side && (
                  <span className="w-6 shrink-0 text-xs font-semibold uppercase text-ink-muted">
                    {s.side === 'left' ? 'G' : 'D'}
                  </span>
                )}
                <span className="readout flex-1 text-base text-ink tabular-nums">
                  {formatSet(s)}
                </span>
                {/* Record (issue #34) : prime sur « battu » (un record bat déjà
                    la dernière fois). Accent violet — rare, mérité — + glyphe +
                    label : l'info ne tient jamais à la couleur seule. */}
                {record ? (
                  <RecordBadge kind={record} />
                ) : (
                  beats && (
                    <span
                      className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted"
                      title="Référence battue"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="text-accent-ink"
                      >
                        <path d="M12 19V5M6 11l6-6 6 6" />
                      </svg>
                      battu
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* e1RM de la 1ʳᵉ série + badge de fin. Le badge de déviation est cantonné
          au BILATÉRAL (issue #46) : en unilatéral, `progress.sets` porte 2 lignes
          par série (G+D), donc le diff prescription/réel par côté sort du périmètre
          (et un compte brut doublé fausserait le badge). On garde l'e1RM côté faible. */}
      {(firstE1rm != null || (reachedMin && !unilateral)) && (
        <div className="mt-3 flex items-center justify-between gap-3">
          {firstE1rm != null ? (
            <span className="text-sm text-ink-muted">
              {unilateral ? 'e1RM côté faible' : 'e1RM'}{' '}
              <span className="readout font-medium text-ink">{formatE1rm(firstE1rm)} kg</span>
            </span>
          ) : (
            <span />
          )}
          {reachedMin && !unilateral && <DeviationBadge visual={finishVisual} />}
        </div>
      )}

      {/* Compteur de série courante. En unilatéral, le numéro de série en cours
          est completedSets + 1 (une série = G + D) ; le côté à saisir est porté
          par le sélecteur ci-dessous, pas répété ici. */}
      <p className="mt-6 mb-3" aria-live="polite">
        <span className="text-sm font-medium text-ink-muted">
          Série{' '}
          <span className="readout text-ink">{completedSets + 1}</span> /{' '}
          <span className="readout text-ink">{formatRange(prescription.sets)}</span>
        </span>
      </p>

      {/* Sélecteur de côté (issue #63) : pour un exo unilatéral, l'utilisateur
          CHOISIT le côté à logger avant la saisie (il ne commence pas forcément
          à gauche). Au-dessus des steppers. Défaut = côté manquant de la série en
          cours. L'état sélectionné tient au texte + à la coche + à aria-pressed,
          jamais à la seule couleur (DESIGN.md). */}
      {currentSide && (
        <SideSelector
          value={currentSide}
          done={sidesDoneAt(progress.sets, currentSetOrder(progress.sets))}
          onChange={setSelectedSide}
        />
      )}

      {/* Saisie par steppers */}
      <div className="grid grid-cols-1 gap-4">
        <Stepper
          label="Poids"
          unit="kg"
          value={weightKg}
          step={WEIGHT_STEP}
          fineStep={WEIGHT_FINE}
          min={0}
          format={formatWeight}
          onChange={setWeightKg}
        />
        <div className="grid grid-cols-2 gap-4">
          <Stepper label="Reps" value={reps} step={1} min={1} onChange={setReps} />
          <Stepper label="RIR" value={rir} step={1} min={0} onChange={setRir} />
        </div>
      </div>

      {/* Actions secondaires */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {loggedCount > 0 && (
          <button
            type="button"
            onClick={onUndoLast}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-surface px-4 text-sm font-medium text-ink-muted transition active:bg-surface-2 active:text-ink"
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
              <path d="M9 14L4 9l5-5" />
              <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
            </svg>
            Annuler la dernière
          </button>
        )}
        <button
          type="button"
          onClick={onSkip}
          className="inline-flex h-11 items-center rounded-xl bg-surface px-4 text-sm font-medium text-ink-muted transition active:bg-surface-2 active:text-ink"
        >
          Passer l&apos;exercice
        </button>
      </div>

      {/* Retour à la liste des exos (issue #58). Affordance pleine largeur qui
          apparaît dès que le minimum prescrit est atteint (exo « terminé ») :
          c'est le moment d'enchaîner sur l'exo suivant sans friction. Surface-2
          (pas l'accent violet, réservé à « Logger la série » — One Voice Rule).
          Le retour amont (« Tous les exercices ») reste en haut pour quitter à
          tout moment ; celui-ci est l'enchaînement naturel de fin d'exo. */}
      {reachedMin && (
        <button
          type="button"
          onClick={onBack}
          className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-surface-2 text-base font-semibold text-ink transition active:scale-[0.99] active:bg-surface"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="shrink-0 text-ink-muted"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          Retour aux exercices
        </button>
      )}

      {/* Note DATÉE du jour (issue #26) : contexte de la perf d'aujourd'hui sur cet
          exo. Saisissable et consultable ici. Repliée par défaut (zéro-friction),
          on l'ouvre pour saisir. key=exerciseId : le brouillon se ré-amorce quand
          on change d'exo. */}
      <DatedNoteSection
        key={exercise.exerciseId}
        value={datedNote}
        onSave={onSaveDatedNote}
      />
    </div>
  );
}

/**
 * Sélecteur de côté Gauche / Droite pour un exo unilatéral (issue #63). Deux
 * options en segmented control. Le côté actif est porté par PLUSIEURS signaux,
 * jamais la couleur seule (DESIGN.md) : poids de police, anneau de contour, coche
 * et `aria-pressed`. Le violet d'accent est laissé à l'action de log (One Voice
 * Rule), donc l'option active reste en palier tonal (surface-2), pas en accent.
 * Un côté DÉJÀ loggé pour la série en cours est signalé « fait » (libellé texte)
 * pour orienter vers le côté qui reste, sans empêcher de le re-sélectionner.
 * Tap-targets ≥44px (h-12).
 */
function SideSelector({
  value,
  done,
  onChange,
}: {
  value: Side;
  /** Côtés déjà loggés pour la série EN COURS (pour signaler « fait »). */
  done: Side[];
  onChange: (side: Side) => void;
}) {
  const options: { side: Side; label: string }[] = [
    { side: 'left', label: 'Gauche' },
    { side: 'right', label: 'Droite' },
  ];
  return (
    <div
      role="group"
      aria-label="Côté à logger"
      className="mb-4 grid grid-cols-2 gap-2"
    >
      {options.map(({ side, label }) => {
        const active = value === side;
        const isDone = done.includes(side);
        return (
          <button
            key={side}
            type="button"
            aria-pressed={active}
            aria-label={isDone ? `${label}, déjà saisi` : label}
            onClick={() => onChange(side)}
            className={`flex h-12 items-center justify-center gap-1.5 rounded-xl text-base transition active:scale-[0.99] ${
              active
                ? 'bg-surface-2 font-semibold text-ink ring-2 ring-ink/70'
                : 'bg-surface font-medium text-ink-muted active:text-ink'
            }`}
          >
            {/* Coche : la FORME signale la sélection, pas la seule couleur. */}
            {active && (
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="shrink-0"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
            {label}
            {/* Côté déjà saisi pour cette série : libellé texte, jamais couleur seule. */}
            {isDone && (
              <span className="ml-0.5 text-xs font-normal text-ink-muted">fait</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Section de la note d'INSTRUCTIONS de l'exo (issue #52), repliable ET éditable
 * sur place en Capture. Trois états visuels :
 *   - AUCUNE note : affordance discrète « Ajouter une note » (tap → édition) ;
 *   - note existante, repliée/dépliée : en-tête tappable (≥44px) qui bascule le
 *     pli ; dépliée, elle montre le texte + un bouton « Modifier » ;
 *   - en ÉDITION : textarea (NoteField) + Annuler / Enregistrer.
 * Le défaut est DÉPLIÉ si une note existe (consultation immédiate), conforme au
 * critère #52. La persistance (et la MAJ optimiste) sont gérées par le parent ;
 * ici, on remonte le corps à l'enregistrement explicite. `resolveExerciseNoteSave`
 * évite un appel inutile quand le contenu réel n'a pas bougé. Vider puis
 * enregistrer efface la note (géré côté data par `saveExerciseNote`).
 */
function ExerciseNoteSection({
  value,
  onSave,
}: {
  value: string;
  onSave: (body: string) => void;
}) {
  const hasNote = !isBlankNote(value);
  // Déplié par défaut si une note existe (consultation immédiate, critère #52).
  const [open, setOpen] = useState(hasNote);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);

  const startEditing = () => {
    setDraft(value);
    setEditing(true);
    setOpen(true);
    setSaved(false);
  };

  const handleSave = () => {
    const { changed, nextBody } = resolveExerciseNoteSave(value, draft);
    // N'écrit que si le contenu réel a bougé (resaver à l'identique ou ne toucher
    // que des espaces n'appelle pas le réseau).
    if (changed) onSave(nextBody);
    setEditing(false);
    // Une note vidée se replie sur l'affordance « Ajouter » ; sinon on reste ouvert.
    setOpen(!isBlankNote(nextBody));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };

  // En ÉDITION : champ texte + actions. Sert aussi bien à créer qu'à modifier.
  if (editing) {
    return (
      <div className="mt-2.5">
        <NoteField
          id="exercise-note"
          label="Note de l’exercice"
          hint="Consigne d’exécution persistante (prise, posture, tempo)."
          value={draft}
          placeholder="Omoplates rétractées, barre au sternum."
          rows={3}
          onChange={setDraft}
        />
        <div className="mt-2.5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex h-11 items-center rounded-xl bg-surface px-4 text-sm font-medium text-ink-muted transition active:bg-surface-2 active:text-ink"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex h-11 items-center rounded-xl bg-accent-strong px-5 text-sm font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent"
          >
            Enregistrer la note
          </button>
        </div>
      </div>
    );
  }

  // AUCUNE note : affordance discrète pour en créer une (tap-target ≥44px).
  if (!hasNote) {
    return (
      <button
        type="button"
        onClick={startEditing}
        className="mt-2.5 flex min-h-[2.75rem] w-full items-center gap-2 rounded-2xl border border-dashed border-line bg-surface px-4 py-2.5 text-left text-sm font-medium text-ink-muted transition active:bg-surface-2 active:text-ink"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Ajouter une note
        {saved && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-good">
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Note supprimée.
          </span>
        )}
      </button>
    );
  }

  // Note existante : carte avec en-tête TAPPABLE (déplier/replier) + corps + Modifier.
  return (
    <div className="mt-2.5 rounded-2xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-[2.75rem] w-full items-center gap-1.5 rounded-2xl px-4 py-2.5 text-left transition active:bg-surface-2"
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-ink-muted"
        >
          <path d="M4 6h16M4 12h10M4 18h7" />
        </svg>
        <span className="text-xs font-medium text-ink-muted">Note de l’exercice</span>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-good">
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Enregistrée.
          </span>
        )}
        {/* Chevron : indique le pli par la FORME, pas par la couleur seule. */}
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`ml-auto shrink-0 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-3">
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{value}</p>
          <button
            type="button"
            onClick={startEditing}
            className="mt-2.5 inline-flex h-11 items-center gap-1.5 rounded-xl bg-surface-2 px-4 text-sm font-medium text-ink-muted transition active:text-ink"
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
            Modifier
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Section de note datée du jour. Repliée tant qu'aucune note n'existe (bouton
 * « Ajouter une note du jour ») ; ouverte, elle montre un textarea + un bouton
 * d'enregistrement. Le brouillon est local ; on remonte au parent (outbox) à
 * l'enregistrement explicite. Vider le texte puis enregistrer efface la note.
 */
function DatedNoteSection({
  value,
  onSave,
}: {
  value: string;
  onSave: (body: string) => void;
}) {
  const hasNote = !isBlankNote(value);
  // Ouverte si une note existe déjà (consultation/édition), sinon repliée.
  const [open, setOpen] = useState(hasNote);
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);

  // Sauvegarde différée du résultat : on confirme brièvement puis on retombe.
  const dirty = draft !== value;

  const handleSave = () => {
    onSave(draft);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-5 flex min-h-[3.25rem] w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left transition active:scale-[0.99] active:bg-surface-2"
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-ink-muted"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-ink">
            Ajouter une note du jour
          </span>
          <span className="mt-0.5 block text-xs text-ink-muted">
            Le contexte de ta perf d&apos;aujourd&apos;hui sur cet exercice.
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="mt-5">
      <NoteField
        id="dated-note"
        label="Note du jour"
        hint="Contexte de la perf d&apos;aujourd&apos;hui (sommeil, douleur, sensation)."
        value={draft}
        placeholder="Épaule un peu raide, échauffement plus long."
        rows={3}
        onChange={setDraft}
      />
      <div className="mt-2.5 flex items-center justify-end gap-2">
        {saved && !dirty && (
          <span className="mr-auto inline-flex items-center gap-1.5 text-xs font-medium text-good">
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Note enregistrée.
          </span>
        )}
        <button
          type="button"
          disabled={!dirty}
          onClick={handleSave}
          className="inline-flex h-11 items-center rounded-xl bg-accent-strong px-5 text-sm font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-muted disabled:active:scale-100"
        >
          Enregistrer la note
        </button>
      </div>
    </div>
  );
}

function refToBeatAt(
  reference: SessionExercise['reference'],
  order: number,
): PerformedSet | null {
  return reference?.find((s) => s.order === order) ?? null;
}

/** Le type de record qu'une série bat : e1RM, charge, ou les deux. */
export type RecordKind = 'e1rm' | 'weight-reps' | 'both';

/**
 * Pour chaque série loggée du jour, dit si (et comment) elle bat le record
 * personnel — `null` sinon. Le record « avance » au fil des séries du jour : on
 * part du record historique, et chaque série qui le dépasse le remplace. Ainsi
 * une SEULE série par mesure porte le marqueur (la première à dépasser), pas
 * toutes celles qui battent l'ancien record. Pur, testé séparément.
 */
export function computeRecordFlags(
  sets: PerformedSet[],
  historical: PersonalRecord | null,
): (RecordKind | null)[] {
  // Premier passage (aucun historique) : on ne crie pas « record » sur la toute
  // première série jamais faite. Le record se construit, sans marqueur.
  if (historical === null) {
    let running: PersonalRecord = { bestE1rm: null, bestWeightReps: null };
    return sets.map((s) => {
      running = absorb(running, s);
      return null;
    });
  }

  let running = historical;
  return sets.map((s) => {
    const e1rm = isE1rmRecord(running, s);
    const weightReps = isWeightRepsRecord(running, s);
    running = absorb(running, s);
    if (e1rm && weightReps) return 'both';
    if (e1rm) return 'e1rm';
    if (weightReps) return 'weight-reps';
    return null;
  });
}

/** Intègre une série dans un record courant (pour faire avancer la comparaison). */
function absorb(record: PersonalRecord, s: PerformedSet): PersonalRecord {
  const e1rm = estimateE1rm(s.weightKg, s.reps, s.rir);
  const bestE1rm =
    record.bestE1rm === null || e1rm > record.bestE1rm ? e1rm : record.bestE1rm;
  const bestWeightReps = isWeightRepsRecord(record, s)
    ? { weightKg: s.weightKg, reps: s.reps }
    : record.bestWeightReps;
  return { bestE1rm, bestWeightReps };
}

const RECORD_LABEL: Record<RecordKind, string> = {
  e1rm: 'Record e1RM',
  'weight-reps': 'Record de charge',
  both: 'Record',
};

/**
 * Indicateur SOBRE de nouveau record (issue #34). Accent violet — rare, mérité,
 * réservé à l'état marquant — + glyphe étoile + label : l'info ne tient jamais à
 * la couleur seule (DESIGN.md). Pas de confettis, pas de ton coach : un constat.
 */
function RecordBadge({ kind }: { kind: RecordKind }) {
  const label = RECORD_LABEL[kind];
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold text-accent-ink"
      title={label}
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.2l5.9-.9L12 3z" />
      </svg>
      {label}
    </span>
  );
}
