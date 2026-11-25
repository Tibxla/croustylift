// La surface « Analyse au calme » (refonte E, prototype e/analyse.tsx) : est-ce
// que je progresse, honnêtement ?
//
// Racine en deux onglets de mots sous le titre (pas de nouvelle entrée de nav) :
//   Exos     une phrase de synthèse sur la routine courante, puis une ligne par
//            exo (pente du bloc en cours, dernière mesure) ; toucher ouvre la
//            page de l'exo (courbe parcourue au doigt, séries 2+, comparaison
//            de deux blocs) ;
//   Journal  l'historique brut séance par séance (ce que chacune a battu),
//            puis la durée et le BPM dans le temps ; une séance s'ouvre (le
//            statut de chaque série face à sa Référence), puis se corrige.
// Sous le titre, « Que veulent dire ces mots ? » déplie e1RM, pente, bloc et
// Référence. Vue d'ensemble et Journal se lisent dans une copie datée
// (lib/dated-read) : hors ligne, la dernière copie avec sa date, ou une phrase
// sans « Erreur » quand l'appareil n'en a pas.
// Les sous-pages s'empilent dans l'écran (pile locale) : « ‹ Analyse » revient
// d'un cran, à la position de défilement quittée. Changer de surface les vide.
//
// L'écran sépare le CHARGEMENT (Supabase) de la PRÉSENTATION : `ExerciseList`,
// `ExercisePage`, `RawLogView`, `SessionPage` sont purs, montables sans réseau.
// Après une correction, tout est relu sans repasser par l'écran de chargement :
// les données affichées restent jusqu'à l'arrivée des nouvelles.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Choice, CopyNote, EmptyState, OfflineState, Screen, ScreenHeader, SecondaryButton } from '../../ui';
import { invalidateViews, JOURNAL_VIEW, OVERVIEW_VIEW } from '../../lib/dated-read';
import { useDatedLoad } from '../../lib/use-dated-load';
import { clearSurfaceIntent, peekSurfaceIntent, useGoToSurface } from '../../shell/navigation';
import { getCurrentRoutineId, listRoutines } from '../authoring/data';
import { resolveCaptureRoutineId } from '../capture/data';
import { loadAnalyses, loadPlanExerciseOrder, loadRawLog, loadSessionMetrics, type ExerciseAnalysis } from './data';
import type { SessionMetricPoint } from './session-metrics';
import { BlockComparisonPanel } from './BlockComparisonPanel';
import { ExerciseList } from './ExerciseList';
import { journalVerdicts } from './journal-verdicts';
import { analysisFrame, seanceLookup } from './analysis-frame';
import { ExercisePage } from './ExercisePage';
import { PastSessionEditor } from './PastSessionEditor';
import { RawLogView, SessionPage } from './RawLogView';
import { periodLabel } from './rate-period';
import { WordsHelp } from './WordsHelp';

type Tab = 'exos' | 'journal';
const TABS: { value: Tab; label: string }[] = [
  { value: 'exos', label: 'Exos' },
  { value: 'journal', label: 'Journal' },
];

/** Une page de la pile : l'index (onglets), un exo, sa comparaison, une séance, sa correction. */
type View =
  | { page: 'index' }
  | { page: 'exo'; id: string }
  | { page: 'compare'; id: string }
  | { page: 'seance'; id: string }
  | { page: 'edit'; id: string };

interface Overview {
  analyses: ExerciseAnalysis[];
  metrics: SessionMetricPoint[];
  /** Exos du plan de la routine courante (la synthèse ne lit qu'eux). */
  plan: string[];
  /** Nom de la routine courante, `null` s'il n'a pas pu être lu (hors ligne). */
  routineName: string | null;
}

/**
 * Le nom de la routine courante, résolue comme le plan qu'ordonne
 * `loadPlanExerciseOrder` (activation la plus récente parmi les routines non
 * archivées, cf. `resolveCaptureRoutineId`) : la phrase nomme la routine dont
 * elle compte les exos.
 */
async function loadCurrentRoutineName(): Promise<string | null> {
  const [currentId, routines] = await Promise.all([getCurrentRoutineId(), listRoutines()]);
  const active = routines.filter((r) => r.archived_at === null);
  const id = resolveCaptureRoutineId(
    currentId,
    active.map((r) => r.id),
  );
  return active.find((r) => r.id === id)?.name ?? null;
}

// Les courbes, les mesures de séance, le plan courant et le nom de sa routine,
// lus ensemble. Le plan est relu à part (`loadPlanExerciseOrder`, que
// `loadAnalyses` lit aussi pour ordonner) : la couche de données ne dit pas
// quels exos sont au plan, ni le nom de la routine.
const loadOverview = async (): Promise<Overview> => {
  const [analyses, metrics, plan, routineName] = await Promise.all([
    loadAnalyses(),
    loadSessionMetrics(),
    loadPlanExerciseOrder(),
    // Le nom n'est qu'un mot de la phrase : sans lui, elle dit « Ta routine ».
    loadCurrentRoutineName().catch(() => null),
  ]);
  return { analyses, metrics, plan, routineName };
};

export function AnalysisScreen() {
  // Arrivée par « Voir au Journal » (Séance rangée) : l'onglet Journal d'emblée,
  // la séance rangée en tête (le plus récent d'abord). Intention lue au rendu,
  // effacée au montage (navigation.ts).
  const [openOnJournal] = useState(() => peekSurfaceIntent('analysis')?.open === 'journal');
  useEffect(() => clearSurfaceIntent('analysis'), []);
  const [tab, setTab] = useState<Tab>(openOnJournal ? 'journal' : 'exos');
  const [stack, setStack] = useState<View[]>([{ page: 'index' }]);
  const view = stack[stack.length - 1]!;
  // Le journal ne se lit qu'à l'ouverture de son onglet (il peut être lourd).
  const [journalWanted, setJournalWanted] = useState(openOnJournal);
  const overview = useDatedLoad(OVERVIEW_VIEW, loadOverview);
  const journal = useDatedLoad(journalWanted ? JOURNAL_VIEW : null, loadRawLog);
  // Le statut de chaque série face à sa Référence, recalculé sur tout le journal.
  const journalEntries = journal.state.phase === 'ready' ? journal.state.value : null;
  const verdicts = useMemo(() => (journalEntries ? journalVerdicts(journalEntries) : new Map()), [journalEntries]);

  // Défilement : une page poussée s'ouvre en haut, un retour retrouve la
  // position quittée.
  const scrolls = useRef<number[]>([]);
  const pendingScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingScroll.current === null) return;
    window.scrollTo(0, pendingScroll.current);
    pendingScroll.current = null;
  }, [stack]);

  const push = (next: View) => {
    scrolls.current.push(window.scrollY);
    pendingScroll.current = 0;
    setStack((s) => [...s, next]);
  };
  const back = () => {
    pendingScroll.current = scrolls.current.pop() ?? 0;
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  };
  const popTo = (page: View['page']) => {
    let at = -1;
    for (let i = stack.length - 1; i >= 0 && at < 0; i -= 1) if (stack[i]!.page === page) at = i;
    if (at < 0) return;
    pendingScroll.current = scrolls.current[at] ?? 0;
    scrolls.current = scrolls.current.slice(0, at);
    setStack(stack.slice(0, at + 1));
  };
  const chooseTab = (t: Tab) => {
    setTab(t);
    if (t === 'journal') setJournalWanted(true);
  };
  // Une correction ou une suppression change le journal ET les courbes, les
  // mesures de séance comprises (un point de durée périmé restait affiché).
  // Leurs copies sont périmées : la relecture passe par le réseau.
  const afterMutation = () => {
    invalidateViews([OVERVIEW_VIEW, JOURNAL_VIEW]);
    overview.refresh();
    journal.refresh();
  };

  // La correction ne lit pas l'aperçu : elle reste montée quoi qu'il devienne
  // (coupure réseau sans copie, relecture), son brouillon avec (analysis-frame).
  if (view.page === 'edit' && analysisFrame(view.page, overview.state.phase) === 'page') {
    return (
      <PastSessionEditor
        key={view.id}
        executionId={view.id}
        onClose={back}
        onSaved={() => {
          afterMutation();
          back();
        }}
        onDeleted={() => {
          afterMutation();
          popTo('index');
        }}
      />
    );
  }
  if (overview.state.phase === 'loading') {
    return (
      <Page>
        <ScreenHeader title="Analyse" />
        <p role="status" className="px-5 py-6 text-[15px] text-muted">
          Chargement de l’analyse…
        </p>
      </Page>
    );
  }
  if (overview.state.phase === 'offline') {
    return (
      <Page>
        <ScreenHeader title="Analyse" />
        <OfflineState surface="L’Analyse" />
      </Page>
    );
  }
  if (overview.state.phase === 'error') {
    return (
      <Page>
        <ScreenHeader title="Analyse" />
        <LoadError what="ton analyse" message={overview.state.message} onRetry={overview.reload} />
      </Page>
    );
  }

  const { analyses, metrics, plan, routineName } = overview.state.value;

  switch (view.page) {
    case 'exo':
    case 'compare': {
      const analysis = analyses.find((a) => a.exerciseId === view.id);
      if (!analysis) return <Missing title="Exo introuvable" onBack={back} />;
      if (view.page === 'exo') {
        return (
          <Page>
            <ExercisePage
              key={analysis.exerciseId}
              analysis={analysis}
              onBack={back}
              onCompare={() => push({ page: 'compare', id: analysis.exerciseId })}
              onOpenSession={(id) => {
                // La séance se lit dans le journal : on le charge s'il ne l'est pas.
                setJournalWanted(true);
                push({ page: 'seance', id });
              }}
            />
          </Page>
        );
      }
      return (
        <Page>
          <ScreenHeader title={analysis.name} meta="Comparer deux blocs" back={{ label: analysis.name, onClick: back }} />
          <BlockComparisonPanel key={analysis.exerciseId} exerciseId={analysis.exerciseId} />
        </Page>
      );
    }
    case 'seance': {
      if (journal.state.phase === 'offline') {
        return (
          <Page>
            <ScreenHeader title="Séance" back={{ label: 'Retour', onClick: back }} />
            <OfflineState surface="Le Journal" />
          </Page>
        );
      }
      if (journal.state.phase !== 'ready') return <Missing title="Séance" onBack={back} loading={journal.state.phase === 'loading'} />;
      const entry = journal.state.value.find((e) => e.executionId === view.id);
      // Journal lu dans sa copie : une séance plus récente qu'elle arrive avec
      // la relecture (en ligne), ou n'y est pas encore (hors ligne). Ni l'un ni
      // l'autre n'est une séance supprimée. L'attente est bornée (analysis-frame).
      const lookup = seanceLookup({ found: entry !== undefined, copy: journal.state.copy, online: journal.online, late: journal.showDate });
      if (lookup === 'waiting') return <Missing title="Séance" onBack={back} loading />;
      if (lookup === 'late' || lookup === 'newer-offline') {
        return (
          <Page>
            <ScreenHeader title="Séance" back={{ label: 'Retour', onClick: back }} />
            <p role="status" className="px-5 py-6 text-[15px] leading-[1.45] text-muted">
              {lookup === 'late'
                ? 'Elle est plus récente que la copie du journal gardée sur cet appareil, et le réseau ne l’a pas encore apportée.'
                : 'Elle est plus récente que la copie du journal gardée sur cet appareil. Elle s’affichera avec le réseau.'}
            </p>
            {lookup === 'late' && (
              <div className="px-5">
                <SecondaryButton onClick={journal.reload}>Réessayer</SecondaryButton>
              </div>
            )}
          </Page>
        );
      }
      if (!entry) return <Missing title="Séance introuvable" body="Elle n’est plus au journal : supprimée, ou toutes ses séries retirées." onBack={back} />;
      return (
        <Page>
          <SessionPage entry={entry} verdicts={verdicts.get(entry.executionId)} onBack={back} onEdit={() => push({ page: 'edit', id: entry.executionId })} />
        </Page>
      );
    }
    case 'edit':
    case 'index':
      break;
  }

  const empty = analyses.length === 0 && metrics.length === 0;
  const period = analyses.flatMap((a) => a.seanceCurves)[0]?.ratePeriod ?? null;
  const year = new Date().getFullYear();
  const meta =
    tab === 'exos'
      ? period
        ? `Pentes sur ${period.since === null ? '' : 'le '}${periodLabel(period, year)}`
        : undefined
      : journal.state.phase === 'ready'
        ? `${journal.state.value.length} séance${journal.state.value.length > 1 ? 's' : ''} au journal`
        : undefined;
  // La vue montrée vient d'une copie locale : on dit de quand.
  const copyAt = overview.showDate
    ? overview.state.at
    : tab === 'journal' && journal.showDate && journal.state.phase === 'ready'
      ? journal.state.at
      : null;

  return (
    <Page>
      <ScreenHeader title="Analyse" meta={empty ? undefined : meta} />
      {copyAt !== null && <CopyNote at={copyAt} online={overview.online} />}
      {empty ? (
        <NoData />
      ) : (
        <>
          {/* Les mots de l'Analyse, une phrase chacun, repliés sous le titre. */}
          <WordsHelp terms={['e1rm', 'pente', 'bloc', 'reference']} className="-mt-3 px-5 pb-1" />
          <div className="border-b border-line px-3">
            <Choice label="Vue de l’analyse" options={TABS} value={tab} onChange={chooseTab} wrap={false} />
          </div>
          {tab === 'exos' ? (
            <ExerciseList analyses={analyses} plan={plan} routineName={routineName} onOpen={(id) => push({ page: 'exo', id })} />
          ) : journal.state.phase === 'loading' ? (
            <p role="status" className="px-5 py-6 text-[15px] text-muted">
              Chargement du journal…
            </p>
          ) : journal.state.phase === 'offline' ? (
            <OfflineState surface="Le Journal" />
          ) : journal.state.phase === 'error' ? (
            <LoadError what="ton journal" message={journal.state.message} onRetry={journal.reload} />
          ) : (
            <RawLogView entries={journal.state.value} metrics={metrics} verdicts={verdicts} onOpen={(id) => push({ page: 'seance', id })} />
          )}
        </>
      )}
    </Page>
  );
}

/** Une page de l'Analyse : écran du kit, contenu centré (lisible sur PC aussi). */
function Page({ children }: { children: ReactNode }) {
  return (
    <Screen>
      <div className="mx-auto w-full max-w-2xl pb-16">{children}</div>
    </Screen>
  );
}

function LoadError({ what, message, onRetry }: { what: string; message: string; onRetry: () => void }) {
  return (
    <div className="px-5 pt-4">
      <p role="alert" className="ui-note break-words border-y border-line py-3 text-[15px] leading-[1.45] text-ink">
        <span className="font-semibold">Erreur : </span>Impossible de charger {what} : {message}
      </p>
      <div className="mt-4">
        <SecondaryButton onClick={onRetry}>Réessayer</SecondaryButton>
      </div>
    </div>
  );
}

/** Une sous-page dont la donnée manque (supprimée entre-temps, ou encore en lecture). */
function Missing({ title, body, onBack, loading = false }: { title: string; body?: string; onBack: () => void; loading?: boolean }) {
  return (
    <Page>
      <ScreenHeader title={title} back={{ label: 'Retour', onClick: onBack }} />
      {loading ? (
        <p role="status" className="px-5 py-6 text-[15px] text-muted">
          Chargement…
        </p>
      ) : (
        <EmptyState title="Plus rien à afficher ici" body={body} />
      )}
    </Page>
  );
}

function NoData() {
  const go = useGoToSurface();
  return (
    <EmptyState
      title="Aucune séance au journal"
      body="Les courbes partent de la première série loggée en salle."
      action={<SecondaryButton onClick={() => go('capture')}>Aller en salle</SecondaryButton>}
    />
  );
}
