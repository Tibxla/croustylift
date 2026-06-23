// Panneau de capture d'un exo. Nom = roi ; « dernière fois » = co-roi à battre ;
// saisie par steppers au pouce ; « Logger la série » en 1 tap.
import { useEffect, useMemo, useRef, useState } from 'react';
import { estimateE1rm } from '../../domain/e1rm';
import {
  currentSetOrder,
  defaultSide,
  loggedSetEquivalents,
  pairSidesByOrder,
  sidesDoneAt,
  weakSideE1rm,
} from '../../domain/unilateral';
import { deriveDeviations } from '../../domain/deviation';
import { isBlankNote } from '../../domain/notes';
import type { PerformedSet, Side } from '../../domain/types';
import type { SessionExercise } from './fixtures';
import type { ExerciseProgress } from './state';
import { resolveExerciseNoteSave } from './state';
import { ClusterStepper } from './ClusterStepper';
import { seedDraft } from './capture-seed';
import { NoteField } from '../notes/NoteField';
import { DeviationBadge } from './DeviationBadge';
import { deviationVisual } from './deviation-visual';
import type { RecordKind } from './record-flags';
import {
  computeSetBadges,
  computeSetBadgesBySide,
  summarizeBadges,
  type SetBadge,
  type VerdictCounts,
} from './set-badges';
import {
  formatE1rm,
  formatPrescription,
  formatSet,
  formatRange,
  formatSetCount,
  formatWeight,
} from './format';

interface ExerciseCaptureProps {
  exercise: SessionExercise;
  progress: ExerciseProgress;
  /** Position de l'exo dans la séance (1-indexé) et total, pour le repère « EXO N / M ». */
  position?: number;
  total?: number;
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
  position,
  total,
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
  // ce choix. Le compteur de SÉRIES complètes compte les ORDERS dont les DEUX
  // côtés (G et D) sont présents (blind F4) : compter « saisies droites » restait
  // à 0 si l'utilisateur loggeait deux fois le même côté. Sert au compteur, à la
  // cible « à battre » et au statut de fin. Bilatéral : currentSide null, une
  // saisie = une série.
  const unilateral = exercise.unilateral ?? false;
  const completedSets = unilateral
    ? pairSidesByOrder(progress.sets).filter((p) => p.left !== null && p.right !== null).length
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

  // Badge UNIQUE par série loggée (ADR 0010) : deux axes distincts —
  //   - RÉFÉRENCE (« dernière fois », par position et par CÔTÉ en unilatéral) :
  //     e1RM strict -> « battu » / « égalisé » / rien ;
  //   - RECORD personnel (all-time) : e1RM et/ou charge.
  // Priorité Record > battu > égalisé, un seul badge par ligne. En unilatéral
  // chaque bras est sa propre piste (records par côté). On compare au record
  // COURANT (historique + séries du jour déjà loggées) pour qu'une seule série par
  // mesure porte le marqueur, et premier passage = aucun marqueur.
  const badges = useMemo<SetBadge[]>(
    () =>
      unilateral
        ? computeSetBadgesBySide(
            progress.sets,
            reference ?? null,
            exercise.personalRecordBySide ?? {
              left: { bestE1rm: null, bestWeightReps: null },
              right: { bestE1rm: null, bestWeightReps: null },
            },
          )
        : computeSetBadges(progress.sets, reference ?? null, exercise.personalRecord ?? null),
    [unilateral, progress.sets, reference, exercise.personalRecordBySide, exercise.personalRecord],
  );

  // Brouillon de la série courante (steppers), pré-rempli par `seedDraft` (issue
  // #58, logique pure testée) : poids reporté de la dernière série loggée dès la
  // 2ᵉ, reps cadrées sur la borne basse prescrite. En unilatéral (issue #46/#63),
  // on passe le côté CHOISI pour aligner le repère sur la bonne ligne G/D (série
  // logique + côté), au lieu de dériver avec les rangs doublés. Ré-amorcé au
  // changement d'exo, au log/annulation d'une série (loggedCount), ou au bascule
  // de côté (currentSide), pour reproposer le repère du côté visé.
  const seed = useMemo(
    () =>
      seedDraft({
        prescription,
        reference: reference ?? null,
        loggedSets: progress.sets,
        side: currentSide ?? undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exercise.exerciseId, loggedCount, currentSide],
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

  // La série « à battre » à la position courante (co-roi). En unilatéral (ADR
  // 0010), on l'apparie par (position, CÔTÉ CHOISI) : le repère suit le bras que
  // tu t'apprêtes à logger — sa dernière fois à lui. Bilatéral : par position.
  const refToBeat = unilateral
    ? reference?.find((s) => s.order === completedSets + 1 && s.side === currentSide) ?? null
    : reference?.find((s) => s.order === loggedCount + 1) ?? null;

  // Statut de fin (si au moins le minimum prescrit est atteint), en SÉRIES
  // complètes (une série unilatérale = gauche + droite). Le badge de déviation
  // reste cantonné au bilatéral (le diff prescription/réel par côté est hors #46).
  const reachedMin = completedSets >= prescription.sets.min;
  // Borne HAUTE prescrite : c'est ELLE qui déclenche le popup de fin d'exo (et non
  // le min), pour ne pas couper l'enchaînement quand on vise encore une série de
  // plus dans la fourchette. Si la prescription est fixe (min == max), les deux
  // coïncident.
  const reachedMax = completedSets >= prescription.sets.max;
  const deviations = deriveDeviations(prescription, progress.sets);
  const finishVisual = deviationVisual(deviations, prescription.sets, completedSets);

  // e1RM de la 1ʳᵉ série loggée (touche domaine, readout discret). Pour un exo
  // unilatéral, c'est le CÔTÉ FAIBLE de la 1ʳᵉ série (issue #46), aligné avec le
  // point de la courbe primaire (cf. weakSideE1rm). Bilatéral : e1RM simple.
  const firstE1rm = weakSideE1rm(progress.sets);

  // Muscles principaux (issue #33) affichés sous le nom, repli sur la cible prescrite
  // pour un exo legacy sans muscles renseignés (jamais de sous-ligne vide).
  const muscles = (exercise.primaryMuscles ?? []).filter(Boolean);

  // Index de la MEILLEURE série loggée (e1RM max) : sa ligne est mise en accent dans
  // la liste, façon « série du jour à battre » (cohérent avec le repère Analyse).
  const bestIndex = useMemo(() => {
    if (progress.sets.length === 0) return -1;
    let bi = 0;
    let bv = -Infinity;
    progress.sets.forEach((s, i) => {
      const e = estimateE1rm(s.weightKg, s.reps, s.rir);
      if (e > bv) {
        bv = e;
        bi = i;
      }
    });
    return bi;
  }, [progress.sets]);

  // Segments de progression des séries : autant que la borne haute prescrite (jamais
  // moins que le nombre déjà fait). Faits = accent ; courant = palier + anneau accent.
  const plannedSegments = Math.max(prescription.sets.max, Math.ceil(completedSets));

  // Feuille de fin d'exo (ADR « popup de fin d'exo ») : remonte AUTOMATIQUEMENT,
  // UNE fois, à l'instant où l'on FRANCHIT la BORNE HAUTE prescrite (transition
  // false→true) — pas le min, pour ne pas couper l'enchaînement —, et pas au
  // montage d'un exo déjà terminé (reload). Non bloquante : on peut « Continuer
  // l'exo » (série de plus) ou « Revenir à la liste ». Réamorcée par exo (le
  // composant est `key`-é sur l'exerciseId → refs neuves au changement).
  const [recapOpen, setRecapOpen] = useState(false);
  const recapAutoShownRef = useRef(false);
  const prevReachedMaxRef = useRef(reachedMax);
  useEffect(() => {
    if (reachedMax && !prevReachedMaxRef.current && !recapAutoShownRef.current) {
      recapAutoShownRef.current = true;
      setRecapOpen(true);
    }
    prevReachedMaxRef.current = reachedMax;
  }, [reachedMax]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-32 pt-3">
      {/* Top bar : retour (carré) · repère « EXO N / M » · spacer symétrique. */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          aria-label="Tous les exercices"
          className="flex h-[38px] w-[38px] items-center justify-center rounded-xl border border-hair bg-surface text-ink-muted shadow-[inset_0_1px_0_var(--spec)] transition active:scale-95 active:text-ink"
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
        </button>
        {position != null && total != null && (
          <span className="readout text-[13px] uppercase tracking-[0.08em] text-ink-muted">
            Exo {String(position).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </span>
        )}
        <span aria-hidden="true" className="h-[38px] w-[38px]" />
      </div>

      {/* Repères du haut (ADR 0010) : OBJECTIF (prescription, FIXE — ce qu'on vise)
          et DERNIÈRE FOIS (référence, par position et par CÔTÉ en unilatéral — ce
          qu'on dépasse). Deux lectures distinctes, labels de largeur égale pour
          aligner les valeurs. L'objectif chiffré vivait avant en repli « Cible »
          sous le nom (caché dès qu'il y avait des muscles) — il est maintenant
          toujours visible ici. */}
      <div className="mt-4 flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <RepereLabel>Objectif</RepereLabel>
          <span className="readout text-[13.5px] text-ink-muted">
            {formatPrescription(prescription.sets, prescription.reps, prescription.rir)}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <RepereLabel>Dernière fois</RepereLabel>
          {refToBeat ? (
            <span className="readout text-[13.5px] text-ink-muted">{formatSet(refToBeat)}</span>
          ) : (
            <span className="text-[13px] text-ink-faint">
              {reference ? '—' : 'Premier passage.'}
            </span>
          )}
        </div>
      </div>

      {/* Nom = roi + muscles principaux (issue #33). */}
      <h2 className="mt-3 text-3xl font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
        {exercise.name}
      </h2>
      {muscles.length > 0 && (
        <p className="readout mt-1.5 text-[13px] text-ink-faint">{muscles.join(' · ')}</p>
      )}

      {/* Repère « Dernière fois tu notais : … » (note datée la plus récente d'une
          séance passée, lecture seule, cf. CONTEXT.md « Note datée »). Visible
          pendant l'exo ; on saisit une note FRAÎCHE du jour plus bas. */}
      {exercise.previousDatedNote && exercise.previousDatedNote.trim() !== '' && (
        <div className="mt-3 rounded-xl border border-hair bg-surface px-3.5 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Dernière fois tu notais
          </p>
          <p className="mt-1 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-muted">
            {exercise.previousDatedNote}
          </p>
        </div>
      )}

      {/* Progression des séries : segments (faits = accent, courant = anneau accent)
          + compteur en ÉQUIVALENT-SÉRIE (a11y, aria-live ; 0,5 pour un côté loggé). */}
      <div className="mt-4 flex items-center gap-1.5" aria-live="polite">
        {Array.from({ length: plannedSegments }).map((_, i) => {
          const done = i < Math.floor(completedSets);
          const current = i === Math.floor(completedSets);
          return (
            <span
              key={i}
              aria-hidden="true"
              className={`h-1.5 flex-1 rounded-full ${
                done
                  ? 'bg-accent'
                  : current
                    ? 'bg-surface-2 shadow-[inset_0_0_0_1.5px_var(--color-accent)]'
                    : 'bg-surface-2'
              }`}
            />
          );
        })}
        <span className="readout ml-1.5 shrink-0 text-xs text-ink-muted">
          <span
            key={formatSetCount(loggedSetEquivalents(progress.sets))}
            className="anim-pop inline-block text-ink"
          >
            {formatSetCount(loggedSetEquivalents(progress.sets))}
          </span>{' '}
          / {formatRange(prescription.sets)}
        </span>
      </div>

      {/* Sélecteur de côté (issue #63) : pour un exo unilatéral, l'utilisateur
          CHOISIT le côté à logger avant la saisie. Au-dessus du cluster. L'état
          sélectionné tient au texte + à la coche + à aria-pressed, jamais à la
          seule couleur (DESIGN.md). */}
      {currentSide && (
        <div className="mt-4">
          <SideSelector
            value={currentSide}
            done={sidesDoneAt(progress.sets, currentSetOrder(progress.sets))}
            onChange={setSelectedSide}
          />
        </div>
      )}

      {/* Cluster instrument : POIDS (hero) + REPS / RIR (deux colonnes), steppers
          ronds au pouce. La saisie tapée (pavé numérique, issue #58) est conservée. */}
      <div className="mt-3.5 rounded-[22px] border border-hair-strong bg-[linear-gradient(180deg,var(--color-surface),color-mix(in_oklab,var(--color-surface),#000_8%))] p-4 shadow-[inset_0_1px_0_var(--spec),0_14px_30px_-18px_rgba(0,0,0,0.7)]">
        <ClusterStepper
          label="Poids"
          variant="hero"
          unit="kg"
          value={weightKg}
          step={WEIGHT_STEP}
          fineStep={WEIGHT_FINE}
          min={0}
          format={formatWeight}
          onChange={setWeightKg}
        />
        <div className="my-4 h-px bg-hair" />
        <div className="flex items-stretch gap-3">
          <ClusterStepper label="Reps" variant="compact" value={reps} step={1} min={1} onChange={setReps} />
          <div className="w-px shrink-0 bg-hair" />
          <ClusterStepper label="RIR" variant="compact" value={rir} step={1} min={0} onChange={setRir} />
        </div>
      </div>

      {/* Séries déjà loggées : readout mono + e1RM par ligne, MEILLEURE série
          (e1RM max) en accent (coche + e1RM accent-ink). Records / « battu »
          conservés (issue #34/#46), portés par forme + texte, jamais couleur seule. */}
      {loggedCount > 0 && (
        <div className="mt-5">
          <div className="mb-2.5 flex items-center justify-between px-1">
            <span className="readout text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              Séries loggées
            </span>
            <span className="readout text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              e1RM
            </span>
          </div>
          <ol className="flex flex-col gap-[7px]">
            {progress.sets.map((s, i) => {
              // Badge unique de la série (ADR 0010) : record (all-time) > battu >
              // égalisé (dernière fois), par CÔTÉ en unilatéral. Calculé en amont
              // (`badges`), aligné par index avec `progress.sets`. Côté = libellé texte.
              const badge = badges[i] ?? null;
              const isBest = i === bestIndex;
              return (
                <li
                  key={`${s.order}-${s.side ?? 'bi'}`}
                  className={`reveal-set flex items-center gap-3 rounded-[13px] px-3.5 py-2.5 ${
                    isBest ? 'border border-accent bg-accent-soft' : 'panel'
                  }`}
                >
                  <span
                    className={`readout w-5 shrink-0 text-[13px] tabular-nums ${
                      isBest ? 'text-accent-ink' : 'text-ink-faint'
                    }`}
                  >
                    {s.order}
                  </span>
                  {s.side && (
                    <span className="w-5 shrink-0 text-xs font-semibold uppercase text-ink-muted">
                      {s.side === 'left' ? 'G' : 'D'}
                    </span>
                  )}
                  <span
                    className={`readout flex-1 text-[15px] tabular-nums ${
                      isBest ? 'font-medium text-ink' : 'text-ink'
                    }`}
                  >
                    {formatSet(s)}
                  </span>
                  <SetBadgeView badge={badge} />
                  {isBest && (
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="shrink-0 text-accent-ink"
                    >
                      <path d="M5 12l5 5L20 6" />
                    </svg>
                  )}
                  <span
                    className={`readout shrink-0 text-[15px] tabular-nums ${
                      isBest ? 'font-semibold text-accent-ink' : 'text-ink-muted'
                    }`}
                  >
                    {formatE1rm(estimateE1rm(s.weightKg, s.reps, s.rir))}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Statut de fin : e1RM côté faible (unilatéral) + badge de déviation
          (bilatéral, issue #46). N'apparaît que s'il y a du contenu à montrer. */}
      {((firstE1rm != null && unilateral) || (reachedMin && !unilateral)) && (
        <div className="mt-3 flex items-center justify-between gap-3">
          {firstE1rm != null && unilateral ? (
            <span className="text-sm text-ink-muted">
              e1RM côté faible{' '}
              <span className="readout font-medium text-ink">{formatE1rm(firstE1rm)} kg</span>
            </span>
          ) : (
            <span />
          )}
          {reachedMin && !unilateral && <DeviationBadge visual={finishVisual} />}
        </div>
      )}

      {/* Actions secondaires */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {loggedCount > 0 && (
          <button
            type="button"
            onClick={onUndoLast}
            className="btn btn-secondary text-ink-muted h-11 rounded-xl px-4 text-sm font-medium"
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
            {/* En unilatéral, l'annulation retire UNE ligne (un côté), pas la série
                logique entière (G + D) : le libellé le dit (décision produit 2b).
                La logique d'undo-last-set reste inchangée. */}
            {unilateral ? 'Annuler le dernier côté' : 'Annuler la dernière'}
          </button>
        )}
        <button
          type="button"
          onClick={onSkip}
          className="btn btn-secondary text-ink-muted h-11 rounded-xl px-4 text-sm font-medium"
        >
          Passer l&apos;exercice
        </button>
      </div>

      {/* Fin d'exo : plus de gros bouton inline (remplacé par la feuille de récap
          AUTO au franchissement du min, ADR « popup de fin d'exo »). Reste un
          RAPPEL discret pour rouvrir le récap si on l'a fermé — le retour réel à la
          liste se fait depuis la feuille (et le « Tous les exercices » reste en haut). */}
      {reachedMin && (
        <button
          type="button"
          onClick={() => setRecapOpen(true)}
          className="btn btn-secondary text-ink-muted mt-4 h-11 w-full rounded-xl text-sm font-medium"
        >
          Exo terminé — voir le récap
        </button>
      )}

      {/* Note d'INSTRUCTIONS de l'exo (issue #52) : référence persistante, repliable
          et éditable sur place. key=exerciseId pour ré-amorcer le pli au changement
          d'exo. L'info (en-tête, états) tient au texte + au glyphe, pas à la couleur. */}
      <ExerciseNoteSection
        key={`note-${exercise.exerciseId}`}
        value={perExerciseNote}
        onSave={onSaveExerciseNote}
      />

      {/* Note DATÉE du jour (issue #26) : contexte de la perf d'aujourd'hui sur cet
          exo. Saisissable et consultable ici. Repliée par défaut (zéro-friction),
          on l'ouvre pour saisir. key=exerciseId : le brouillon se ré-amorce quand
          on change d'exo. */}
      <DatedNoteSection
        key={`dated-${exercise.exerciseId}`}
        value={datedNote}
        onSave={onSaveDatedNote}
      />

      {/* Feuille de récap de fin d'exo (ADR « popup de fin d'exo ») : auto au
          franchissement du min, rouvrable via le rappel discret. Mini-récap
          (séries vs cible · battu/égalisé/record, par côté en unilatéral · meilleure
          série) + retour à la liste / continuer. */}
      {recapOpen && (
        <ExerciseRecapSheet
          name={exercise.name}
          unilateral={unilateral}
          hasReference={reference != null}
          sets={progress.sets}
          badges={badges}
          completedSets={completedSets}
          setsTarget={prescription.sets}
          bestIndex={bestIndex}
          onBackToList={onBack}
          onClose={() => setRecapOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Feuille (slide-up) de récap de fin d'exo (ADR « popup de fin d'exo »). Constat
 * sobre, pas de ton coach (DESIGN.md) : séries faites vs cible, verdicts vs la
 * dernière fois (battu/égalisé) et record(s) all-time — résumés PAR CÔTÉ en
 * unilatéral —, meilleure série du jour. Non bloquante : « Revenir à la liste »
 * (primaire) ou « Continuer l'exo » (ferme la feuille pour une série de plus).
 */
function ExerciseRecapSheet({
  name,
  unilateral,
  hasReference,
  sets,
  badges,
  completedSets,
  setsTarget,
  bestIndex,
  onBackToList,
  onClose,
}: {
  name: string;
  unilateral: boolean;
  hasReference: boolean;
  sets: PerformedSet[];
  badges: SetBadge[];
  completedSets: number;
  setsTarget: { min: number; max: number };
  bestIndex: number;
  onBackToList: () => void;
  onClose: () => void;
}) {
  const summary = summarizeBadges(sets, badges);
  const best = bestIndex >= 0 ? sets[bestIndex] ?? null : null;

  return (
    // z-40 : AU-DESSUS de la nav (z-30) — sinon la nav recouvre les actions du bas
    // de la feuille (« Revenir à la liste »). La feuille couvre la nav, c'est voulu
    // (on est concentré sur le récap).
    <div className="fixed inset-0 z-40 flex flex-col">
      {/* Fond cliquable = « Continuer l'exo » (fermer sans quitter l'exo). */}
      <button
        type="button"
        aria-label="Continuer l’exercice"
        onClick={onClose}
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
      />
      <div className="relative mt-auto flex flex-col rounded-t-[26px] border-t border-hair-strong bg-bg pb-[calc(env(safe-area-inset-bottom,0)+1rem)] shadow-2xl">
        <div className="mx-auto mt-3 h-[5px] w-[42px] rounded-[3px] bg-surface-2" aria-hidden="true" />
        <div className="mx-auto flex w-full max-w-md flex-col px-5 pt-4">
          {/* En-tête : nom + coche « terminé ». */}
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-good" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--color-bg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
            <h3 className="min-w-0 flex-1 truncate text-xl font-semibold text-ink">{name}</h3>
            <span className="text-sm font-medium text-good">Terminé</span>
          </div>

          {/* Séries faites vs cible. */}
          <p className="readout mt-4 text-[15px] text-ink">
            <span className="font-semibold tabular-nums">{formatSetCount(completedSets)}</span>{' '}
            série{completedSets > 1 ? 's' : ''}{' '}
            <span className="text-ink-muted">· cible {formatRange(setsTarget)}</span>
          </p>

          {/* Verdicts vs la dernière fois + record(s). Premier passage = pas de
              comparaison. Par côté en unilatéral. */}
          {!hasReference ? (
            <p className="mt-2 text-[13.5px] text-ink-faint">Premier passage, pas de comparaison.</p>
          ) : unilateral ? (
            <div className="mt-2 flex flex-col gap-1">
              <RecapVerdictLine label="Gauche" counts={summary.left} />
              <RecapVerdictLine label="Droite" counts={summary.right} />
            </div>
          ) : (
            <p className="mt-2 text-[13.5px] text-ink-muted">{verdictPhrase(summary.total)}</p>
          )}

          {/* Meilleure série du jour (trophée). */}
          {best && (
            <p className="readout mt-2 text-[13px] text-ink-faint">
              Meilleure : <span className="text-ink-muted">{formatSet(best)}</span> · e1RM{' '}
              <span className="text-ink-muted">
                {formatE1rm(estimateE1rm(best.weightKg, best.reps, best.rir))}
              </span>
            </p>
          )}

          {/* Actions : retour à la liste (primaire) / continuer l'exo (secondaire). */}
          <button
            type="button"
            onClick={onBackToList}
            className="btn btn-primary mt-5 h-12 w-full rounded-2xl text-base"
          >
            Revenir à la liste
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary text-ink-muted mt-2.5 h-11 w-full rounded-xl text-sm font-medium"
          >
            Continuer l’exo
          </button>
        </div>
      </div>
    </div>
  );
}

/** Une ligne « Gauche : 2 battues · 1 record » du récap (par côté en unilatéral). */
function RecapVerdictLine({ label, counts }: { label: string; counts: VerdictCounts }) {
  const phrase = verdictPhrase(counts);
  return (
    <p className="text-[13.5px] text-ink-muted">
      <span className="font-medium text-ink">{label} :</span>{' '}
      {phrase || <span className="text-ink-faint">rien battu</span>}
    </p>
  );
}

/** Phrase « 1 record · 2 battues · 1 égalisée » (parties à zéro omises). */
function verdictPhrase(c: VerdictCounts): string {
  const parts: string[] = [];
  if (c.record) parts.push(`${c.record} record${c.record > 1 ? 's' : ''}`);
  if (c.battu) parts.push(`${c.battu} battue${c.battu > 1 ? 's' : ''}`);
  if (c.egalise) parts.push(`${c.egalise} égalisée${c.egalise > 1 ? 's' : ''}`);
  return parts.join(' · ');
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

  // Le toast « enregistré » retombe après 1,6 s. Id gardé en ref + clear au
  // démontage : changer d'exo dans l'intervalle ne déclenche pas le timer sur
  // une instance démontée (même garde-fou que ExportButton).
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (savedTimerRef.current != null) clearTimeout(savedTimerRef.current);
    };
  }, []);

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
    if (savedTimerRef.current != null) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 1600);
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
            className="btn btn-secondary text-ink-muted h-11 rounded-xl px-4 text-sm font-medium"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="btn btn-primary h-11 rounded-xl px-5 text-sm"
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
        className="mt-2.5 flex min-h-[2.75rem] w-full items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-2.5 text-left text-sm font-medium text-ink-muted transition active:bg-surface active:text-ink"
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
    <div className="surface-card mt-2.5 rounded-2xl">
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
            className="btn btn-secondary text-ink-muted mt-2.5 h-11 rounded-xl px-4 text-sm font-medium"
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

  // Toast « enregistré » (1,6 s) : id en ref + clear au démontage pour ne pas
  // tirer setSaved sur une instance démontée si on change d'exo entre-temps.
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (savedTimerRef.current != null) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleSave = () => {
    onSave(draft);
    setSaved(true);
    if (savedTimerRef.current != null) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 1600);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="surface-interactive mt-5 flex min-h-[3.25rem] w-full items-center gap-3 rounded-2xl px-4 py-3 text-left"
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
          className="btn btn-primary h-11 rounded-xl px-5 text-sm"
        >
          Enregistrer la note
        </button>
      </div>
    </div>
  );
}

/** Pastille de repère (Objectif / Dernière fois), largeur fixe pour aligner les valeurs. */
function RepereLabel({ children }: { children: string }) {
  return (
    <span className="readout w-[94px] shrink-0 rounded-md border border-hair bg-surface px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-faint shadow-[inset_0_1px_0_var(--spec)]">
      {children}
    </span>
  );
}

/**
 * Badge UNIQUE d'une série loggée (ADR 0010), dérivé en amont (`set-badges`) :
 *   - axe RECORD (all-time) -> étoile « Record … » (accent violet, rare/mérité) ;
 *   - axe RÉFÉRENCE (dernière fois) -> « battu » (flèche ↑) ou « égalisé » (=).
 * L'info tient toujours à la FORME + au TEXTE, jamais à la couleur seule (DESIGN.md).
 */
function SetBadgeView({ badge }: { badge: SetBadge }) {
  if (!badge) return null;
  if (badge.axis === 'record') return <RecordBadge kind={badge.record} />;
  return badge.verdict === 'battu' ? <BattuBadge /> : <EgaliseBadge />;
}

/** Série strictement meilleure que la dernière fois à cette position (et ce côté). */
function BattuBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted"
      title="Mieux que la dernière fois"
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
  );
}

/** Série exactement à la hauteur de la dernière fois (e1RM identique). */
function EgaliseBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium text-ink-faint"
      title="À égalité avec la dernière fois"
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
        <path d="M5 9h14M5 15h14" />
      </svg>
      égalisé
    </span>
  );
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
