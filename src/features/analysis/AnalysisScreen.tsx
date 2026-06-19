// La surface « Analyse au calme » : pour chaque exo entraîné, sa progression
// %/semaine et la courbe e1RM de la 1ʳᵉ série, plus la tendance des séries 2+
// en dessous (subordonnée). Distincte de la capture (salle).
//
// Périmètre : la courbe primaire (héros) + la pente, et sous elle un graphe
// secondaire (séries 2+) clairement subordonné quand il y a de quoi le tracer.
// Plus, repliée par exo, la comparaison de deux blocs (cf. issue #6) : quel
// volume fait le plus progresser. Elle reste secondaire (un dépliant discret
// sous la carte), la courbe primaire restant le héros.
//
// L'écran sépare le CHARGEMENT (Supabase) de la PRÉSENTATION : `AnalysisList`
// est un composant pur qui prend des `ExerciseAnalysis[]` — il se monte tel quel
// dans le harness de screenshot, sans réseau ni user de test.
import { useEffect, useState } from 'react';
import {
  loadAnalyses,
  loadRawLog,
  loadSessionMetrics,
  type ExerciseAnalysis,
} from './data';
import type { SessionMetricPoint } from './session-metrics';
import type { RawLogEntry } from './raw-log';
import { E1rmChart } from './E1rmChart';
import { SecondaryChart } from './SecondaryChart';
import { SessionMetricsChart } from './SessionMetricsChart';
import { RawLogView } from './RawLogView';
import { PastSessionEditor } from './PastSessionEditor';
import { ProgressionBadge } from './ProgressionBadge';
import { BlockComparisonPanel } from './BlockComparisonPanel';

/** Les deux vues de l'analyse, sans nouvelle entrée de nav (cf. issues #27/#28). */
type AnalysisTab = 'curves' | 'journal';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; analyses: ExerciseAnalysis[]; metrics: SessionMetricPoint[] };

export function AnalysisScreen() {
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<AnalysisTab>('curves');

  useEffect(() => {
    let active = true;
    setLoad({ phase: 'loading' });

    void (async () => {
      try {
        // Les courbes (e1RM par exo) et les métriques de séance (BPM/durée) sont
        // toutes deux des vues globales de l'onglet « Courbes » : on les charge
        // ensemble, en parallèle.
        const [analyses, metrics] = await Promise.all([
          loadAnalyses(),
          loadSessionMetrics(),
        ]);
        if (!active) return;
        setLoad({ phase: 'ready', analyses, metrics });
      } catch (err) {
        if (!active) return;
        setLoad({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [reloadKey]);

  if (load.phase === 'loading') {
    return <AnalysisSkeleton />;
  }

  if (load.phase === 'error') {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-ink-muted">Impossible de charger ton analyse.</p>
        <p className="readout max-w-full break-words text-xs text-warn">{load.message}</p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="inline-flex h-11 items-center rounded-xl bg-accent-strong px-5 text-sm font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent"
        >
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-8 pt-5">
      <AnalysisTabs active={tab} onChange={setTab} />
      {tab === 'curves' ? (
        <CurvesTab analyses={load.analyses} metrics={load.metrics} />
      ) : (
        <JournalTab />
      )}
    </div>
  );
}

// Onglets « Courbes » / « Journal » : un segmenté discret qui REMPLACE l'unique
// titre « Progression » sans ajouter d'entrée de nav (cf. périmètre des issues).
// L'onglet actif porte le seul accent (One Voice Rule : la sélection courante).
function AnalysisTabs({
  active,
  onChange,
}: {
  active: AnalysisTab;
  onChange: (tab: AnalysisTab) => void;
}) {
  const tabs: { id: AnalysisTab; label: string }[] = [
    { id: 'curves', label: 'Courbes' },
    { id: 'journal', label: 'Journal' },
  ];
  return (
    <div
      role="tablist"
      aria-label="Vue de l'analyse"
      className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1"
    >
      {tabs.map(({ id, label }) => {
        const selected = id === active;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(id)}
            className={`h-9 rounded-lg text-sm font-medium transition active:scale-[0.98] ${
              selected
                ? 'bg-accent-strong text-on-accent'
                : 'text-ink-muted'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// --- Onglet « Courbes » (pur, montable sans réseau) -------------------------

/**
 * L'onglet courbes : la liste des exos (e1RM par exo) plus, en tête quand il y a
 * de quoi, le graphe BPM moyen + durée de séance (cf. issue #28). Pur : il prend
 * des `ExerciseAnalysis[]` et des `SessionMetricPoint[]`, donc montable tel quel
 * dans le harness de screenshot, sans réseau ni user de test.
 */
export function CurvesTab({
  analyses,
  metrics,
}: {
  analyses: ExerciseAnalysis[];
  metrics: SessionMetricPoint[];
}) {
  if (analyses.length === 0 && metrics.length === 0) {
    return <EmptyState />;
  }

  return (
    <>
      {metrics.length > 0 && (
        <section className="mb-3 rounded-2xl border border-line bg-surface p-4">
          <h3 className="mb-3 text-base font-medium leading-tight">Cardio · séance</h3>
          <SessionMetricsChart points={metrics} />
          <div className="mt-2 flex items-center gap-4 text-xs text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full bg-accent"
                aria-hidden="true"
              />
              BPM moyen
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full bg-ink-muted"
                aria-hidden="true"
              />
              Durée (min)
            </span>
          </div>
        </section>
      )}

      {analyses.length > 0 && (
        <ul className="flex flex-col gap-3">
          {analyses.map((analysis) => (
            <li key={analysis.exerciseId}>
              <ExerciseAnalysisCard analysis={analysis} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// --- Onglet « Journal » : log brut des lifts (cf. issue #27) -----------------

// Le log brut peut être lourd (tout l'historique de séries) ; on ne le charge
// qu'à l'ouverture de l'onglet, pas avec le reste de l'écran. Composant à part
// pour porter son propre cycle de chargement, le rendu restant pur (RawLogView).
function JournalTab() {
  const [load, setLoad] = useState<
    | { phase: 'loading' }
    | { phase: 'error'; message: string }
    | { phase: 'ready'; entries: RawLogEntry[] }
  >({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  // Édition d'une séance passée (issue #38) : l'exécution ouverte, ou null en
  // consultation. L'éditeur se monte par-dessus le journal (modal plein écran).
  const [editingExecutionId, setEditingExecutionId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoad({ phase: 'loading' });

    void (async () => {
      try {
        const entries = await loadRawLog();
        if (!active) return;
        setLoad({ phase: 'ready', entries });
      } catch (err) {
        if (!active) return;
        setLoad({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [reloadKey]);

  if (load.phase === 'loading') {
    return <JournalSkeleton />;
  }

  if (load.phase === 'error') {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-ink-muted">Impossible de charger ton journal.</p>
        <p className="readout max-w-full break-words text-xs text-warn">{load.message}</p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="inline-flex h-11 items-center rounded-xl bg-accent-strong px-5 text-sm font-semibold text-on-accent transition active:scale-[0.98] active:bg-accent"
        >
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <>
      <RawLogView entries={load.entries} onEdit={setEditingExecutionId} />
      {editingExecutionId && (
        <PastSessionEditor
          executionId={editingExecutionId}
          onClose={() => setEditingExecutionId(null)}
          onSaved={() => {
            // Corrections synchronisées : on ferme et on recharge le journal
            // pour refléter le réalisé corrigé (l'analyse e1RM se recalcule à sa
            // prochaine ouverture, dérivée des mêmes séries).
            setEditingExecutionId(null);
            setReloadKey((k) => k + 1);
          }}
          onDeleted={() => {
            // Exécution supprimée (ADR 0008) : MÊME voie que `onSaved`. On ferme
            // et on recharge le journal pour que la séance disparaisse ; la
            // référence et les courbes se recalculent à la lecture (rien à
            // invalider, aucun dérivé matérialisé).
            setEditingExecutionId(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
}

function JournalSkeleton() {
  return (
    <ul className="flex flex-col gap-3" role="status" aria-label="Chargement du journal">
      {[0, 1, 2].map((i) => (
        <li key={i} className="rounded-2xl border border-line bg-surface p-4">
          <div className="mb-3 h-4 w-40 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-28 animate-pulse rounded bg-surface-2" />
          <div className="mt-2 h-3 w-48 animate-pulse rounded bg-surface-2" />
          <div className="mt-1.5 h-3 w-44 animate-pulse rounded bg-surface-2" />
        </li>
      ))}
    </ul>
  );
}

function ExerciseAnalysisCard({ analysis }: { analysis: ExerciseAnalysis }) {
  const { name, curve, secondaryCurve, weeklyRate } = analysis;
  // Une pente nulle (`null`) malgré des points = pas assez de séances : la
  // courbe reste le héros, on explique juste l'absence de pente sous le graphe.
  const slopeUnavailable = weeklyRate === null && curve.length > 0;
  // Pas de graphe secondaire sans série 2+ (le domaine renvoie alors []).
  const hasSecondary = secondaryCurve.length > 0;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="text-base font-medium leading-tight">{name}</h3>
        <ProgressionBadge weeklyRate={weeklyRate} />
      </div>

      <E1rmChart curve={curve} />

      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-ink-muted">e1RM · 1ʳᵉ série</span>
        {slopeUnavailable && (
          <span className="text-xs text-ink-muted">
            Pas assez de séances pour la pente.
          </span>
        )}
      </div>

      {hasSecondary && (
        // Subordonné à la primaire : séparé par un filet tonal, libellé discret,
        // graphe plus petit et en ink-muted (jamais l'accent). Le héros reste
        // au-dessus ; ceci n'est qu'un repère « résistance à la fatigue ».
        <div className="mt-3 border-t border-line pt-3">
          <span className="text-[11px] text-ink-muted">Séries 2+ · e1RM moyen</span>
          <SecondaryChart curve={secondaryCurve} />
        </div>
      )}

      <CompareBlocksDisclosure exerciseId={analysis.exerciseId} />
    </section>
  );
}

// Dépliant « Comparer deux blocs » : replié par défaut (feature secondaire qui
// demande des mois de données et un réseau), il ne charge la comparaison qu'à
// l'ouverture. La carte reste légère tant qu'on ne le déplie pas.
function CompareBlocksDisclosure({ exerciseId }: { exerciseId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 border-t border-line pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between text-[11px] text-ink-muted transition active:scale-[0.99]"
      >
        <span>Comparer deux blocs</span>
        <svg
          viewBox="0 0 20 20"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>

      {open && (
        <div className="mt-3">
          <BlockComparisonPanel exerciseId={exerciseId} />
        </div>
      )}
    </div>
  );
}

// Squelette de chargement : on dessine la forme des cartes à venir (titre,
// badge, zone de graphe) plutôt qu'un spinner nu, pour que l'écran ne « saute »
// pas quand les données arrivent. Lignes en surface-2 qui pulsent.
function AnalysisSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-md px-4 pb-8 pt-5"
      role="status"
      aria-label="Chargement de l'analyse"
    >
      <div className="mb-4 h-6 w-32 animate-pulse rounded bg-surface-2" />
      <ul className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="rounded-2xl border border-line bg-surface p-4"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="h-5 w-40 animate-pulse rounded bg-surface-2" />
              <div className="h-6 w-20 animate-pulse rounded-md bg-surface-2" />
            </div>
            <div className="h-40 w-full animate-pulse rounded-lg bg-surface-2" />
            <div className="mt-2 h-3 w-24 animate-pulse rounded bg-surface-2" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md flex-col items-center justify-center gap-3 px-8 text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="var(--color-ink-muted)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 3v18h18" />
          <path d="M7 14l4-4 3 3 5-6" />
        </svg>
      </div>
      <p className="text-sm text-ink-muted">
        Pas encore de données. Fais ta première séance pour voir ta progression.
      </p>
    </div>
  );
}
