// Le Journal de l'Analyse (cf. issues #27/#32, refonte E, prototype
// e/analyse-journal.tsx) : en tête la durée et le BPM dans le temps, puis
// l'historique brut, mois par mois, une ligne par séance (jour, nom, routine,
// séries ; durée et BPM à droite s'ils ont été notés). Toucher une ligne ouvre
// la séance : ses chiffres, puis ses séries telles qu'elles ont été loggées
// (poids × reps · RIR), sans aucune dérivation, gauche et droite sur deux lignes
// pour un exo unilatéral (ADR 0005). « Corriger », en tête de page comme
// « Modifier » sur une fiche d'exo, ouvre l'éditeur sans défiler les séries.
//
// Pas de récap trompeur : une métrique manquante s'écrit « non notée », jamais
// zéro. Le décompte de séries est celui de la fin de séance (`summarizeSession`).
// Composants purs : ils prennent des `RawLogEntry[]` déjà chargées.
import { EmptyState, List, Row, ScreenHeader, SecondaryButton, SectionTitle } from '../../ui';
import { formatWeight } from '../capture/format';
import type { RawLogEntry } from './raw-log';
import { summarizeSession } from './session-summary';
import { SessionMetricsChart } from './SessionMetricsChart';
import type { SessionMetricPoint } from './session-metrics';
import { formatCount, formatDateLong, formatDuration, formatInt, formatMonthTitle } from './format';

const WEEKDAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const weekday = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : WEEKDAY.format(d);
};
const seriesWord = (n: number) => (n > 1 ? 'séries' : 'série');

export function RawLogView({
  entries,
  metrics,
  onOpen,
}: {
  /** Séances, la plus récente en tête (cf. `buildRawLog`). */
  entries: RawLogEntry[];
  metrics: SessionMetricPoint[];
  onOpen: (executionId: string) => void;
}) {
  if (entries.length === 0) {
    return <EmptyState title="Aucune série au journal" body="Le détail de tes séances apparaîtra ici dès la première série loggée." />;
  }
  const months: { key: string; items: RawLogEntry[] }[] = [];
  for (const e of entries) {
    const key = e.date.slice(0, 7);
    const g = months[months.length - 1];
    if (g && g.key === key) g.items.push(e);
    else months.push({ key, items: [e] });
  }
  const withBpm = metrics.filter((m) => m.bpmAvg !== null).length;
  const year = new Date().getFullYear();

  return (
    <>
      {metrics.length > 0 && (
        <section aria-labelledby="journal-mesures">
          <SectionTitle id="journal-mesures" aside={`${metrics.length} séances, ${withBpm} avec BPM`}>
            Durée et BPM
          </SectionTitle>
          <SessionMetricsChart points={metrics} />
        </section>
      )}
      {months.map((m) => {
        const title = formatMonthTitle(m.key);
        return (
          <section key={m.key} aria-label={title}>
            <SectionTitle aside={`${m.items.length} séance${m.items.length > 1 ? 's' : ''}`}>{title}</SectionTitle>
            <List label={`Séances de ${title}`}>
              {m.items.map((e) => {
                const s = summarizeSession(e);
                const name = s.sessionName ?? 'Hors séance';
                return (
                  <Row
                    key={e.executionId}
                    lead={Number(e.date.slice(8, 10))}
                    title={name}
                    meta={`${weekday(e.date)}${s.routineName ? ` · ${s.routineName}` : ''} · ${formatCount(s.setCount)} ${seriesWord(s.setCount)}`}
                    value={s.durationMin !== null ? <span className="text-[16px]">{formatDuration(s.durationMin)}</span> : undefined}
                    valueMeta={s.bpmAvg !== null ? `${s.bpmAvg} BPM` : undefined}
                    onClick={() => onOpen(e.executionId)}
                    ariaLabel={`${name}, ${formatDateLong(e.date, year)}. Ouvrir`}
                  />
                );
              })}
            </List>
          </section>
        );
      })}
    </>
  );
}

/** Une séance du journal, en lecture : ses chiffres puis ses séries par exo. */
export function SessionPage({
  entry,
  onBack,
  onEdit,
}: {
  entry: RawLogEntry;
  onBack: () => void;
  onEdit: () => void;
}) {
  const s = summarizeSession(entry);
  const year = new Date().getFullYear();
  return (
    <>
      <ScreenHeader
        title={s.sessionName ?? 'Hors séance'}
        meta={`${formatDateLong(entry.date, year)}${s.routineName ? ` · ${s.routineName}` : ''}`}
        back={{ label: 'Journal', onClick: onBack }}
        action={
          <SecondaryButton size="sm" onClick={onEdit} ariaLabel="Corriger cette séance">
            Corriger
          </SecondaryButton>
        }
      />
      {/* Les chiffres ne se coupent jamais (« 1 370 kg », « moins d'1 min ») :
          sur téléphone, deux rangées de deux (durée et BPM, puis volume),
          quatre colonnes de 75 px les coupaient ou les faisaient déborder ;
          une seule rangée dès qu'il y a la place. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-line px-5 py-3 sm:grid-cols-4">
        <Fact label="Durée" value={s.durationMin !== null ? formatDuration(s.durationMin) : null} />
        <Fact label="BPM" value={s.bpmAvg !== null ? String(s.bpmAvg) : null} />
        <Fact label="Séries" value={formatCount(s.setCount)} />
        <Fact label="Soulevés" value={`${formatInt(s.totalLiftedKg)}\u00a0kg`} />
      </dl>
      {entry.exercises.map((x) => (
        <section key={x.exerciseId} aria-label={x.name}>
          <SectionTitle>{x.name}</SectionTitle>
          <List label={`Séries de ${x.name}`}>
            {x.sets.map((set) => (
              <Row
                // Clé composite : en unilatéral, deux lignes partagent le même rang.
                key={`${set.order}-${set.side ?? 'both'}`}
                lead={set.order}
                title={`${formatWeight(set.weightKg)} kg × ${set.reps} · RIR ${set.rir}`}
                meta={set.side === 'left' ? 'gauche' : set.side === 'right' ? 'droite' : undefined}
                valueMeta={`${formatInt(set.weightKg * set.reps)} kg`}
              />
            ))}
          </List>
        </section>
      ))}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className={`mt-1 ${value === null ? 'text-[15px] text-muted' : 'tnum whitespace-nowrap text-[18px] font-medium text-ink'}`}>{value ?? 'non noté'}</dd>
    </div>
  );
}
