// Flux de fin de séance. La DURÉE est AUTO-CHRONOMÉTRÉE (lancement -> clôture,
// cf. state.startedAt / CaptureScreen) : elle s'affiche en readout lecture seule,
// jamais saisie. Le BPM moyen reste, lui, une saisie MANUELLE et OPTIONNELLE
// (cf. décisions produit révisées). Un récap sobre encadre la saisie, puis un
// écran de confirmation clôt la séance.
//
// L'« optionnel » du BPM est matérialisé : non saisi = un bouton « Ajouter le
// BPM moyen » ; on l'ouvre pour révéler une règle (jamais de clavier), on le
// retire pour revenir à « non saisi ». Un seul bloc, « Ranger la séance » (le
// mot de la Clôture, cf. GLOSSARY.md) : il enregistre ce qui est saisi et clôt,
// puis bascule en confirmation. Sans BPM, il clôt sans rien de plus.
import { useState, type ReactNode } from 'react';
import { orderMusclesCanonical } from '../authoring/exercise-input';
import { formatCount } from './format';

/** Décompte pondéré de la fin de séance (ADR 0006) sans « ,0 » inutile : « 4 »,
 *  « 3,6 ». Les autres écrans gardent la forme à une décimale fixe. */
function formatTally(value: number): string {
  const s = formatCount(value);
  return s.endsWith(',0') ? s.slice(0, -2) : s;
}
import { errorMessage } from '../../lib/error-message';
import { PrimaryButton, Ruler, Screen, ScreenHeader, SecondaryButton, SectionTitle, TextLink } from '../../ui';

/** Ce que la fin de séance remonte au parent pour persistance (champ omis = non saisi). */
export interface SessionEndValues {
  bpmAvg?: number | null;
}

/** Récap sobre de l'exécution close : exos faits / total + décompte des séries. */
export interface SessionSummary {
  sessionName: string;
  /** Exos dont le minimum prescrit est atteint. Un exo passé n'en fait pas partie. */
  exercisesDone: number;
  /** Exos explicitement passés, sans égard à leurs séries : affichés à part. */
  exercisesSkipped: number;
  exercisesTotal: number;
  /**
   * Total des séries selon la règle de décompte pondérée par reps (issue #60,
   * affine #37) : chaque série compte `min(reps,5)/5` ; une série unilatérale
   * somme ses deux côtés. Valeur FRACTIONNAIRE (affichée à une décimale).
   */
  totalSets: number;
  /**
   * Décompte RÉEL des séries par muscle principal (issue #60), dérivé des séries
   * loggées et pondéré par reps (côté faible pour l'unilatéral), appliqué à chaque
   * muscle principal de l'exo. Valeurs FRACTIONNAIRES. Vide si aucune série loggée
   * (ou aucun muscle renseigné sur les exos faits).
   */
  setsByMuscle: Record<string, number>;
}

interface SessionEndProps {
  summary: SessionSummary;
  /**
   * Durée chronométrée de la séance (min), calculée du lancement à la clôture.
   * `null` = cas dégénéré (lancement non horodaté) : on n'affiche aucune durée.
   */
  durationMin: number | null;
  /** Enregistre les métriques (peut échouer côté réseau ; le parent gère le retry). */
  onSave: (values: SessionEndValues) => Promise<void> | void;
  /** Retour à la capture (la séance n'est pas close). */
  onBack: () => void;
  /** Repart sur une séance fraîche, depuis l'écran de confirmation de clôture. */
  onNewSession: () => void;
}

const BPM_DEFAULT = 130;
const BPM_MIN = 30;
const BPM_MAX = 240;

export function SessionEnd({
  summary,
  durationMin,
  onSave,
  onBack,
  onNewSession,
}: SessionEndProps) {
  // BPM : activé (saisi) ? + sa valeur. Replié par défaut = « non saisi ».
  const [bpmOn, setBpmOn] = useState(false);
  const [bpm, setBpm] = useState(BPM_DEFAULT);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase de confirmation : on fige les valeurs réellement enregistrées.
  const [saved, setSaved] = useState<SessionEndValues | null>(null);

  async function commit(values: SessionEndValues) {
    setSaving(true);
    setError(null);
    try {
      await onSave(values);
      setSaved(values);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // Champ omis (undefined) = colonne inchangée côté DB ; on n'envoie que le saisi.
  const handleSaveAndClose = () => void commit({ bpmAvg: bpmOn ? bpm : undefined });


  // Une fois enregistré : confirmation « Séance terminée » dans la foulée (récap
  // immédiat, état local — la clôture est transitoire, ADR 0009, elle ne survit
  // pas à un remontage).
  if (saved) {
    return (
      <SessionDone
        summary={summary}
        durationMin={durationMin}
        values={saved}
        onNewSession={onNewSession}
      />
    );
  }

  return (
    <Screen
      bottom={
        <PrimaryButton disabled={saving} onClick={handleSaveAndClose}>
          {saving ? 'Rangement…' : 'Ranger la séance'}
        </PrimaryButton>
      }
    >
      <ScreenHeader title="Fin de séance" meta={summary.sessionName} back={{ label: 'Retour à la capture', onClick: onBack }} />
      <Figures summary={summary} durationMin={durationMin} />
      <MuscleBreakdown setsByMuscle={summary.setsByMuscle} />

      <SectionTitle aside="facultatif">BPM moyen</SectionTitle>
      {bpmOn ? (
        <div className="border-t border-line pt-3">
          <p className="tnum px-5 text-center text-[32px] font-[650] leading-none tracking-[-0.03em] text-ink" aria-hidden>
            {bpm}
            <span className="ml-1.5 text-[17px] font-medium text-muted">bpm</span>
          </p>
          <div className="mt-2">
            <Ruler
              label="BPM moyen"
              steps={bpm - BPM_MIN}
              max={BPM_MAX - BPM_MIN}
              pxPerStep={8}
              isMajor={(s) => (s + BPM_MIN) % 10 === 0}
              isMid={(s) => (s + BPM_MIN) % 5 === 0}
              majorLabel={(s) => String(s + BPM_MIN)}
              format={(s) => `${s + BPM_MIN} battements par minute`}
              onChange={(s) => setBpm(s + BPM_MIN)}
            />
          </div>
          <div className="px-5">
            <TextLink tone="muted" onClick={() => setBpmOn(false)}>
              Retirer le BPM moyen
            </TextLink>
          </div>
        </div>
      ) : (
        <div className="px-5">
          <p className="text-[15px] leading-[1.45] text-muted">Fréquence cardiaque moyenne de la séance, si tu l’as.</p>
          <SecondaryButton className="mt-3" onClick={() => setBpmOn(true)}>
            Ajouter le BPM moyen
          </SecondaryButton>
        </div>
      )}

      {error && (
        <p role="alert" className="mx-5 mt-4 break-words border-l-[3px] border-ink pl-3 text-[15px] leading-[1.45] text-ink">
          Échec de l’enregistrement : {error}
        </p>
      )}
    </Screen>
  );
}

/** Une ligne de chiffres : libellé à gauche, valeur à droite. */
function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-line px-5 py-2.5">
      <span className="text-[16px] text-muted">{label}</span>
      <span className="tnum text-right text-[17px] font-medium text-ink">{value}</span>
    </div>
  );
}

/** Récap : exos faits sur le total (et passés), séries comptées, durée
 *  chronométrée (lecture seule, absente si non mesurée). */
function Figures({ summary, durationMin }: { summary: SessionSummary; durationMin: number | null }) {
  return (
    <div className="border-t border-line">
      <Line
        label="Exos faits"
        value={
          <>
            {summary.exercisesDone} sur {summary.exercisesTotal}
            {summary.exercisesSkipped > 0 && (
              <span className="text-[14px] font-normal text-muted">
                {' '}
                · {summary.exercisesSkipped} passé{summary.exercisesSkipped > 1 ? 's' : ''}
              </span>
            )}
          </>
        }
      />
      <Line label="Séries" value={formatTally(summary.totalSets)} />
      {durationMin != null && <Line label="Durée" value={`${durationMin} min`} />}
    </div>
  );
}

/**
 * Décompte RÉEL des séries par muscle principal (issue #60), pondéré par reps
 * (cf. buildSummary). On ne parle PAS de « volume » (terme proscrit,
 * GLOSSARY.md) : « séries par muscle ». Un muscle par ligne, ordre canonique,
 * une décimale ; un trait proportionnel au muscle le plus travaillé. Rendu
 * seulement s'il y a au moins un muscle.
 */
function MuscleBreakdown({ setsByMuscle }: { setsByMuscle: Record<string, number> }) {
  const muscles = orderMusclesCanonical(Object.keys(setsByMuscle));
  if (muscles.length === 0) return null;
  const max = Math.max(...muscles.map((m) => setsByMuscle[m] ?? 0), 1);
  return (
    <section aria-label="Séries par muscle">
      <SectionTitle>Séries par muscle</SectionTitle>
      <ul className="border-t border-line">
        {muscles.map((muscle) => {
          const value = setsByMuscle[muscle] ?? 0;
          return (
            <li key={muscle} className="border-b border-line px-5 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[16px] text-ink">{muscle}</span>
                <span className="tnum flex-none text-[16px] text-ink">{formatTally(value)}</span>
              </div>
              <div className="mt-1.5 h-[3px] bg-line">
                <div className="h-full bg-muted" style={{ width: `${Math.round((value / max) * 100)}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// --- Confirmation -----------------------------------------------------------

/** Écran de confirmation : séance rangée, récap, durée, BPM saisi (si présent). */
function SessionDone({
  summary,
  durationMin,
  values,
  onNewSession,
}: {
  summary: SessionSummary;
  durationMin: number | null;
  values: SessionEndValues;
  onNewSession: () => void;
}) {
  return (
    <Screen bottom={<PrimaryButton onClick={onNewSession}>Nouvelle séance</PrimaryButton>}>
      <ScreenHeader title="Séance rangée" meta={summary.sessionName} />
      <Figures summary={summary} durationMin={durationMin} />
      {typeof values.bpmAvg === 'number' && (
        <div>
          <Line label="BPM moyen" value={`${values.bpmAvg} bpm`} />
        </div>
      )}
      <MuscleBreakdown setsByMuscle={summary.setsByMuscle} />
    </Screen>
  );
}
