// PROTOTYPE JETABLE · socle E, surface Analyse (lecture au calme).
//
// La question de la surface : « est-ce que je progresse, honnêtement ? ».
// Racine en trois onglets de mots, sous le titre (pas de nouvelle entrée de
// navigation, comme dans l'app réelle) :
//   Exos     une phrase de synthèse, puis chaque exo de la routine courante
//            dans l'ordre du plan, séance par séance : e1RM, pente, record.
//            Phrase ET liste ne lisent que la routine courante (`inCurrentRoutine`) :
//            les exos de son plan, leurs séances depuis le début de la routine.
//            Un exo hors plan (ajouté en salle) n'y compte pas ; l'historique
//            d'avant (routines archivées) se lit dans Blocs et Journal ;
//   Blocs    comparer deux blocs (donc deux routines) par vitesse de
//            progression, exo par exo, verdict honnête (ADR 0016) ;
//   Journal  durée et BPM dans le temps, puis l'historique brut séance par
//            séance, chacune ouvrable et corrigeable.
// Sous-pages : exo (graphe e1RM parcouru au doigt), comparer (un exo, deux
// blocs), seance (une entrée du journal et son éditeur).
//
// Données : fixtures-analyse.ts (journal unique, tout dérivé). État vide :
// ajouter `&analyse=vide` à l'URL.
import { AnalyseBlocs, ComparerExo } from './analyse-blocs';
import { SlopeStatus, useJournal, Page } from './analyse-common';
import { ExoPage } from './analyse-exo';
import { JournalTab, SeancePage } from './analyse-journal';
import { CURRENT_ROUTINE, currentPlan, curvesOf, exoName, inCurrentRoutine, recordsOf, ROUTINE_START, store, useAnalyseStore, type AnalyseTab, type Execution } from './fixtures-analyse';
import { fmt1, fmtDate, slopeVerdict, type Verdict } from './format';
import { Choice, EmptyState, List, Row, ScreenHeader, SecondaryButton, SectionTitle, Sign, Status, TONE } from './kit';
import { Pages, useNav } from './shell';

export function Analyse() {
  return (
    <Pages
      pages={{
        index: () => <Index />,
        exo: (p) => <ExoPage id={p.id ?? ''} />,
        comparer: (p) => <ComparerExo exo={p.exo ?? ''} a={p.a} b={p.b} />,
        seance: (p) => <SeancePage id={p.id ?? ''} />,
      }}
    />
  );
}

const TABS: { value: AnalyseTab; label: string }[] = [
  { value: 'exos', label: 'Exos' },
  { value: 'blocs', label: 'Blocs' },
  { value: 'journal', label: 'Journal' },
];

function Index() {
  const { tab } = useAnalyseStore();
  const journal = useJournal();
  const first = journal[0];
  const nbsp = (iso: string) => fmtDate(iso).replace(' ', '\u00a0');
  // L'en-tête dit le périmètre de l'onglet : la routine courante pour Exos,
  // tout le journal pour Blocs et Journal (ils remontent aux routines d'avant).
  const inRoutine = journal.filter(inCurrentRoutine).length;
  const meta = !first
    ? CURRENT_ROUTINE.name
    : tab === 'exos'
      ? `${CURRENT_ROUTINE.name} · ${inRoutine} séance${inRoutine > 1 ? 's' : ''} depuis le ${nbsp(ROUTINE_START)}`
      : `Tout le journal · ${journal.length} séances depuis le ${nbsp(first.date)}`;
  return (
    <Page>
      <ScreenHeader title="Analyse" meta={meta} />
      {journal.length > 0 && (
        <div className="border-b border-(--line) px-3">
          <Choice label="Vue de l'analyse" options={TABS} value={tab} onChange={store.setTab} wrap={false} />
        </div>
      )}
      {journal.length === 0 ? (
        <NoData />
      ) : tab === 'exos' ? (
        <ExosTab journal={journal} />
      ) : tab === 'blocs' ? (
        <AnalyseBlocs journal={journal} />
      ) : (
        <JournalTab journal={journal} />
      )}
    </Page>
  );
}

function NoData() {
  const nav = useNav();
  return (
    <EmptyState
      title="Aucune séance au journal"
      action={<SecondaryButton onClick={() => nav.go('salle')}>Aller en salle</SecondaryButton>}
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Onglet Exos                                                                */
/* ------------------------------------------------------------------------ */

interface ExoLine {
  id: string;
  points: number;
  slope: number | null;
  last: { e1rm: number; date: string } | null;
  record: { e1rm: number; date: string } | null;
}

function lineOf(journal: Execution[], seanceId: string, id: string): ExoLine {
  // Pente et dernier e1RM : séances de la routine courante seulement. Le record
  // reste le record personnel, tous jours confondus (il le dit à part).
  const curve = curvesOf(journal, id, inCurrentRoutine).find((c) => c.seanceId === seanceId);
  const rec = recordsOf(journal, id);
  const last = curve?.points[curve.points.length - 1];
  return {
    id,
    points: curve?.points.length ?? 0,
    slope: curve?.slope ?? null,
    last: last ? { e1rm: last.e1rm, date: last.date } : null,
    record: rec ? { e1rm: rec.best.e1rm, date: rec.best.date } : null,
  };
}

function ExosTab({ journal }: { journal: Execution[] }) {
  const nav = useNav();
  const plan = currentPlan().map((g) => ({
    seance: g.seance,
    lastDone: [...journal].reverse().find((e) => e.seanceId === g.seance.id)?.date ?? null,
    lines: g.exerciseIds.map((id) => lineOf(journal, g.seance.id, id)),
  }));
  const lines = plan.flatMap((g) => g.lines);
  const worked = lines.filter((l) => l.points > 0);
  const count = (v: Verdict) => worked.filter((l) => l.slope !== null && slopeVerdict(l.slope) === v).length;
  const thin = worked.filter((l) => l.slope === null);
  const never = lines.filter((l) => l.points === 0);

  return (
    <>
      <section aria-label="Synthèse" className="px-5 pb-1 pt-5">
        {/* Le nom de la routine en tête : la phrase ne compte que ses exos. */}
        <p className="text-[21px] font-medium leading-[1.35] tracking-[-0.01em] text-(--ink)">
          {CURRENT_ROUTINE.name} : <Status v="up" size={13} word={`${count('up')} ${verb(count('up'), 'monte', 'montent')}`} />,{' '}
          <Status v="eq" size={13} word={`${count('eq')} ${verb(count('eq'), 'stagne', 'stagnent')}`} />,{' '}
          <Status v="down" size={13} word={`${count('down')} ${verb(count('down'), 'recule', 'reculent')}`} />.
        </p>
        <p className="mt-2 max-w-[38ch] text-[15px] leading-[1.45] text-(--muted)">
          {thin.length > 0 && (
            <>
              {thin.map((l) => exoName(l.id)).join(', ')} : trop peu de séances pour une pente.{' '}
            </>
          )}
          {never.length > 0 && `${never.length} exo${never.length > 1 ? 's' : ''} du plan jamais fait${never.length > 1 ? 's' : ''}, sans courbe.`}
        </p>
        <p className="mt-2 text-[14px] text-(--faint)">
          {worked.length} exos de la routine depuis le {fmtDate(ROUTINE_START)} ; pente de chaque exo dans sa séance, sur la 1ʳᵉ série.
        </p>
      </section>

      {plan.map((g) =>
        g.lastDone === null ? (
          <section key={g.seance.id} aria-label={g.seance.name}>
            <SectionTitle aside="jamais faite">{g.seance.name}</SectionTitle>
            <p className="border-t border-(--line) px-5 py-3 text-[15px] leading-[1.45] text-(--muted)">
              {g.lines.map((l) => exoName(l.id)).join(', ')}. Pas encore de courbe : elle partira de la première séance.
            </p>
          </section>
        ) : (
          <section key={g.seance.id} aria-label={g.seance.name}>
            <SectionTitle aside={`faite le ${fmtDate(g.lastDone)}`}>{g.seance.name}</SectionTitle>
            <List label={`Exos de ${g.seance.name}`}>
              {g.lines.map((l) => (
                <ExoRow key={l.id} line={l} onOpen={() => nav.push('exo', { id: l.id })} />
              ))}
            </List>
          </section>
        ),
      )}
    </>
  );
}

/** Accord du verbe : « 0 recule », « 1 recule », « 2 reculent ». */
const verb = (n: number, one: string, many: string) => (n > 1 ? many : one);

function ExoRow({ line, onOpen }: { line: ExoLine; onOpen: () => void }) {
  const isRecord = line.last && line.record && line.last.date === line.record.date && line.last.e1rm >= line.record.e1rm;
  return (
    <Row
      title={line.id ? exoName(line.id) : ''}
      muted={line.points === 0}
      meta={line.points === 0 ? 'jamais fait, pas de courbe' : <SlopeStatus slope={line.slope} points={line.points} />}
      value={
        line.last ? (
          <>
            {fmt1(line.last.e1rm)}
            <span className="ml-1 text-[14px] font-normal text-(--muted)">kg</span>
          </>
        ) : undefined
      }
      valueMeta={
        line.record ? (
          isRecord ? (
            <span className={`inline-flex items-center gap-1 ${TONE.up}`}>
              <Sign v="up" />
              record
            </span>
          ) : (
            `record ${fmt1(line.record.e1rm)}`
          )
        ) : undefined
      }
      onClick={onOpen}
      ariaLabel={`${exoName(line.id)}. Ouvrir la courbe`}
    />
  );
}
