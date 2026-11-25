// Le Journal de l'Analyse (cf. issues #27/#32, refonte E, prototype
// e/analyse-journal.tsx) : l'historique brut, mois par mois, une ligne par séance
// (jour, nom, séries, et ce qu'elle a battu : « ▲ 3 battues », comme la fin de
// séance ; la routine seulement quand elle change d'une ligne à l'autre ; durée
// et BPM à droite s'ils ont été notés), puis, sous la liste, la durée et le BPM
// dans le temps. Toucher une ligne ouvre la séance : ses chiffres, puis ses
// séries telles qu'elles ont été loggées (poids × reps · RIR), chacune avec son
// statut face à sa Référence (▲ battue, ▬ égalée, ▼ en deçà, ▲ record ;
// journal-verdicts.ts), gauche et droite sur deux lignes pour un exo unilatéral
// (ADR 0005). « Corriger », en tête de page comme « Modifier » sur une fiche
// d'exo, ouvre l'éditeur sans défiler les séries.
//
// Pas de récap trompeur : une métrique manquante s'écrit « non notée », jamais
// zéro. Le décompte de séries est celui de la fin de séance (`summarizeSession`).
// Le signal ne colore que ce qui est mieux que la dernière fois (▲).
// Composants purs : ils prennent des `RawLogEntry[]` déjà chargées.
import { EmptyState, List, Row, ScreenHeader, SecondaryButton, SectionTitle, Status } from '../../ui';
import { formatWeight } from '../capture/format';
import type { ExecutionVerdicts, JournalSetStatus } from './journal-verdicts';
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
/** « 16 séries », sans retour à la ligne entre le nombre et le mot. */
const seriesCount = (n: number) => `${formatCount(n)}\u00a0${seriesWord(n)}`;
const battues = (n: number) => `${n} battue${n > 1 ? 's' : ''}`;

/** Le statut d'une série, en signe + mot (triade) ; rien sans Référence à son rang. */
function SetStatus({ status }: { status: JournalSetStatus }) {
  switch (status) {
    case 'record':
      return <Status v="up" word="record" />;
    case 'record-charge':
      return <Status v="up" word="record charge" />;
    case 'battue':
      return <Status v="up" word="battue" />;
    case 'egalee':
      return <Status v="eq" word="égalée" />;
    case 'en-deca':
      return <Status v="down" word="en deçà" />;
    default:
      return null;
  }
}

/** Ce que la séance a battu, comme la fin de séance : « ▲ 3 battues », « ▲ record ». */
function Beaten({ v }: { v: ExecutionVerdicts | undefined }) {
  if (!v || (v.beaten === 0 && v.records === 0)) return null;
  return (
    <>
      {v.beaten > 0 && (
        <>
          {' · '}
          <Status v="up" word={battues(v.beaten)} className="whitespace-nowrap" />
        </>
      )}
      {v.records > 0 && (
        <>
          {' · '}
          <Status v="up" word={v.records > 1 ? `${v.records} records` : 'record'} className="whitespace-nowrap" />
        </>
      )}
    </>
  );
}

export function RawLogView({
  entries,
  metrics,
  verdicts,
  onOpen,
}: {
  /** Séances, la plus récente en tête (cf. `buildRawLog`). */
  entries: RawLogEntry[];
  metrics: SessionMetricPoint[];
  /** Statuts des séries, par séance (`journalVerdicts`). */
  verdicts: ReadonlyMap<string, ExecutionVerdicts>;
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

  // La routine ne se répète pas d'une ligne à l'autre : elle s'écrit en tête de
  // chaque mois et là où elle change (le journal mêle toutes les routines).
  let previousRoutine: string | null | undefined;

  return (
    <>
      {months.map((m) => {
        const title = formatMonthTitle(m.key);
        previousRoutine = undefined;
        return (
          <section key={m.key} aria-label={title}>
            <SectionTitle aside={`${m.items.length} séance${m.items.length > 1 ? 's' : ''}`}>{title}</SectionTitle>
            <List label={`Séances de ${title}`}>
              {m.items.map((e) => {
                const s = summarizeSession(e);
                const name = s.sessionName ?? 'Hors séance';
                const showRoutine = s.routineName !== null && s.routineName !== previousRoutine;
                previousRoutine = s.routineName;
                const v = verdicts.get(e.executionId);
                const said = [
                  v && v.beaten > 0 ? battues(v.beaten) : null,
                  v && v.records > 0 ? (v.records > 1 ? `${v.records} records` : 'record') : null,
                ].filter(Boolean);
                return (
                  <Row
                    key={e.executionId}
                    lead={Number(e.date.slice(8, 10))}
                    title={name}
                    meta={
                      <>
                        {weekday(e.date)}
                        {showRoutine && ` · ${s.routineName}`} · <span className="whitespace-nowrap">{seriesCount(s.setCount)}</span>
                        <Beaten v={v} />
                      </>
                    }
                    value={s.durationMin !== null ? <span className="whitespace-nowrap text-[16px]">{formatDuration(s.durationMin)}</span> : undefined}
                    valueMeta={s.bpmAvg !== null ? <span className="whitespace-nowrap">{s.bpmAvg} BPM</span> : undefined}
                    onClick={() => onOpen(e.executionId)}
                    ariaLabel={`${name}, ${formatDateLong(e.date, year)}${s.routineName ? `, ${s.routineName}` : ''}, ${seriesCount(s.setCount)}${said.length > 0 ? `, ${said.join(', ')}` : ''}. Ouvrir`}
                  />
                );
              })}
            </List>
          </section>
        );
      })}
      {metrics.length > 0 && (
        <section aria-labelledby="journal-mesures">
          <SectionTitle id="journal-mesures" aside={`${metrics.length} séances, ${withBpm} avec BPM`}>
            Durée et BPM
          </SectionTitle>
          <SessionMetricsChart points={metrics} />
        </section>
      )}
    </>
  );
}

/** Une séance du journal, en lecture : ses chiffres puis ses séries par exo. */
export function SessionPage({
  entry,
  verdicts,
  onBack,
  onEdit,
}: {
  entry: RawLogEntry;
  /** Statuts de ses séries face à leur Référence (`journalVerdicts`). */
  verdicts: ExecutionVerdicts | undefined;
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
      <dl className="mx-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-group bg-surface px-4 py-3 sm:grid-cols-4">
        <Fact label="Durée" value={s.durationMin !== null ? formatDuration(s.durationMin) : null} />
        <Fact label="BPM" value={s.bpmAvg !== null ? String(s.bpmAvg) : null} />
        <Fact label="Séries" value={formatCount(s.setCount)} />
        <Fact label="Soulevés" value={`${formatInt(s.totalLiftedKg)}\u00a0kg`} />
      </dl>
      {entry.exercises.map((x) => (
        <section key={x.exerciseId} aria-label={x.name}>
          <SectionTitle>{x.name}</SectionTitle>
          <List label={`Séries de ${x.name}`}>
            {x.sets.map((set, k) => {
              const status = verdicts?.sets.get(x.exerciseId)?.[k] ?? null;
              return (
                <Row
                  // Clé composite : en unilatéral, deux lignes partagent le même rang.
                  key={`${set.order}-${set.side ?? 'both'}`}
                  lead={set.order}
                  title={`${formatWeight(set.weightKg)} kg × ${set.reps} · RIR ${set.rir}`}
                  meta={set.side === 'left' ? 'gauche' : set.side === 'right' ? 'droite' : undefined}
                  // Le statut face à la Référence ; le tonnage reste au total.
                  valueMeta={status ? <SetStatus status={status} /> : undefined}
                />
              );
            })}
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
