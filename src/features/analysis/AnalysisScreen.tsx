// La surface « Analyse au calme » : pour chaque exo entraîné, sa progression
// %/semaine et la courbe e1RM de la 1ʳᵉ série, plus la tendance des séries 2+
// en dessous (subordonnée). Distincte de la capture (salle).
//
// Périmètre : la courbe primaire (héros) + la pente, et sous elle un graphe
// secondaire (séries 2+) clairement subordonné quand il y a de quoi le tracer.
// Toujours hors périmètre : la comparaison de blocs (feature « Should » qui
// demande des mois de données).
//
// L'écran sépare le CHARGEMENT (Supabase) de la PRÉSENTATION : `AnalysisList`
// est un composant pur qui prend des `ExerciseAnalysis[]` — il se monte tel quel
// dans le harness de screenshot, sans réseau ni user de test.
import { useEffect, useState } from 'react';
import { loadAnalyses, type ExerciseAnalysis } from './data';
import { E1rmChart } from './E1rmChart';
import { SecondaryChart } from './SecondaryChart';
import { ProgressionBadge } from './ProgressionBadge';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; analyses: ExerciseAnalysis[] };

export function AnalysisScreen() {
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoad({ phase: 'loading' });

    void (async () => {
      try {
        const analyses = await loadAnalyses();
        if (!active) return;
        setLoad({ phase: 'ready', analyses });
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
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent"
          role="status"
          aria-label="Chargement de l'analyse"
        />
      </div>
    );
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

  return <AnalysisList analyses={load.analyses} />;
}

// --- Présentation (pure, montable sans réseau) ------------------------------

export function AnalysisList({ analyses }: { analyses: ExerciseAnalysis[] }) {
  if (analyses.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-8 pt-5">
      <h2 className="mb-4 text-lg font-semibold tracking-tight">Progression</h2>
      <ul className="flex flex-col gap-3">
        {analyses.map((analysis) => (
          <li key={analysis.exerciseId}>
            <ExerciseAnalysisCard analysis={analysis} />
          </li>
        ))}
      </ul>
    </div>
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
    </section>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md flex-col items-center justify-center gap-3 px-8 text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full bg-surface"
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
