// La surface « Analyse au calme » (refonte E, prototype e/analyse.tsx) : est-ce
// que je progresse, honnêtement ?
//
// Racine en deux onglets de mots sous le titre (pas de nouvelle entrée de nav) :
//   Exos     une phrase de synthèse sur la routine courante, puis une ligne par
//            exo (pente du bloc en cours, dernière mesure) ; toucher ouvre la
//            page de l'exo (courbe parcourue au doigt, séries 2+, comparaison
//            de deux blocs) ;
//   Journal  durée et BPM dans le temps, puis l'historique brut séance par
//            séance ; une séance s'ouvre, puis se corrige.
// Les sous-pages s'empilent dans l'écran (pile locale) : « ‹ Analyse » revient
// d'un cran, à la position de défilement quittée. Changer de surface les vide.
//
// L'écran sépare le CHARGEMENT (Supabase) de la PRÉSENTATION : `ExerciseList`,
// `ExercisePage`, `RawLogView`, `SessionPage` sont purs, montables sans réseau.
// Après une correction, tout est relu sans repasser par l'écran de chargement :
// les données affichées restent jusqu'à l'arrivée des nouvelles.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Choice, EmptyState, Screen, ScreenHeader, SecondaryButton } from '../../ui';
import { useGoToSurface } from '../../shell/navigation';
import { errorMessage } from '../../lib/error-message';
import { getCurrentRoutineId, listRoutines } from '../authoring/data';
import { resolveCaptureRoutineId } from '../capture/data';
import { loadAnalyses, loadPlanExerciseOrder, loadRawLog, loadSessionMetrics, type ExerciseAnalysis } from './data';
import type { SessionMetricPoint } from './session-metrics';
import { BlockComparisonPanel } from './BlockComparisonPanel';
import { ExerciseList } from './ExerciseList';
import { ExercisePage } from './ExercisePage';
import { PastSessionEditor } from './PastSessionEditor';
import { RawLogView, SessionPage } from './RawLogView';
import { periodLabel } from './rate-period';

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

type Load<T> = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; value: T };

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

/**
 * Une lecture et son état. `reload` repasse par « chargement » (bouton
 * Réessayer) ; `refresh` relit en gardant l'affichage (après une correction).
 * `enabled` à false : rien n'est lu (le journal attend son onglet).
 */
function useLoad<T>(fetch: () => Promise<T>, enabled = true) {
  const [key, setKey] = useState(0);
  const [state, setState] = useState<Load<T>>({ phase: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetch().then(
      (value) => {
        if (active) setState({ phase: 'ready', value });
      },
      (err: unknown) => {
        if (active) setState({ phase: 'error', message: errorMessage(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [fetch, key, enabled]);
  const reload = useCallback(() => {
    setState({ phase: 'loading' });
    setKey((k) => k + 1);
  }, []);
  const refresh = useCallback(() => setKey((k) => k + 1), []);
  return { state, reload, refresh };
}

export function AnalysisScreen() {
  const [tab, setTab] = useState<Tab>('exos');
  const [stack, setStack] = useState<View[]>([{ page: 'index' }]);
  const view = stack[stack.length - 1]!;
  // Le journal ne se lit qu'à l'ouverture de son onglet (il peut être lourd).
  const [journalWanted, setJournalWanted] = useState(false);
  const overview = useLoad(loadOverview);
  const journal = useLoad(loadRawLog, journalWanted);

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
  const afterMutation = () => {
    overview.refresh();
    journal.refresh();
  };

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
      if (journal.state.phase !== 'ready') return <Missing title="Séance" onBack={back} loading={journal.state.phase === 'loading'} />;
      const entry = journal.state.value.find((e) => e.executionId === view.id);
      if (!entry) return <Missing title="Séance introuvable" body="Elle n’est plus au journal : supprimée, ou toutes ses séries retirées." onBack={back} />;
      return (
        <Page>
          <SessionPage entry={entry} onBack={back} onEdit={() => push({ page: 'edit', id: entry.executionId })} />
        </Page>
      );
    }
    case 'edit':
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

  return (
    <Page>
      <ScreenHeader title="Analyse" meta={empty ? undefined : meta} />
      {empty ? (
        <NoData />
      ) : (
        <>
          <div className="border-b border-line px-3">
            <Choice label="Vue de l’analyse" options={TABS} value={tab} onChange={chooseTab} wrap={false} />
          </div>
          {tab === 'exos' ? (
            <ExerciseList analyses={analyses} plan={plan} routineName={routineName} onOpen={(id) => push({ page: 'exo', id })} />
          ) : journal.state.phase === 'loading' ? (
            <p role="status" className="px-5 py-6 text-[15px] text-muted">
              Chargement du journal…
            </p>
          ) : journal.state.phase === 'error' ? (
            <LoadError what="ton journal" message={journal.state.message} onRetry={journal.reload} />
          ) : (
            <RawLogView entries={journal.state.value} metrics={metrics} onOpen={(id) => push({ page: 'seance', id })} />
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
      <p role="alert" className="break-words border-y border-line py-3 text-[15px] leading-[1.45] text-ink">
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
