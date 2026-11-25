// PROTOTYPE JETABLE · Variante A « Sections ».
//
// Idée : la matière de l'instrument actuel, rangée en DEUX zones et quatre
// sections titrées. En haut, sur le fond, ce qu'on LIT : l'exo, la série n sur
// N, puis la section « Séries » (les séries faites et, en tête, ce qu'il faut
// battre). En dessous, sur un fond levé bord à bord, ce qu'on RÈGLE : Poids,
// Reps, RIR, chacune ouverte par un filet et son titre. Puis la barre du pouce.
// L'œil sait où il est en une seconde : lire en haut, régler au milieu, valider
// en bas. Les mesures se réduisent à ce qui sert à viser : la Référence en tête
// des séries, l'e1RM du brouillon et son écart en tête du poids ; le record part
// (il reste dans l'Analyse).
//
// « kg » : en BLOC centré. « 140 kg » est centré en entier ; le nombre quitte
// l'aiguille de la moitié de « kg » (≈ 12 px), ce que l'œil ne voit pas, alors
// qu'il voyait le bloc décalé.
import type { ReactNode } from 'react';
import { IconButton, NumberRow } from '../../../ui';
import { ExerciseIndex } from '../ExerciseIndex';
import { formatRange } from '../format';
import { SetBand, UniSetBand } from '../SetBand';
import type { VariantProps } from './ProtoSaisie';
import { ProtoWeight, SideChoice, setText, WeightRuler } from './parts';

function Air({ min, max = 24 }: { min: number; max?: number }) {
  return <div aria-hidden style={{ flex: '1 0 0px', minHeight: min, maxHeight: max }} />;
}

/** Titre de section et sa valeur d'appoint, sur une ligne. */
function Head({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-5">
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {aside && <p className="min-w-0 truncate text-right text-[14px] text-muted">{aside}</p>}
    </div>
  );
}

export function VariantA({ s, exercise, progress, index, exoPos, compact, tight, onPick, onEdit, onNotes, hasNote }: VariantProps) {
  const { prescription } = exercise;
  const draft = { order: s.rank, weightKg: s.weightKg, reps: s.reps, rir: s.rir, side: s.side ?? undefined };
  const gapAside = (
    <>
      {s.live && (
        <>
          {s.live.label} <span className="tnum font-medium text-ink">{s.live.value}</span>
        </>
      )}
      {s.gap && (
        <>
          {' · '}écart <span className="tnum font-medium text-ink">{s.gap.value}</span>
        </>
      )}
    </>
  );
  const sectionGap = tight ? 'pt-1.5' : 'pt-2.5';
  return (
    <div className="flex flex-1 flex-col pt-1">
      {/* Zone LIRE : où j'en suis, ce que je dois battre. */}
      {!tight && <ExerciseIndex items={index} activeId={exercise.exerciseId} onPick={onPick} />}
      <header className="relative px-5 pt-1.5">
        <h2 className={`truncate pr-10 font-[650] leading-[1.1] tracking-[-0.03em] text-ink ${tight ? 'text-[22px]' : compact ? 'text-[26px]' : 'text-[30px]'}`}>
          {exercise.name}
        </h2>
        <p className="mt-0.5 truncate text-[14px] text-muted">
          <span className="font-semibold text-ink">
            Série {s.rank} sur {Math.max(prescription.sets.max, s.rank)}
          </span>
          {' · '}
          {formatRange(prescription.reps)} reps · RIR {formatRange(prescription.rir)}
          {tight && ` · exo ${exoPos.n}/${exoPos.total}`}
        </p>
        <div className="absolute right-2.5 top-0">
          <IconButton icon="note" tone="muted" dot={hasNote} label={`Notes de ${exercise.name}`} onClick={onNotes} />
        </div>
      </header>

      <Air min={tight ? 6 : 10} />
      <section data-zone="haut-fin" className={`border-t border-line ${sectionGap}`}>
        <Head
          title="Séries"
          aside={
            s.refToBeat ? (
              <>
                à battre <span className="tnum font-medium text-ink">{setText(s.refToBeat)}</span>
              </>
            ) : s.hasReference ? (
              'rien à battre'
            ) : (
              'pas encore de réf.'
            )
          }
        />
        <div className="mt-1.5">
          {s.unilateral ? (
            <UniSetBand sets={progress.sets} setIds={progress.setIds} badges={s.badges} draft={draft} side={s.side ?? 'left'} plannedMax={s.plannedMax} onEdit={onEdit} />
          ) : (
            <SetBand sets={progress.sets} setIds={progress.setIds} badges={s.badges} draft={draft} plannedMax={s.plannedMax} onEdit={onEdit} />
          )}
        </div>
      </section>
      <Air min={tight ? 6 : 10} max={9999} />

      {/* Zone RÉGLER : fond levé bord à bord, trois sections. */}
      <div data-zone="bas" className="flex flex-col bg-raise pb-1">
        {s.unilateral && s.side && (
          <div className="flex items-center justify-between border-b border-line px-5">
            <span className="text-[15px] font-semibold text-ink">Côté</span>
            <SideChoice side={s.side} done={s.doneSides} onChoose={s.chooseSide} className="-mr-2.5" />
          </div>
        )}
        <section className={sectionGap}>
          <Head title="Poids" aside={gapAside} />
          <div className="mt-1">
            <ProtoWeight value={s.weightKg} onChange={s.setWeight} size={tight ? 48 : compact ? 56 : 72} unit="block" />
          </div>
          <div className="mt-1">
            <WeightRuler weightKg={s.weightKg} onChange={s.setWeight} stepKg={s.stepKg} height={tight ? 40 : compact ? 44 : 56} compact={compact} />
          </div>
        </section>
        <section className={`border-t border-line ${sectionGap}`}>
          <NumberRow
            key={`reps-${s.draftKey}`}
            label="Reps"
            min={1}
            max={Math.max(50, s.reps, prescription.reps.max)}
            value={s.reps}
            presc={[prescription.reps.min, prescription.reps.max]}
            refValue={s.refToBeat?.reps ?? null}
            onPick={s.setReps}
            compact={compact}
          />
        </section>
        <section className={`border-t border-line ${sectionGap}`}>
          <NumberRow
            key={`rir-${s.draftKey}`}
            label="RIR"
            min={0}
            max={Math.max(10, s.rir, prescription.rir.max)}
            value={s.rir}
            presc={[prescription.rir.min, prescription.rir.max]}
            refValue={s.refToBeat?.rir ?? null}
            onPick={s.setRir}
            compact={compact}
          />
        </section>
      </div>
      <Air min={tight ? 4 : 8} max={12} />
    </div>
  );
}
