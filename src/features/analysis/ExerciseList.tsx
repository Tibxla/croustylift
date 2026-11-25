// L'onglet « Exos » de l'Analyse : la question « est-ce que je progresse ? »
// d'un coup d'œil (refonte E, prototype e/analyse.tsx).
//
// En tête, une phrase de synthèse sur la ROUTINE COURANTE seulement : combien
// d'exos de son plan montent, stagnent, reculent sur le bloc en cours, puis ce
// qui n'a pas encore de pente. Dessous, une ligne par exo du plan, dans l'ordre
// du plan : pente en clair, dernière mesure, date ; la colonne est nommée une
// fois, en tête de section (« e1RM, dernière séance »). Toucher une ligne ouvre la
// courbe. Les exos hors plan (anciennes routines, ajouts ponctuels) suivent,
// éteints : ils ne comptent pas dans la phrase mais restent lisibles.
//
// Pur : il prend les analyses et le plan déjà chargés.
import { List, Row, SectionTitle, Status } from '../../ui';
import { loadHiddenCurves } from '../../lib/local-prefs';
import type { ExerciseAnalysis } from './data';
import { leadCurve, summarizeRoutine } from './exercise-reading';
import { formatDay } from './rate-period';
import { SlopeStatus } from './SlopeStatus';

/** La courbe qui porte la lecture d'un exo, masquage de l'appareil compris. */
const leadOf = (a: ExerciseAnalysis) => leadCurve(a, new Set(loadHiddenCurves(a.exerciseId)));

/** Accord du verbe : « 0 recule », « 1 recule », « 2 reculent ». */
const verb = (n: number, one: string, many: string) => (n > 1 ? many : one);
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export function ExerciseList({
  analyses,
  plan,
  routineName,
  onOpen,
}: {
  analyses: ExerciseAnalysis[];
  /** Les exos du plan de la routine courante, dans l'ordre ; vide sans routine. */
  plan: string[];
  /** Nom de la routine courante ; `null` (hors ligne) : « Ta routine ». */
  routineName: string | null;
  onOpen: (exerciseId: string) => void;
}) {
  const year = new Date().getFullYear();
  const planIds = new Set(plan);
  // Sans routine courante (ou sans plan), tout l'historique se lit comme une routine.
  const scoped = plan.length > 0;
  const inPlan = scoped ? analyses.filter((a) => planIds.has(a.exerciseId)) : analyses;
  const outPlan = scoped ? analyses.filter((a) => !planIds.has(a.exerciseId)) : [];
  const summary = summarizeRoutine(analyses, scoped ? plan : analyses.map((a) => a.exerciseId), leadOf);
  const { up, eq, down } = summary.counts;
  const judged = up + eq + down;

  return (
    <>
      <section aria-label="Synthèse" className="px-5 pb-1 pt-5">
        {judged > 0 ? (
          <p className="text-[22px] font-medium leading-[1.35] tracking-[-0.01em] text-ink">
            {scoped ? (routineName ?? 'Ta routine') : 'Tes exos'} :{' '}
            <Status v="up" size={13} word={`${up} ${verb(up, 'monte', 'montent')}`} />,{' '}
            <Status v="eq" size={13} word={`${eq} ${verb(eq, 'stagne', 'stagnent')}`} />,{' '}
            <Status v="down" size={13} word={`${down} ${verb(down, 'recule', 'reculent')}`} />.
          </p>
        ) : (
          <p className="text-[22px] font-medium leading-[1.35] tracking-[-0.01em] text-ink">
            {scoped ? (routineName ?? 'Ta routine') : 'Tes exos'} : pas encore de pente sur ce bloc.
          </p>
        )}
        {(summary.thin.length > 0 || summary.notYet > 0) && (
          <p className="mt-2 max-w-[42ch] text-[15px] leading-[1.45] text-muted">
            {summary.thin.length > 0 && <>{summary.thin.join(', ')} : pas encore de pente, il faut des séances sur trois jours différents. </>}
            {summary.notYet > 0 &&
              `${plural(summary.notYet, 'exo')}${scoped ? ' du plan' : ''} pas encore ${summary.notYet > 1 ? 'faits' : 'fait'} dans ce bloc.`}
          </p>
        )}
        <p className="mt-2 text-[14px] leading-[1.45] text-faint">
          Pente de chaque exo sur sa séance la plus récente, 1ʳᵉ série.
        </p>
      </section>

      <section aria-labelledby="analyse-exos-plan">
        {/* La colonne de droite se nomme une fois, ici : « 217 kg » seul se lisait
            comme une charge soulevée. */}
        <SectionTitle id="analyse-exos-plan" aside={inPlan.length > 0 ? 'e1RM, dernière séance' : undefined}>
          {scoped ? 'Exos de la routine' : 'Exos'}
        </SectionTitle>
        {inPlan.length === 0 ? (
          <p className="mx-4 rounded-note bg-surface px-4 py-3 text-[15px] leading-[1.45] text-muted">
            Aucun exo de la routine n’a encore de série. Les courbes partent de la première série loggée.
          </p>
        ) : (
          <List label="Exos de la routine">
            {inPlan.map((a) => (
              <ExerciseRow key={a.exerciseId} analysis={a} year={year} onOpen={onOpen} />
            ))}
          </List>
        )}
      </section>

      {outPlan.length > 0 && (
        <section aria-labelledby="analyse-exos-hors">
          <SectionTitle id="analyse-exos-hors" aside="hors synthèse">
            Hors de la routine
          </SectionTitle>
          <List label="Exos hors de la routine">
            {outPlan.map((a) => (
              <ExerciseRow key={a.exerciseId} analysis={a} year={year} onOpen={onOpen} muted />
            ))}
          </List>
        </section>
      )}
    </>
  );
}

function ExerciseRow({
  analysis,
  year,
  onOpen,
  muted = false,
}: {
  analysis: ExerciseAnalysis;
  year: number;
  onOpen: (exerciseId: string) => void;
  muted?: boolean;
}) {
  const lead = leadOf(analysis);
  const last = lead?.curve[lead.curve.length - 1];
  return (
    <Row
      title={analysis.name}
      muted={muted}
      meta={lead ? <SlopeStatus weeklyRate={lead.weeklyRate} period={lead.ratePeriod} /> : 'aucune courbe'}
      value={
        last ? (
          <>
            {Math.round(last.e1rm)}
            <span className="ml-1 text-[14px] font-normal text-muted">{analysis.unit}</span>
          </>
        ) : undefined
      }
      valueMeta={last ? formatDay(last.date, year) : undefined}
      onClick={() => onOpen(analysis.exerciseId)}
      ariaLabel={`${analysis.name}. Ouvrir la courbe`}
    />
  );
}
