// Récap de fin d'exo (ADR « popup de fin d'exo ») : il monte tout seul, une
// fois, quand la borne haute du plan est franchie, et se rouvre depuis le bilan
// de l'exo. Constat sobre : séries faites face au plan, statuts face à la
// Référence et au record (par côté en unilatéral). Non
// bloquant : l'exo suivant (ou le Sommaire), ou « Continuer l'exercice » pour
// une série de plus. Feuille du kit : bornée en hauteur, sous la barre d'état.
import type { PerformedSet } from '../../domain/types';
import { PrimaryButton, SecondaryButton, Sheet, Status } from '../../ui';
import { formatRange, formatSetCount } from './format';
import { summarizeBadges, type SetBadge, type VerdictCounts } from './set-badges';

/** Statuts d'une ligne : record et battues en signal, égalées en blanc cassé. */
function Verdicts({ counts }: { counts: VerdictCounts }) {
  const parts = [
    counts.record > 0 && <Status key="r" v="up" word={`${counts.record} record${counts.record > 1 ? 's' : ''}`} />,
    counts.battu > 0 && <Status key="b" v="up" word={`${counts.battu} battue${counts.battu > 1 ? 's' : ''}`} />,
    counts.egalise > 0 && <Status key="e" v="eq" word={`${counts.egalise} égalée${counts.egalise > 1 ? 's' : ''}`} />,
  ].filter(Boolean);
  return parts.length ? <span className="flex flex-wrap items-center gap-x-3">{parts}</span> : <span className="text-muted">rien de battu</span>;
}

export function ExerciseRecapSheet({
  open,
  name,
  unilateral,
  hasReference,
  sets,
  badges,
  completedSets,
  setsTarget,
  next,
  onNext,
  onSommaire,
  onClose,
}: {
  open: boolean;
  name: string;
  unilateral: boolean;
  hasReference: boolean;
  sets: PerformedSet[];
  badges: SetBadge[];
  completedSets: number;
  setsTarget: { min: number; max: number };
  /** Le nom de l'exo suivant, ou null s'il ne reste rien. */
  next: string | null;
  onNext: () => void;
  onSommaire: () => void;
  onClose: () => void;
}) {
  const summary = summarizeBadges(sets, badges);
  return (
    <Sheet
      open={open}
      title={name}
      onClose={onClose}
      footer={
        <>
          {next ? (
            <PrimaryButton over="Exo suivant" onClick={onNext}>
              {next}
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={onSommaire}>Sommaire</PrimaryButton>
          )}
          <SecondaryButton onClick={onClose}>Continuer l’exercice</SecondaryButton>
        </>
      }
    >
      <div className="px-5 pb-2 text-[16px] leading-[1.45]">
        <p className="text-ink">
          <span className="tnum font-semibold">{formatSetCount(completedSets)}</span> série{completedSets > 1 ? 's' : ''}{' '}
          <span className="text-muted">· plan {formatRange(setsTarget)}</span>
        </p>
        <div className="mt-2 text-[15px]">
          {!hasReference ? (
            <p className="text-muted">Premier passage dans cette séance, rien à comparer.</p>
          ) : unilateral ? (
            <div className="flex flex-col gap-1">
              <p className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium text-ink">Gauche</span> <Verdicts counts={summary.left} />
              </p>
              <p className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium text-ink">Droite</span> <Verdicts counts={summary.right} />
              </p>
            </div>
          ) : (
            <Verdicts counts={summary.total} />
          )}
        </div>
      </div>
    </Sheet>
  );
}
