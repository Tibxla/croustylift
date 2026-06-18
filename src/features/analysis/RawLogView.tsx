// Le LOG BRUT consultable (cf. issue #27, DESIGN.md). On rend les séries telles
// qu'elles ont été loggées, par date de séance puis par exo : poids × reps × RIR,
// sans aucune dérivation. La plus récente en tête (cf. `buildRawLog`).
//
// Readout Rule : tout chiffre mesuré (poids, reps, RIR, dates) en mono tabulaire,
// aligné en colonnes pour se lire comme un cadran. Sobre, sans accent (le log est
// une consultation, pas un signal de progression : l'accent reste aux courbes).
// Composant pur : il prend des `RawLogEntry[]` et se monte sans réseau.
import type { RawLogEntry } from './raw-log';

/** 'YYYY-MM-DD' → 'mer. 8 janv. 2026' (date longue lisible, locale fr). */
function formatDateLong(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function RawLogView({ entries }: { entries: RawLogEntry[] }) {
  if (entries.length === 0) {
    return <RawLogEmptyState />;
  }

  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry) => (
        <li key={entry.executionId}>
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="readout mb-3 text-sm font-medium tabular-nums text-ink-muted">
              {formatDateLong(entry.date)}
            </h3>

            <div className="flex flex-col gap-3">
              {entry.exercises.map((exercise) => (
                <div key={exercise.exerciseId}>
                  <p className="text-sm font-medium leading-tight text-ink">
                    {exercise.name}
                  </p>

                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {exercise.sets.map((set) => (
                      <li
                        key={set.order}
                        className="readout flex items-baseline gap-2 text-sm tabular-nums text-ink"
                      >
                        <span className="w-5 shrink-0 text-xs text-ink-muted">
                          {set.order}
                        </span>
                        <span className="font-medium">
                          {set.weightKg}
                          <span className="ml-0.5 text-xs font-normal text-ink-muted">
                            kg
                          </span>
                        </span>
                        <span className="text-ink-muted">×</span>
                        <span className="font-medium">
                          {set.reps}
                          <span className="ml-0.5 text-xs font-normal text-ink-muted">
                            reps
                          </span>
                        </span>
                        <span className="ml-auto text-ink-muted">
                          RIR <span className="text-ink">{set.rir}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </li>
      ))}
    </ul>
  );
}

function RawLogEmptyState() {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="text-sm text-ink-muted">
        Pas encore de séries loggées. Le détail de tes séances apparaîtra ici.
      </p>
    </div>
  );
}
