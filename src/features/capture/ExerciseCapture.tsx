// L'instrument de la Salle (refonte E « Signal », variante A4 « Pied léger,
// aéré » validée par l'utilisateur le 25/11) : un seul exo à l'écran, en deux
// zones. Le pied (Sommaire, Annuler, Exo suivant, Logger) vit dans CaptureScreen.
//
// HAUT, ce qui se LIT : l'index des exos (toucher un numéro ouvre l'exo), le nom,
// « Série n sur N » et le plan (puis le bilan dès le minimum de séries, qui
// rouvre le récap), l'icône Notes, la bande des séries sur une ligne
// (SetBand.tsx), puis le bloc toujours visible : « Cette série » et la mesure du
// brouillon en grand, puis « Dernière fois » (la Référence du même rang et du
// même côté) et « Record » (le record e1RM courant), chacun avec la position du
// brouillon en direct (« ▲ +3,2 au-dessus », « ▬ à égalité », « ▼ −6,3 en
// dessous », draft-score.ts). En unilatéral, Gauche · Droite prend la place de
// « Cette série », sur la même ligne.
//
// BAS, ce qui se RÈGLE, en trois plaques au fond levé séparées par le fond noir :
// le poids (« 140 kg » centré en entier sur l'aiguille, toucher = saisie précise
// au clavier) et sa règle à élan (pas réglé dans Réglages), la rangée Reps, la
// rangée RIR. Les rangées glissent (l'utilisateur y tient) ; entre deux zones
// tactiles de plaques voisines, 16 px au moins de rien.
//
// RYTHME VERTICAL. L'instrument est une colonne qui remplit la hauteur au-dessus
// du pied. Entre les groupes du haut, l'air se répartit, plafonné ; tout le
// surplus va entre le haut et le bas, pour que les plaques restent dans la zone
// du pouce, juste au-dessus du pied. Sur un écran bas (≤ 800 px, dont l'iPhone
// de l'utilisateur en écran d'accueil, 393 × 793) puis très bas (≤ 700 px), les
// tailles se resserrent (`useCompact`, `useCompactTight`) : rien ne défile.
//
// SIGNAL. Le ▲ du brouillon au-dessus de la Référence ou du Record prend le
// signal dès le réglage (choix de l'utilisateur du 25/11, risque de gonfler le
// RIR accepté, cf. draft-e1rm.ts et l'amendement du 2026-11-25 de l'ADR 0010) ;
// ▬ en blanc cassé, ▼ en gris. Des mots de position, jamais un verdict :
// « battue », « égalée » et « record » ne portent que sur des séries faites.
// À 0 kg, la mesure est en reps effectives (`perfReadout`, ADR 0013).
//
// Toucher une case loggée de la bande ouvre la feuille de correction de CETTE
// ligne (SetEditSheet) ; ses gestes (corriger, changer de côté, supprimer)
// remontent au parent, qui les écrit. La feuille est rendue hors de la zone de
// saisie : ses événements, qui remontent à travers le portail, ne marquent pas
// le brouillon comme touché.
//
// Les libellés « e1RM » (« Cette série ») et « RIR » (rangée) se touchent : une
// feuille basse dit en une phrase ce que veut dire chaque mot
// (src/lib/glossary-text.ts), sans ligne de plus sur l'instrument.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { currentSetOrder, defaultSide, pairSidesByOrder, sidesDoneAt, slotOfOrder, targetSlotForSide } from '../../domain/unilateral';
import { isBlankNote } from '../../domain/notes';
import type { Side } from '../../domain/types';
import { useReglages } from '../../settings/reglages';
import { IconButton, NumberRow, Ruler, Sheet, Sign, StateMark, Status, TONE, useCompact, useCompactTight } from '../../ui';
import { GLOSSARY_TEXT } from '../../lib/glossary-text';
import type { SessionExercise } from './fixtures';
import type { ExerciseProgress } from './state';
import { loggedSetsKey, seedDraft, shouldReproposeSide, shouldReseedDraft } from './capture-seed';
import { draftScore, type DraftScore, type Standing } from './draft-score';
import { ExerciseIndex, type IndexItem } from './ExerciseIndex';
import { ExerciseRecapSheet } from './ExerciseRecapSheet';
import { NotesSheet } from './NotesSheet';
import { currentRecord } from './record-flags';
import { bandCells } from './set-band';
import { SetBand } from './SetBand';
import { WeightReadout } from './WeightReadout';
import { computeSetBadges, computeSetBadgesBySide, recordWord, summarizeBadges, type SetBadge } from './set-badges';
import { formatRange, formatWeight } from './format';
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

  // Le record en repère : le record all-time de l'exo (toutes séances, cf.
  // GLOSSARY.md « Record personnel »), lu PAR CÔTÉ pour un unilatéral (le bras
  // visé au sélecteur, chaque bras tenant son propre record, ADR 0010), et
  // AVANCÉ par les séries du jour de ce côté : c'est le record COURANT, celui
  // que la prochaine série devra passer pour porter « record ».
  const historicalRecord = unilateral ? exercise.personalRecordBySide?.[selectedSide] ?? null : exercise.personalRecord ?? null;
  const record = currentRecord(progress.sets, historicalRecord, currentSide ?? undefined);

  // « Cette série », « Dernière fois », « Record » : la mesure du brouillon et sa
  // position en direct face aux deux repères, recalculées à chaque réglage
  // (draft-score.ts ; décision et risque accepté en tête de draft-e1rm.ts).
  const score = draftScore({ draft: { weightKg, reps, rir }, refSet: refToBeat, hasReference: reference != null, record });

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
  // reste au-dessus du pied, unilatéral et nom long compris.
  const compact = useCompact();
  // Écran très bas (≤ 700 px, iPhone SE en écran d'accueil) : un cran de plus.
  const tight = useCompactTight();
  const hasNote =
    !isBlankNote(datedNote) || !isBlankNote(perExerciseNote) || !!(exercise.previousDatedNote && !isBlankNote(exercise.previousDatedNote.body));
  const draft = { weightKg, reps, rir };
  const cells = bandCells({ sets: progress.sets, setIds: progress.setIds, plannedMax: prescription.sets.max, unilateral, side: currentSide });
  // Graduations de la règle en CRANS du pas réglé : les étiquettes tombent sur
  // des poids ronds (weight-graduations.ts).
  const { majorEvery, midEvery } = weightGraduations(stepKg);
  // Les côtés déjà faits de la série en cours, et sa place (ce que dit le
  // sélecteur : « faite pour la série n ») ; pas `rank`, qui suit le côté choisi.
  const currentOrder = currentSetOrder(progress.sets);
  const doneSides = unilateral ? sidesDoneAt(progress.sets, currentOrder) : [];
  const doneRank = slotOfOrder(progress.sets, currentOrder) + 1;

  // Paliers de hauteur : le poids, la règle et les rangées se resserrent d'un
  // cran sur écran bas, de deux sur écran très bas. L'air a ses planchers.
  const weightSize = tight ? 48 : compact ? (unilateral ? 56 : 64) : 72;
  const rulerHeight = tight ? 44 : compact ? 48 : 58;
  // Air : 14 px au moins entre les groupes, 10 sur écran bas, 6 très bas (les
  // 14 px du prototype ne tiennent pas avec la marge de navigation de l'app
  // installée, 14 px de plus en haut).
  const airMin = tight ? 6 : compact ? 10 : 14;
  const plannedTotal = Math.max(prescription.sets.max, rank);

  return (
    // Colonne qui prend toute la hauteur au-dessus du pied : l'air du haut se
    // répartit (plafonné), le surplus va entre le haut et les plaques.
    <div className="flex flex-1 flex-col pt-1">
      {/* Écran très bas (≤ 700 px, iPhone SE en écran d'accueil) : pas d'index,
          sinon les plaques passent sous le pied. Le Sommaire et « Exo suivant »
          restent à un toucher. */}
      {!tight && <ExerciseIndex items={index} activeId={exercise.exerciseId} onPick={onPick} />}

      {/* Nom et UNE ligne : « Série n sur N » et le plan, puis le bilan dès le
          minimum de séries (il rouvre le récap). Notes à droite, sans hauteur en plus. */}
      <header className={`relative px-5 ${tight ? '' : compact ? 'pt-1' : 'pt-2'}`}>
        {/* Un nom long descend d'un cran plutôt que de pousser les plaques sous le
            pied ; il reste entier dans le Sommaire et dans le nom accessible. */}
        <h2
          className={`truncate pr-10 font-[650] leading-[1.1] tracking-[-0.03em] text-ink ${
            tight
              ? 'text-[22px]'
              : compact
                ? exercise.name.length <= 18
                  ? 'text-[28px]'
                  : 'text-[22px] leading-[31px]'
                : exercise.name.length <= 18
                  ? 'text-[32px]'
                  : exercise.name.length <= 24
                    ? 'text-[28px]'
                    : 'text-[22px] leading-[35px]'
          }`}
        >
          {exercise.name}
        </h2>
        <div className="mt-1 flex h-[22px] items-center pr-2 text-[15px] text-muted">
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
              <span className="font-semibold text-ink">
                Série {rank} sur {plannedTotal}
              </span>
              {' · '}
              {formatRange(prescription.reps)} reps · RIR {formatRange(prescription.rir)}
            </span>
          )}
        </div>
        <div className="absolute right-2.5 top-0">
          <IconButton
            icon="note"
            tone="muted"
            dot={hasNote}
            label={`Notes de ${exercise.name}${hasNote ? ', une note à lire' : ''}`}
            onClick={() => setNotesOpen(true)}
          />
        </div>
      </header>

      <Air min={airMin} max={30} />
      <SetBand cells={cells} badges={badges} draft={draft} unilateral={unilateral} onEdit={setEditId} />
      <Air min={airMin} max={30} />

      {/* Toute interaction dans la zone de saisie marque le brouillon touché,
          AVANT qu'une valeur soit validée (événements pris en capture). La zone
          ne fait pas de boîte (`contents`) : ses groupes et l'air entre eux
          restent des enfants de la colonne. */}
      <div className="contents" onPointerDownCapture={touchDraft} onKeyDownCapture={touchDraft} onFocusCapture={touchDraft} onInputCapture={touchDraft}>
        <section aria-label="Cette série" className={`mx-5 border-t border-line ${tight ? 'pt-1.5' : compact ? 'pt-2' : 'pt-3'}`}>
          <div className="flex min-h-7 items-center justify-between gap-3">
            {unilateral && currentSide ? (
              <div role="radiogroup" aria-label="Côté à logger" className="-my-2 -ml-2.5 flex flex-none">
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
            ) : (
              <span className="text-[15px] text-muted">Cette série</span>
            )}
            <LiveMeasure live={score.live} onWord={openWords} />
          </div>
          <dl className="mt-2 grid grid-cols-2">
            <Marker term="Dernière fois">
              {score.last.kind === 'set' ? (
                <>
                  <dd className="tnum mt-0.5 truncate text-[16px] font-medium text-ink [@media(max-width:359px)]:text-[14px]">
                    {formatWeight(score.last.set.weightKg)} × {score.last.set.reps} · RIR {score.last.set.rir}
                  </dd>
                  <Position standing={score.last.standing} />
                </>
              ) : (
                <Absent>{score.last.word}</Absent>
              )}
            </Marker>
            <Marker term="Record" right>
              {score.record.kind === 'record' ? (
                <>
                  <dd className="tnum mt-0.5 truncate text-[16px] font-medium text-ink [@media(max-width:359px)]:text-[14px]">
                    {score.record.label} {score.record.value}
                  </dd>
                  <Position standing={score.record.standing} />
                </>
              ) : (
                <Absent>{score.record.word}</Absent>
              )}
            </Marker>
          </dl>
        </section>

        {/* Le surplus de hauteur : les plaques restent au-dessus du pied, dans la zone du pouce. */}
        <Air min={airMin} />

        {/* Trois plaques, séparées par le fond : entre deux zones tactiles
            voisines, 4 + écart + 4 px de rien (16 px au moins). */}
        <div className="flex flex-col" style={{ gap: tight ? 8 : compact ? 10 : 14 }}>
          <div data-plate="poids" className={`${PLATE} pb-1.5 ${tight ? 'pt-2' : 'pt-3'}`}>
            <WeightReadout value={weightKg} kg="bloc" size={weightSize} onChange={(kg) => setWeightKg(roundWeightKg(kg))} />
            <div className={tight ? 'mt-1' : 'mt-2'}>
              <Ruler
                key={stepKg}
                label="Poids"
                steps={weightKg / stepKg /* fractionnaire hors pas : l'aiguille tombe entre deux crans */}
                max={Math.max(Math.round(RULER_MAX_KG / stepKg), Math.ceil(weightKg / stepKg))}
                pxPerStep={Math.max(8, 11.2 * stepKg) /* un petit pas reste lisible : 8 px au moins entre deux crans */}
                isMajor={(st) => st % majorEvery === 0}
                isMid={(st) => midEvery > 0 && st % midEvery === 0}
                majorLabel={(st) => formatWeight(st * stepKg)}
                format={(st) => `${formatWeight(roundWeightKg(st * stepKg))} kg`}
                onChange={(st) => setWeightKg(roundWeightKg(st * stepKg))}
                height={rulerHeight}
                compact={compact}
              />
            </div>
          </div>
          {/* Remontées à chaque exo, série et côté : elles repartent calées. */}
          <div data-plate="reps" className={`${PLATE} py-1`}>
            <NumberRow
              key={`reps-${exercise.exerciseId}-${loggedCount}-${currentSide ?? ''}`}
              layout="ligne"
              label="Reps"
              min={1}
              max={Math.max(REPS_ROW_MAX, reps, prescription.reps.max)}
              value={reps}
              presc={[prescription.reps.min, prescription.reps.max]}
              refValue={refToBeat?.reps ?? null}
              onPick={setReps}
              compact={tight}
            />
          </div>
          <div data-plate="rir" className={`${PLATE} py-1`}>
            <NumberRow
              key={`rir-${exercise.exerciseId}-${loggedCount}-${currentSide ?? ''}`}
              layout="ligne"
              label="RIR"
              min={0}
              max={Math.max(RIR_ROW_MAX, rir, prescription.rir.max)}
              value={rir}
              presc={[prescription.rir.min, prescription.rir.max]}
              refValue={refToBeat?.rir ?? null}
              onPick={setRir}
              compact={tight}
              onLabel={openWords}
              labelHint="RIR, ce que ça veut dire"
            />
          </div>
        </div>
      </div>

      {/* Au-dessus du pied : 8 px au moins, donc 16 px de rien entre la rangée
          RIR et les liens du pied (marge de plaque et du pied comprises). */}
      <Air min={8} max={12} />

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

/** Une plaque de réglage : fond levé, rayon et retrait latéral en jetons du
 *  thème (`--radius-plate`, `--plate-inset`, src/index.css), à 0 tant que le
 *  traitement d'arrondi n'est pas choisi. Aucun rayon en dur. */
const PLATE = 'overflow-hidden rounded-plate bg-raise mx-(--plate-inset)';

/** Air entre deux groupes de l'instrument : un plancher, puis une part de la
 *  hauteur libre, plafonnée ou non. Aucune animation : la répartition suit la
 *  hauteur de l'écran, pas les gestes. */
function Air({ min, max }: { min: number; max?: number }) {
  return <div aria-hidden style={{ flex: '1 0 0px', minHeight: min, maxHeight: max }} />;
}

/** « e1RM 220 » à droite de « Cette série » : la mesure du brouillon, en direct.
 *  Le mot « e1RM » se touche et ouvre sa définition ; « reps eff. » (0 kg) non. */
function LiveMeasure({ live, onWord }: { live: DraftScore['live']; onWord: () => void }) {
  return (
    <p aria-live="polite" className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
      {live?.label === 'reps eff.' ? (
        <span className="text-[15px] text-muted">reps eff.</span>
      ) : (
        <button
          type="button"
          onClick={onWord}
          aria-label="e1RM, ce que ça veut dire"
          className="-my-2 min-h-11 px-1 text-[15px] text-muted underline decoration-dim decoration-1 underline-offset-[3px] active:opacity-70"
        >
          e1RM
        </button>
      )}
      <span className="tnum text-[22px] font-medium leading-none tracking-[-0.01em] text-ink">{live ? live.value : '·'}</span>
    </p>
  );
}

/** Une colonne du bloc : « Dernière fois » ou « Record », filet entre les deux. */
function Marker({ term, right = false, children }: { term: string; right?: boolean; children: ReactNode }) {
  return (
    <div className={`min-w-0 ${right ? 'border-l border-line pl-3' : 'pr-3'}`}>
      <dt className="text-[13px] text-muted">{term}</dt>
      {children}
    </div>
  );
}

function Absent({ children }: { children: ReactNode }) {
  return <dd className="mt-0.5 truncate text-[16px] text-muted [@media(max-width:359px)]:text-[14px]">{children}</dd>;
}

/** La position du brouillon face au repère, en direct : signe + écart + mot,
 *  dans la teinte de la triade (▲ au signal, ▬ blanc cassé, ▼ gris). Une ligne
 *  toujours réservée : rien ne bouge quand elle apparaît. */
function Position({ standing }: { standing: Standing | null }) {
  return (
    <dd className="mt-0.5 h-5">
      {standing && (
        <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[14px] leading-5 ${TONE[standing.v]}`}>
          <Sign v={standing.v} size={10} />
          {standing.gap && <span className="tnum font-medium">{standing.gap}</span>}
          {standing.word}
        </span>
      )}
    </dd>
  );
}

/** Les deux mots de l'instrument expliqués, en une feuille basse (rien ne pousse
 *  les plaques sous le pied) : une phrase chacun, la même source que le premier
 *  lancement et l'Analyse (glossary-text.ts). */
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
