// L'instrument de la Salle (refonte E « Signal ») : un seul exo à l'écran.
//
// De haut en bas : l'index des exos (toucher un numéro ouvre l'exo), le nom et
// UNE ligne (le plan, puis le bilan dès le minimum de séries), l'icône Notes,
// la bande des séries, la ligne « réf. série n » (ou le choix du côté en
// unilatéral), le poids lu en grand (toucher = saisie précise au clavier), la
// règle de poids à élan (pas réglé dans Réglages), la mesure du brouillon,
// l'écart à la Référence et le record, puis reps et RIR en un tap. La barre du
// bas (Sommaire, Annuler, Exo suivant, Logger) vit dans CaptureScreen.
//
// Toucher une case loggée de la bande ouvre la feuille de correction de CETTE
// série (SetEditSheet) ; ses gestes (corriger, changer de côté, supprimer)
// remontent au parent, qui les écrit. La feuille est rendue hors de la zone de
// saisie : ses événements, qui remontent à travers le portail, ne marquent pas
// le brouillon comme touché.
//
// Les libellés « e1RM » (mesure du brouillon) et « RIR » (rangée) se touchent :
// une feuille basse dit en une phrase ce que veut dire chaque mot
// (src/lib/glossary-text.ts), sans ligne de plus sur l'instrument.
//
// Mesure du brouillon : un chiffre seul, jamais un verdict « battrait » (cf.
// draft-e1rm.ts) : l'écart se lit sans signe ni couleur. Les statuts en signal
// (battue, record) ne portent que sur des séries réellement faites (ADR 0010).
// À 0 kg, la mesure est en reps effectives (`perfReadout`, ADR 0013).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { effectiveReps, isZeroLoad } from '../../domain/e1rm';
import { isRepsRecord } from '../../domain/pr';
import { currentSetOrder, defaultSide, pairSidesByOrder, sidesDoneAt, slotOfOrder, targetSlotForSide } from '../../domain/unilateral';
import { isBlankNote } from '../../domain/notes';
import type { PerformedSet, Side } from '../../domain/types';
import { useReglages } from '../../settings/reglages';
import { IconButton, NumberRow, Ruler, Sheet, StateMark, Status, useCompact, useCompactTight } from '../../ui';
import { GLOSSARY_TEXT } from '../../lib/glossary-text';
import type { SessionExercise } from './fixtures';
import type { ExerciseProgress } from './state';
import { loggedSetsKey, seedDraft, shouldReproposeSide, shouldReseedDraft } from './capture-seed';
import { formatPerf, perfReadout } from './perf-readout';
import { draftE1rm } from './draft-e1rm';
import { ExerciseIndex, type IndexItem } from './ExerciseIndex';
import { ExerciseRecapSheet } from './ExerciseRecapSheet';
import { NotesSheet } from './NotesSheet';
import { SetBand, UniSetBand } from './SetBand';
import { WeightReadout } from './WeightReadout';
import { computeSetBadges, computeSetBadgesBySide, recordWord, summarizeBadges, type SetBadge } from './set-badges';
import { formatE1rm, formatRange, formatWeight } from './format';
import { roundWeightKg } from './stepper-utils';
import { SetEditSheet } from './SetEditSheet';
import type { SetEntry } from './set-gestures';
import { weightGraduations } from './weight-graduations';

interface ExerciseCaptureProps {
  exercise: SessionExercise;
  progress: ExerciseProgress;
  /** Les exos de la séance, pour l'index du haut. */
  index: IndexItem[];
  /** L'exo que propose « Exo suivant », ou null s'il ne reste rien. */
  next: { name: string } | null;
  /** Corps de la note datée du jour pour cet exo (issue #26), '' si aucune. */
  datedNote: string;
  /** Incrémenté quand le réalisé change sans geste de l'utilisateur (réponse tardive de la base). */
  historyEpoch?: number;
  /** Ouvre un autre exo (index du haut). */
  onPick: (exerciseId: string) => void;
  /** Passe à l'exo suivant (récap de fin d'exo). */
  onNext: () => void;
  /** Revient au Sommaire de la séance. */
  onSommaire: () => void;
  /**
   * Remonte le brouillon de la série courante vers la barre du bas (qui logge).
   * Pour un exo unilatéral, `side` porte le côté choisi (issue #63).
   */
  onDraftChange: (draft: { weightKg: number; reps: number; rir: number; side?: Side }) => void;
  /** Enregistre la note datée du jour (corps vidé = note effacée). */
  onSaveDatedNote: (body: string) => void;
  /** Enregistre la note d'instructions de l'exo (issue #52), corps vidé = supprimée. */
  onSaveExerciseNote: (body: string) => void;
  /** Corrige la série d'id `setId` (poids, reps, RIR). */
  onCorrectSet: (setId: string, values: Partial<SetEntry>) => void;
  /** Passe la ligne d'id `setId` de l'autre côté (unilatéral, cf. `changeSetSide`). */
  onChangeSetSide: (setId: string, side: Side) => void;
  /** Supprime la série de la ligne d'id `setId` (les deux côtés en unilatéral). */
  onDeleteSet: (setId: string) => void;
}

/** Plages des rangées de numéros en salle, élargies si la valeur en sort. */
const REPS_ROW_MAX = 50;
const RIR_ROW_MAX = 10;
/** La règle de poids court jusqu'à 500 kg (au-delà : saisie au clavier). */
const RULER_MAX_KG = 500;

/** Écart signé, virgule, signe moins typographique : « +2,3 », « −1 », « 0 ». */
function signed(n: number, decimals: number): string {
  const r = Math.round(n * 10 ** decimals) / 10 ** decimals;
  if (r === 0) return '0';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(decimals).replace('.', ',')}`;
}

/** Écart du brouillon à la Référence, dans la mesure du juge (e1RM, ou reps
 *  effectives à 0 kg des deux côtés), avec le nom de cette mesure : un « +3,3 kg »
 *  sans nom se lisait comme 3,3 kg à ajouter sur la barre. Null si les deux ne se
 *  comparent pas. */
function gapToRef(draft: PerformedSet, ref: PerformedSet): { measure: 'e1RM' | 'reps eff.'; value: string; unit: string } | null {
  if (isZeroLoad(draft.weightKg) && isZeroLoad(ref.weightKg)) {
    return { measure: 'reps eff.', value: signed(effectiveReps(draft.reps, draft.rir) - effectiveReps(ref.reps, ref.rir), 0), unit: 'reps' };
  }
  const a = draftE1rm(draft.weightKg, draft.reps, draft.rir);
  const b = draftE1rm(ref.weightKg, ref.reps, ref.rir);
  return a === null || b === null ? null : { measure: 'e1RM', value: signed(a - b, 1), unit: 'kg' };
}

export function ExerciseCapture({
  exercise,
  progress,
  index,
  next,
  datedNote,
  historyEpoch = 0,
  onPick,
  onNext,
  onSommaire,
  onDraftChange,
  onSaveDatedNote,
  onSaveExerciseNote,
  onCorrectSet,
  onChangeSetSide,
  onDeleteSet,
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
  // Une série passée de l'autre côté (feuille de correction) ne change pas leur
  // nombre mais la série en cours : la clé porte aussi les côtés, pour que le
  // sélecteur repropose le côté qui manque (une gauche devenue droite redemande
  // la gauche).
  //
  // Exception : quand le nombre de séries a bougé par une RÉPONSE TARDIVE de la
  // base (`historyEpoch`, série arrivée d'ailleurs) et non par un geste, le côté
  // n'est pas reproposé si l'utilisateur a déjà réglé son brouillon ou choisi
  // son côté (`shouldReproposeSide`). Sinon le sélecteur basculait sous ses
  // doigts, et ce changement de côté, pris pour un geste, réinitialisait poids,
  // reps et RIR en cours de réglage.
  const [selectedSide, setSelectedSide] = useState<Side>(() => defaultSide(progress.sets));
  // Brouillon TOUCHÉ : posé à la première interaction dans la zone de saisie
  // (tap sur un bouton, focus ou frappe dans un champ, même non validée), levé
  // au début de la saisie suivante. Tant qu'il est posé, un rafraîchissement de
  // l'historique ne déplace plus ce que l'utilisateur règle.
  const draftTouchedRef = useRef(false);
  const touchDraft = useCallback(() => {
    draftTouchedRef.current = true;
  }, []);
  // Côté CHOISI au sélecteur par l'utilisateur pour la saisie en cours : levé
  // quand une nouvelle saisie commence, comme le marqueur du brouillon.
  const sideChosenRef = useRef(false);
  const chooseSide = useCallback((side: Side) => {
    sideChosenRef.current = true;
    setSelectedSide(side);
  }, []);
  const sidesKey = unilateral ? progress.sets.map((s) => `${s.order}${s.side ?? ''}`).join(',') : '';
  const sideKey = `${exercise.exerciseId}:${loggedCount}:${unilateral}:${sidesKey}`;
  const sideKeyRef = useRef(sideKey);
  const sideEpochRef = useRef(historyEpoch);
  useEffect(() => {
    const keyChanged = sideKeyRef.current !== sideKey;
    const fromReality = sideEpochRef.current !== historyEpoch;
    sideKeyRef.current = sideKey;
    sideEpochRef.current = historyEpoch;
    if (!unilateral) return;
    const repropose = shouldReproposeSide({
      keyChanged,
      fromReality,
      draftTouched: draftTouchedRef.current,
      sideChosen: sideChosenRef.current,
    });
    if (!repropose) return;
    sideChosenRef.current = false;
    setSelectedSide(defaultSide(progress.sets));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideKey, unilateral, historyEpoch]);
  const currentSide: Side | null = unilateral ? selectedSide : null;

  // Badge UNIQUE par série loggée (ADR 0010) : deux axes distincts —
  //   - RÉFÉRENCE (« dernière fois », par position et par CÔTÉ en unilatéral) :
  //     e1RM strict -> « battu » / « égalisé » / rien ;
  //   - RECORD personnel (all-time) : e1RM et/ou charge.
  // À 0 kg (poids du corps), l'e1RM est nul : les reps effectives jugent.
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
              left: { bestE1rm: null, bestE1rmSet: null, bestWeightReps: null },
              right: { bestE1rm: null, bestE1rmSet: null, bestWeightReps: null },
            },
          )
        : computeSetBadges(progress.sets, reference ?? null, exercise.personalRecord ?? null),
    [unilateral, progress.sets, reference, exercise.personalRecordBySide, exercise.personalRecord],
  );

  // Brouillon de la série courante (steppers), pré-rempli par `seedDraft` (issue
  // #58 et décision du 24/11, logique pure testée) : poids et reps reportés de la
  // dernière série loggée dès la 2ᵉ, de la Référence à la 1ʳᵉ, la borne basse
  // prescrite sans aucun repère. En unilatéral (issue #46/#63),
  // on passe le côté CHOISI pour aligner le repère sur la bonne ligne G/D (série
  // logique + côté), au lieu de dériver avec les rangs doublés. Ré-amorcé au
  // changement d'exo, au log/annulation d'une série (loggedCount), ou au bascule
  // de côté (currentSide), pour reproposer le repère du côté visé. Recalculé
  // aussi quand le CONTENU des séries change (`loggedSetsKey`) : une correction
  // ne change pas leur nombre. Ce recalcul seul est un changement d'historique,
  // qui laisse en place un brouillon déjà touché (cf. l'effet plus bas).
  const setsKey = loggedSetsKey(progress.sets);
  const seed = useMemo(
    () =>
      seedDraft({
        prescription,
        reference: reference ?? null,
        // Repli cross-séances (poids seulement) quand la séance n'a pas
        // d'historique de l'exo : un point de départ, jamais un repère.
        fallbackReference: exercise.fallbackReference ?? null,
        loggedSets: progress.sets,
        side: currentSide ?? undefined,
      }),
    // La référence et son repli sont dans les dépendances : ils peuvent changer
    // sous l'écran (Référence suivie en direct, cf. CaptureScreen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exercise.exerciseId, loggedCount, setsKey, currentSide, reference, exercise.fallbackReference],
  );

  const [weightKg, setWeightKg] = useState(seed.weightKg);
  const [reps, setReps] = useState(seed.reps);
  const [rir, setRir] = useState(seed.rir);

  // Ce qui ouvre une NOUVELLE saisie : l'exo, le nombre de séries loggées, le côté.
  const draftKey = `${exercise.exerciseId}:${loggedCount}:${currentSide ?? ''}`;
  const seededKeyRef = useRef(draftKey);

  // Ré-amorce le brouillon (cf. `shouldReseedDraft`) : toujours quand une nouvelle
  // saisie commence (changement d'exo, série loggée ou annulée, changement de
  // côté), et le marqueur est alors levé ; quand seul l'historique a changé
  // sous l'écran, seulement si le brouillon est intact.
  //
  // `historyEpoch` : quand il change, le réalisé vient d'être réconcilié avec une
  // réponse tardive de la base (série arrivée d'ailleurs). Le nombre de séries a
  // pu bouger sans geste de l'utilisateur : c'est un changement d'historique,
  // pas une nouvelle saisie, donc un brouillon touché reste en place.
  const seededEpochRef = useRef(historyEpoch);
  useEffect(() => {
    const fromReality = seededEpochRef.current !== historyEpoch;
    seededEpochRef.current = historyEpoch;
    const trigger = seededKeyRef.current === draftKey || fromReality ? 'history' : 'explicit';
    seededKeyRef.current = draftKey;
    if (!shouldReseedDraft(trigger, draftTouchedRef.current)) return;
    if (trigger === 'explicit') draftTouchedRef.current = false;
    setWeightKg(seed.weightKg);
    setReps(seed.reps);
    setRir(seed.rir);
  }, [seed, draftKey, historyEpoch]);

  // Remonte le brouillon courant vers la barre d'action fixe (qui commit le log).
  // Pour un exo unilatéral, on y joint le côté CHOISI (issue #63) : c'est ce côté
  // que la barre écrira, au bon set_order. Bilatéral : pas de côté.
  useEffect(() => {
    onDraftChange?.({ weightKg, reps, rir, side: currentSide ?? undefined });
  }, [weightKg, reps, rir, currentSide, onDraftChange]);

  // Le record AFFICHÉ en repère : le record all-time de l'exo (toutes séances,
  // cf. GLOSSARY.md « Record personnel »), lu PAR CÔTÉ pour un unilatéral (le
  // bras visé au sélecteur, chaque bras tenant son propre record — ADR 0010).
  const displayRecord = unilateral
    ? exercise.personalRecordBySide?.[selectedSide] ?? null
    : exercise.personalRecord ?? null;

  // La série « à battre » à la position courante (co-roi). En unilatéral (ADR
  // 0010), on l'apparie par (position, CÔTÉ CHOISI) : le repère suit le bras que
  // tu t'apprêtes à logger — sa dernière fois à lui. Bilatéral : par position.
  // Le rang visé : en unilatéral, celui de la série que la saisie du côté choisi
  // complète ou ouvre (`targetSlotForSide`, la case en cours de la bande), pas
  // « séries complètes + 1 » : trois gauches de suite visent la 4ᵉ série à
  // gauche, la 3ᵉ à droite.
  const rank = unilateral && currentSide ? targetSlotForSide(progress.sets, currentSide) + 1 : loggedCount + 1;
  const refToBeat = unilateral
    ? reference?.find((s) => s.order === rank && s.side === currentSide) ?? null
    : reference?.find((s) => s.order === rank) ?? null;
  // Sa mesure : l'e1RM, ou les reps effectives à 0 kg (cf. perf-readout.ts).

  // Mesure du BROUILLON, recalculée à chaque réglage, pour viser avant la série.
  // Un chiffre seul, jamais un verdict « battrait » : un badge qui s'allumerait à
  // +1 de RIR pousserait à gonfler l'auto-évaluation (cf. draft-e1rm.ts).
  const livePerf = perfReadout(weightKg, reps, rir);

  // Statut de fin (si au moins le minimum prescrit est atteint), en SÉRIES
  // complètes (une série unilatérale = gauche + droite).
  const reachedMin = completedSets >= prescription.sets.min;
  // Borne HAUTE prescrite : c'est ELLE qui déclenche le récap de fin d'exo (et non
  // le min), pour ne pas couper l'enchaînement quand on vise encore une série de
  // plus dans la fourchette.
  const reachedMax = completedSets >= prescription.sets.max;
  const verdicts = summarizeBadges(progress.sets, badges).total;

  // Feuille de fin d'exo (ADR « popup de fin d'exo ») : remonte AUTOMATIQUEMENT,
  // UNE fois, à l'instant où l'on FRANCHIT la BORNE HAUTE prescrite (transition
  // false→true) — pas le min, pour ne pas couper l'enchaînement —, et pas au
  // montage d'un exo déjà terminé (reload). Non bloquante : on peut « Continuer
  // l'exo » (série de plus) ou « Revenir à la liste ». Réamorcée par exo (le
  // composant est `key`-é sur l'exerciseId → refs neuves au changement).
  const [recapOpen, setRecapOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const recapAutoShownRef = useRef(false);
  const prevReachedMaxRef = useRef(reachedMax);
  useEffect(() => {
    if (reachedMax && !prevReachedMaxRef.current && !recapAutoShownRef.current) {
      recapAutoShownRef.current = true;
      setRecapOpen(true);
    }
    prevReachedMaxRef.current = reachedMax;
  }, [reachedMax]);

  const { stepKg } = useReglages();
  // La ligne dont la feuille de correction est ouverte, ou null.
  const [editId, setEditId] = useState<string | null>(null);
  // Fermetures stables : une feuille refocalise son titre quand `onClose`
  // change, et tout rendu du parent (un envoi acquitté) volerait sinon le focus
  // de la saisie (poids au clavier, note en cours de frappe).
  const closeEdit = useCallback(() => setEditId(null), [setEditId]);
  const closeNotes = useCallback(() => setNotesOpen(false), [setNotesOpen]);
  const closeRecap = useCallback(() => setRecapOpen(false), [setRecapOpen]);
  // RIR et e1RM expliqués au toucher de leur libellé (UX 6 de l'audit du 24/11).
  const [wordsOpen, setWordsOpen] = useState(false);
  const openWords = useCallback(() => setWordsOpen(true), []);
  const closeWords = useCallback(() => setWordsOpen(false), []);
  // Écran bas (≤ 800 px, ex. 360×780) : tout se resserre pour que la rangée RIR
  // reste au-dessus de la barre du pouce, unilatéral et nom long compris.
  const compact = useCompact();
  // Écran très bas (≤ 700 px, iPhone SE en écran d'accueil) : un cran de plus.
  const tight = useCompactTight();
  const hasNote =
    !isBlankNote(datedNote) || !isBlankNote(perExerciseNote) || !!(exercise.previousDatedNote && !isBlankNote(exercise.previousDatedNote.body));
  const draft: PerformedSet = { order: rank, weightKg, reps, rir, side: currentSide ?? undefined };
  const gap = refToBeat ? gapToRef(draft, refToBeat) : null;
  // Le record se lit en reps effectives quand il est tenu à 0 kg (exo jamais chargé).
  const recordValue =
    displayRecord?.bestE1rm != null && displayRecord.bestE1rmSet
      ? isRepsRecord(displayRecord)
        ? { value: `${effectiveReps(displayRecord.bestE1rmSet.reps, displayRecord.bestE1rmSet.rir ?? 0)}`, unit: 'reps' }
        : { value: formatE1rm(displayRecord.bestE1rm), unit: 'kg' }
      : null;
  const sideWord = (s: Side) => (s === 'left' ? 'gauche' : 'droite');
  // Graduations de la règle en CRANS du pas réglé : les étiquettes tombent sur
  // des poids ronds (weight-graduations.ts).
  const { majorEvery, midEvery } = weightGraduations(stepKg);
  // Les côtés déjà faits de la série en cours, et sa place (ce que dit le
  // sélecteur : « faite pour la série n ») ; pas `rank`, qui suit le côté choisi.
  const currentOrder = currentSetOrder(progress.sets);
  const doneSides = unilateral ? sidesDoneAt(progress.sets, currentOrder) : [];
  const doneRank = slotOfOrder(progress.sets, currentOrder) + 1;

  return (
    <div className="pt-1">
      <ExerciseIndex items={index} activeId={exercise.exerciseId} onPick={onPick} />

      {/* Nom et UNE ligne : le plan, puis le bilan dès le minimum de séries (il
          rouvre le récap). Notes à droite, sans hauteur en plus. */}
      <div className="relative px-5 pt-1">
        {/* Un nom long descend d'un cran plutôt que de pousser l'instrument sous la
            barre ; il reste entier dans le Sommaire et dans le nom accessible. */}
        <h2
          className={`truncate font-[650] leading-[1.05] tracking-[-0.03em] text-ink ${
            tight
              ? // Écran très bas : tout nom au cran de 22 px, sur sa propre hauteur.
                'text-[22px]'
              : compact
                ? exercise.name.length <= 18
                  ? 'text-[28px]'
                  : 'text-[22px] leading-[29px]'
              : exercise.name.length <= 18
                ? 'text-[32px]'
                : exercise.name.length <= 24
                  ? 'text-[28px]'
                  : 'text-[22px] leading-[35px]'
          }`}
        >
          {exercise.name}
        </h2>
        <div className="mt-0.5 flex h-[22px] items-center pr-12 text-[15px] text-muted">
          {reachedMin ? (
            <button
              type="button"
              onClick={() => setRecapOpen(true)}
              aria-label={`Bilan de l’exo, ${completedSets} série${completedSets > 1 ? 's' : ''}${verdicts.record > 0 ? `, ${recordWord(badges)}` : ''} : voir le récap`}
              className="-my-3 flex min-h-11 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap"
            >
              <StateMark state="done" size={15} className="font-medium text-ink underline decoration-dim decoration-1 underline-offset-[5px]">
                fait · {completedSets} série{completedSets > 1 ? 's' : ''}
              </StateMark>
              {verdicts.record > 0 &&
                (recordWord(badges) === 'record charge' ? (
                  // Sous 340 px, « fait · 3 séries ▲ record charge » ne tient
                  // pas : « ▲ charge », comme dans la bande ; le nom lu le dit.
                  <>
                    <span className="contents [@media(max-width:339px)]:hidden">
                      <Status v="up" word="record charge" />
                    </span>
                    <span className="hidden [@media(max-width:339px)]:contents">
                      <Status v="up" word="charge" />
                    </span>
                  </>
                ) : (
                  <Status v="up" word="record" />
                ))}
              {verdicts.record === 0 && verdicts.battu > 0 && <Status v="up" word={`${verdicts.battu} battue${verdicts.battu > 1 ? 's' : ''}`} />}
              {verdicts.record === 0 && verdicts.battu === 0 && verdicts.egalise > 0 && (
                <Status v="eq" word={`${verdicts.egalise} égalée${verdicts.egalise > 1 ? 's' : ''}`} />
              )}
            </button>
          ) : (
            <span className="truncate">
              {formatRange(prescription.sets)} séries · {formatRange(prescription.reps)} reps · RIR {formatRange(prescription.rir)}
            </span>
          )}
        </div>
        <div className="absolute bottom-[-11px] right-2.5">
          <IconButton
            icon="note"
            tone="muted"
            dot={hasNote}
            label={`Notes de ${exercise.name}${hasNote ? ', une note à lire' : ''}`}
            onClick={() => setNotesOpen(true)}
          />
        </div>
      </div>

      <div className={compact ? 'mt-1' : 'mt-2'}>
        {unilateral ? (
          <UniSetBand
            sets={progress.sets}
            setIds={progress.setIds}
            badges={badges}
            draft={draft}
            side={currentSide ?? 'left'}
            plannedMax={prescription.sets.max}
            onEdit={setEditId}
          />
        ) : (
          <SetBand sets={progress.sets} setIds={progress.setIds} badges={badges} draft={draft} plannedMax={prescription.sets.max} onEdit={setEditId} />
        )}
      </div>

      {/* Toute interaction dans la zone de saisie marque le brouillon touché,
          AVANT qu'une valeur soit validée (événements pris en capture). */}
      <div onPointerDownCapture={touchDraft} onKeyDownCapture={touchDraft} onFocusCapture={touchDraft} onInputCapture={touchDraft}>
        {unilateral && currentSide ? (
          <div className="flex min-h-11 items-center justify-between gap-2 px-5">
            <div role="radiogroup" aria-label="Côté à logger" className="-ml-2.5 flex flex-none">
              {(['left', 'right'] as const).map((sd) => {
                const sel = sd === currentSide;
                const done = doneSides.includes(sd);
                return (
                  <button
                    key={sd}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    aria-label={`${sd === 'left' ? 'Gauche' : 'Droite'}${done ? `, faite pour la série ${doneRank}` : ''}`}
                    onClick={() => chooseSide(sd)}
                    className={`h-11 flex-none px-2.5 text-[17px] ${
                      sel ? 'font-semibold text-ink underline decoration-[3px] underline-offset-[8px]' : done ? 'text-faint' : 'text-muted active:text-ink'
                    }`}
                  >
                    {sd === 'left' ? 'Gauche' : 'Droite'}
                    {done && <span className="ml-1 text-[13px] text-faint">faite</span>}
                  </button>
                );
              })}
            </div>
            <RefValue rank={rank} refSet={refToBeat} hasReference={reference != null} compact />
          </div>
        ) : (
          <div className={`px-5 ${compact ? 'mt-1' : 'mt-2'}`}>
            <RefValue rank={rank} refSet={refToBeat} hasReference={reference != null} />
          </div>
        )}

        <div>
          <WeightReadout value={weightKg} onChange={(kg) => setWeightKg(roundWeightKg(kg))} />
        </div>

        <div className={tight ? 'mt-0.5' : compact ? 'mt-1' : 'mt-2'}>
          <Ruler
            key={stepKg}
            label="Poids"
            steps={weightKg / stepKg /* fractionnaire hors pas : l'aiguille tombe entre deux crans */}
            max={Math.max(Math.round(RULER_MAX_KG / stepKg), Math.ceil(weightKg / stepKg))}
            pxPerStep={Math.max(8, 11.2 * stepKg) /* un petit pas reste lisible : 8 px au moins entre deux crans */}
            isMajor={(s) => s % majorEvery === 0}
            isMid={(s) => midEvery > 0 && s % midEvery === 0}
            majorLabel={(s) => formatWeight(s * stepKg)}
            format={(s) => `${formatWeight(roundWeightKg(s * stepKg))} kg`}
            onChange={(s) => setWeightKg(roundWeightKg(s * stepKg))}
            height={compact ? 44 : 56}
            compact={compact}
          />
        </div>

        {/* Écran bas : libellé et chiffre sur une même ligne, en plus petit. */}
        {/* Écran bas : une ligne, sans « kg » (le libellé nomme la mesure) ; le
            milieu prend la place que les deux bords laissent, pour que « Écart
            e1RM » et son chiffre ne touchent pas « Record » (360 px). */}
        <dl
          className={`grid gap-3 px-5 ${
            compact ? `grid-cols-[auto_minmax(0,1fr)_auto] ${tight ? '' : 'pt-0.5'}` : 'grid-cols-3'
          }`}
        >
          <Measure
            compact={compact}
            label={livePerf?.label ?? 'e1RM'}
            live
            // « reps eff. » à 0 kg : ce n'est pas l'e1RM, pas sa définition.
            onLabel={(livePerf?.label ?? 'e1RM') === 'e1RM' ? openWords : undefined}
            labelHint="e1RM, ce que ça veut dire"
          >
            {livePerf ? <Figure value={livePerf.value} unit={livePerf.unit} compact={compact} /> : <Missing compact={compact}>·</Missing>}
          </Measure>
          {/* L'écart nomme sa mesure (« Écart e1RM »), sans verdict : signe, ni
              couleur ni ▲ (ADR 0010, draft-e1rm.ts). */}
          <Measure
            compact={compact}
            center
            // Sous 340 px (320), « Écart e1RM » et son chiffre ne tiennent pas
            // entre leurs voisines : « Écart » seul, le chiffre n'y porte pas « kg ».
            label={
              <>
                Écart<span className={compact ? '[@media(max-width:339px)]:hidden' : ''}> {gap?.measure ?? 'e1RM'}</span>
              </>
            }
          >
            {gap ? (
              <Figure value={gap.value} unit={gap.unit} compact={compact} />
            ) : (
              <Missing compact={compact}>{compact ? 'sans réf.' : 'aucune réf.'}</Missing>
            )}
          </Measure>
          {/* Écran bas : « Record » seul, le côté se lit juste au-dessus (Gauche · Droite). */}
          <Measure compact={compact} right label={unilateral && currentSide && !compact ? `Record ${sideWord(currentSide)}` : 'Record'}>
            {recordValue ? (
              <Figure value={recordValue.value} unit={recordValue.unit} compact={compact} muted />
            ) : (
              <Missing compact={compact}>aucun</Missing>
            )}
          </Measure>
        </dl>

        <div className={`flex flex-col gap-0.5 ${compact ? 'mt-1' : 'mt-2'}`}>
          {/* Remontées à chaque exo, série et côté : elles repartent calées. */}
          <NumberRow
            key={`reps-${exercise.exerciseId}-${loggedCount}-${currentSide ?? ''}`}
            label="Reps"
            min={1}
            max={Math.max(REPS_ROW_MAX, reps, prescription.reps.max)}
            value={reps}
            presc={[prescription.reps.min, prescription.reps.max]}
            refValue={refToBeat?.reps ?? null}
            onPick={setReps}
            compact={compact}
          />
          <NumberRow
            key={`rir-${exercise.exerciseId}-${loggedCount}-${currentSide ?? ''}`}
            label="RIR"
            min={0}
            max={Math.max(RIR_ROW_MAX, rir, prescription.rir.max)}
            value={rir}
            presc={[prescription.rir.min, prescription.rir.max]}
            refValue={refToBeat?.rir ?? null}
            onPick={setRir}
            compact={compact}
            onLabel={openWords}
            labelHint="RIR, ce que ça veut dire"
          />
        </div>
      </div>

      {editId !== null && progress.setIds.includes(editId) && (
        <SetEditSheet
          key={editId}
          exercise={exercise}
          progress={progress}
          setId={editId}
          onSave={(values) => onCorrectSet(editId, values)}
          onChangeSide={(side) => onChangeSetSide(editId, side)}
          onDelete={() => {
            onDeleteSet(editId);
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
        instructions={perExerciseNote}
        onSaveDatedNote={onSaveDatedNote}
        onSaveInstructions={onSaveExerciseNote}
      />
      <WordsSheet open={wordsOpen} onClose={closeWords} />
      <ExerciseRecapSheet
        open={recapOpen}
        name={exercise.name}
        unilateral={unilateral}
        hasReference={reference != null}
        sets={progress.sets}
        badges={badges}
        completedSets={completedSets}
        setsTarget={prescription.sets}
        next={next?.name ?? null}
        onNext={() => {
          setRecapOpen(false);
          onNext();
        }}
        onSommaire={() => {
          setRecapOpen(false);
          onSommaire();
        }}
        onClose={closeRecap}
      />
    </div>
  );
}

/** Une mesure sous la règle : son nom, puis le chiffre (sur la même ligne en
 *  écran bas). */
function Measure({
  label,
  compact,
  right = false,
  center = false,
  live = false,
  onLabel,
  labelHint,
  children,
}: {
  label: ReactNode;
  compact: boolean;
  right?: boolean;
  /** Écran bas : centrée entre ses deux voisines. */
  center?: boolean;
  live?: boolean;
  /** Le libellé se touche et ouvre la définition du mot (glossary-text.ts). */
  onLabel?: () => void;
  labelHint?: string;
  children: ReactNode;
}) {
  return (
    <div aria-live={live ? 'polite' : undefined} className={`${compact ? 'flex items-baseline gap-1.5' : ''} ${right ? (compact ? 'justify-end' : 'text-right') : center && compact ? 'justify-center' : ''} min-w-0`}>
      <dt className="flex-none text-[13px] text-muted">
        {onLabel ? (
          <button
            type="button"
            onClick={onLabel}
            aria-label={labelHint}
            className="-mx-2 min-w-11 px-2 text-left underline decoration-dim decoration-1 underline-offset-[3px] active:opacity-70"
          >
            {label}
          </button>
        ) : (
          label
        )}
      </dt>
      {children}
    </div>
  );
}

/** Les deux mots de l'instrument expliqués, en une feuille basse (rien ne pousse
 *  la rangée RIR sous la barre) : une phrase chacun, la même source que le
 *  premier lancement et l'Analyse (glossary-text.ts). */
function WordsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} title="RIR et e1RM" onClose={onClose}>
      <div className="flex flex-col gap-3 px-5 pb-4 text-[16px] leading-[1.45]">
        {(['rir', 'e1rm'] as const).map((key) => (
          <p key={key} className="max-w-[40ch] text-muted">
            <span className="font-semibold text-ink">{GLOSSARY_TEXT[key].term}</span> : {GLOSSARY_TEXT[key].definition.charAt(0).toLowerCase()}
            {GLOSSARY_TEXT[key].definition.slice(1)}
          </p>
        ))}
      </div>
    </Sheet>
  );
}

function Figure({ value, unit, compact, muted = false }: { value: string; unit: string | null; compact: boolean; muted?: boolean }) {
  return (
    <dd className={`tnum whitespace-nowrap font-medium leading-none tracking-[-0.01em] ${muted ? 'text-muted' : 'text-ink'} ${compact ? 'text-[17px]' : 'mt-1 text-[22px]'}`}>
      {value}
      {unit && !(compact && unit === 'kg') && <span className="ml-1 text-[13px] font-normal text-faint">{unit}</span>}
    </dd>
  );
}

function Missing({ compact, children }: { compact: boolean; children: ReactNode }) {
  return <dd className={`whitespace-nowrap text-muted ${compact ? 'text-[14px]' : 'mt-1 text-[16px] leading-[22px]'}`}>{children}</dd>;
}

/** La ligne de Référence de la série en cours : « réf. série 2 » et ses valeurs
 *  avec leur mesure (`formatPerf`), ou ce qui manque. `compact` : à droite du
 *  choix du côté, sur deux lignes serrées. */
function RefValue({
  rank,
  refSet,
  hasReference,
  compact = false,
}: {
  rank: number;
  refSet: PerformedSet | null;
  hasReference: boolean;
  compact?: boolean;
}) {
  if (!refSet) {
    return (
      <p className={`text-[14px] text-muted ${compact ? 'text-right' : ''}`}>
        {hasReference ? `Série ${rank} : rien à battre` : 'Pas encore de réf. dans cette séance'}
      </p>
    );
  }
  const values = `${formatWeight(refSet.weightKg)} × ${refSet.reps} · RIR ${refSet.rir}`;
  const perf = formatPerf(refSet);
  if (compact) {
    return (
      <p className="min-w-0 text-right leading-tight">
        <span className="block truncate text-[13px] text-muted">réf. série {rank}</span>
        <span className="tnum block whitespace-nowrap text-[14px] font-medium text-ink">{values}</span>
      </p>
    );
  }
  return (
    <p className="flex items-baseline justify-between gap-3 text-[14px]">
      <span className="shrink-0 whitespace-nowrap text-muted">réf. série {rank}</span>
      <span className="tnum min-w-0 truncate font-medium text-ink">
        {values}
        {perf && <span className="font-normal text-muted"> · {perf}</span>}
      </span>
    </p>
  );
}
