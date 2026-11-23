// PROTOTYPE JETABLE · socle E, Analyse > un exo.
//
// Le héros : la courbe e1RM (1ʳᵉ série de chaque séance), parcourue au doigt.
// Une courbe par séance où l'exo est fait, superposées sur un axe du temps
// réel : la séance la plus récemment exécutée en blanc cassé, trait plein, les
// autres grises et pointillées, nommées dans la légende. Le signal ne marque
// que le dernier point, et seulement s'il a battu le précédent. Le Record en
// pointillé. Le point touché pilote le relevé (chiffre, date, séance) et, en
// dessous, ses séries de travail et ses kg soulevés. Un exo jamais fait garde
// son cadre vide : aucun point à zéro.
import { useState } from 'react';
import { Chart, dayOf, monthTicks, Swatch, type ChartSel, type ChartSeries } from './analyse-chart';
import { fmtInt, SlopeStatus, useJournal, Page } from './analyse-common';
import { BLOCKS, currentPlan, curvesOf, exoName, liftedKg, recordsOf, routineName, seanceInfo, type Curve } from './fixtures-analyse';
import { fmt1, fmtDate, fmtKg, fmtSigned, setE1rm } from './format';
import { List, Row, ScreenHeader, SectionTitle, SecondaryButton, Status } from './kit';
import { isUnilateral } from './fixtures-exercices';
import { useNav } from './shell';

export function ExoPage({ id }: { id: string }) {
  const nav = useNav();
  const journal = useJournal();
  const curves = curvesOf(journal, id);
  const rec = recordsOf(journal, id);
  const plannedIn = curves.length === 0 ? currentSeancesWith(id) : [];
  const [sel, setSel] = useState<ChartSel | null>(null);

  const main = curves[0];
  const selCurve = (sel && curves.find((c) => c.seanceId === sel.series)) || main;
  const selIndex = sel && selCurve && sel.series === selCurve.seanceId ? sel.index : selCurve ? selCurve.points.length - 1 : -1;
  const point = selCurve?.points[selIndex];
  const exec = point ? journal.find((e) => e.id === point.execId) : undefined;
  const sets = exec?.exercises.find((x) => x.exerciseId === id)?.sets ?? [];
  const total = curves.reduce((n, c) => n + c.points.length, 0);

  const series: ChartSeries[] = curves.map((c, i) => ({
    id: c.seanceId,
    tone: i === 0 ? 'ink' : 'muted',
    dashed: i > 0,
    // Seul « mieux que la dernière fois » prend le signal : le dernier point de
    // la séance la plus récente, s'il bat le point précédent de cette séance.
    lastUp: i === 0 && c.points.length > 1 && c.points[c.points.length - 1]!.e1rm > c.points[c.points.length - 2]!.e1rm,
    points: c.points.map((p) => ({ x: dayOf(p.date), y: p.e1rm })),
  }));
  const allDates = curves.flatMap((c) => c.points.map((p) => p.date)).sort();

  return (
    <Page>
      <ScreenHeader
        title={exoName(id)}
        meta={total > 0 ? `e1RM de la 1ʳᵉ série${isUnilateral(id) ? ', côté faible' : ''} · ${total} séance${total > 1 ? 's' : ''}` : 'Aucune série au journal'}
        back={{ label: 'Analyse', onClick: nav.back }}
      />

      {!main || !point || !selCurve ? (
        <section className="px-5">
          <div className="flex h-[220px] flex-col justify-center border-y border-(--line)" role="img" aria-label="Pas de courbe">
            <p className="max-w-[32ch] text-[17px] leading-[1.45] text-(--muted)">
              {plannedIn.length > 0
                ? `Au plan de ${plannedIn.join(' et ')}, jamais fait. La courbe partira de la première série loggée, sans point à zéro avant.`
                : 'Jamais fait. La courbe partira de la première série loggée, sans point à zéro avant.'}
            </p>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <dt className="text-[14px] text-(--muted)">Pente</dt>
              <dd className="mt-1 text-[16px] text-(--muted)">aucune séance</dd>
            </div>
            <div>
              <dt className="text-[14px] text-(--muted)">Record</dt>
              <dd className="mt-1 text-[16px] text-(--muted)">aucun</dd>
            </div>
          </dl>
        </section>
      ) : (
        <>
          <section className="px-5" aria-label="Relevé">
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span aria-live="polite" className="text-[56px] font-[650] leading-none tracking-[-0.045em] text-(--ink)">
                    {fmt1(point.e1rm)}
                  </span>
                  <span className="text-[20px] font-medium text-(--muted)">kg</span>
                </div>
                <p className="mt-2 text-[14px] text-(--muted)">
                  {fmtDate(point.date)} · {seanceInfo(selCurve.seanceId).name}
                  {exec?.live ? ', en cours' : ''}
                </p>
              </div>
              <dl className="flex-none text-right">
                <dt className="text-[13px] text-(--muted)">Pente, {seanceInfo(main.seanceId).name}</dt>
                <dd className="mt-1 text-[16px] font-medium">
                  <SlopeStatus slope={main.slope} points={main.points.length} short size={12} />
                </dd>
                <dt className="mt-3 text-[13px] text-(--muted)">Record</dt>
                <dd className="mt-1 text-[16px] font-medium text-(--ink)">
                  {rec ? (
                    <>
                      {fmt1(rec.best.e1rm)}
                      <span className="font-normal text-(--muted)"> · {fmtDate(rec.best.date)}</span>
                    </>
                  ) : (
                    <span className="font-normal text-(--muted)">aucun</span>
                  )}
                </dd>
              </dl>
            </div>
          </section>

          <div className="mt-4 px-5">
            <Chart
              series={series}
              selected={{ series: selCurve.seanceId, index: selIndex }}
              onSelect={setSel}
              xTicks={monthTicks(allDates[0]!, allDates[allDates.length - 1]!)}
              refLine={rec ? { y: rec.best.e1rm, label: `Record ${fmt1(rec.best.e1rm)}` } : undefined}
              height={232}
              ariaLabel={`e1RM de ${exoName(id)} : ${curves
                .map((c) => `${seanceInfo(c.seanceId).name}, ${c.points.length} séances, de ${fmt1(c.points[0]!.e1rm)} à ${fmt1(c.points[c.points.length - 1]!.e1rm)} kg`)
                .join(' ; ')}`}
            />
            <p className="mt-1 text-[13px] text-(--faint)">Touche ou glisse sur le graphe pour lire une séance.</p>
          </div>

          {curves.length > 1 && <Legend curves={curves} />}

          <SectionTitle aside={exec ? `${fmtInt(liftedKg(sets))} kg soulevés` : undefined}>
            Séries du {fmtDate(point.date)}
          </SectionTitle>
          <List label={`Séries du ${fmtDate(point.date)}`}>
            {sets.map((s, k) => (
              <Row
                key={k}
                lead={k + 1}
                title={`${fmtKg(s.weightKg)} × ${s.reps} · RIR ${s.rir}`}
                meta={k === 0 ? 'point de la courbe' : undefined}
                valueMeta={`e1RM ${fmt1(setE1rm(s))}`}
              />
            ))}
          </List>
          {exec && (
            <div className="px-5 pt-1">
              <button
                type="button"
                onClick={() => nav.push('seance', { id: exec.id })}
                className="inline-flex min-h-11 items-center text-[16px] text-(--ink) underline decoration-1 underline-offset-4"
              >
                Ouvrir la séance du {fmtDate(point.date)} dans le journal
              </button>
            </div>
          )}

          <Facts id={id} curves={curves} />

          <div className="px-5 pt-6">
            <SecondaryButton onClick={() => nav.push('comparer', { exo: id })} className="w-full" meta={`${BLOCKS.length} blocs`}>
              Comparer deux blocs
            </SecondaryButton>
          </div>
        </>
      )}
    </Page>
  );
}

/** Séances du plan courant qui prévoient l'exo (pour dire où il est attendu). */
function currentSeancesWith(id: string): string[] {
  return currentPlan()
    .map((g) => g.seance)
    .filter((s) => s.items.some((i) => i.exerciseId === id))
    .map((s) => s.name);
}

function Legend({ curves }: { curves: Curve[] }) {
  return (
    <ul aria-label="Courbes par séance" className="mt-3 flex flex-col gap-2 px-5">
      {curves.map((c, i) => {
        const s = seanceInfo(c.seanceId);
        const first = c.points[0]!;
        const last = c.points[c.points.length - 1]!;
        return (
          <li key={c.seanceId} className="flex items-start gap-3">
            <span className="pt-[7px]">
              <Swatch tone={i === 0 ? 'ink' : 'muted'} dashed={i > 0} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-[15px] ${i === 0 ? 'font-semibold text-(--ink)' : 'text-(--muted)'}`}>
                {s.name} · {s.routineName}
              </span>
              <span className="block text-[14px] text-(--muted)">
                {c.points.length} séances, {fmtDate(first.date).replace(' ', '\u00a0')} au {fmtDate(last.date).replace(' ', '\u00a0')}
              </span>
            </span>
            <SlopeStatus slope={c.slope} points={c.points.length} short className="flex-none pt-px text-[15px]" />
          </li>
        );
      })}
    </ul>
  );
}

/** Faits datés, dérivés du journal : rien de saisi, tout vérifiable. */
function Facts({ id, curves }: { id: string; curves: Curve[] }) {
  const journal = useJournal();
  const rec = recordsOf(journal, id);
  const main = curves[0]!;
  const first = main.points[0]!;
  const last = main.points[main.points.length - 1]!;
  const delta = Math.round((last.e1rm - first.e1rm) * 10) / 10;
  const v = delta > 0 ? 'up' : delta === 0 ? 'eq' : 'down';
  const s = seanceInfo(main.seanceId);
  return (
    <>
      <SectionTitle>Faits</SectionTitle>
      <List label="Faits datés">
        {rec && (
          <Row
            title="Record e1RM"
            meta={`${fmtKg(rec.best.set.weightKg)} × ${rec.best.set.reps} · RIR ${rec.best.set.rir} · ${seanceInfo(rec.best.seanceId).name}, ${fmtDate(rec.best.date)}`}
            value={fmt1(rec.best.e1rm)}
          />
        )}
        {rec && (
          <Row
            title="Charge la plus lourde"
            meta={`${fmtKg(rec.heaviest.set.weightKg)} kg × ${rec.heaviest.set.reps} · ${seanceInfo(rec.heaviest.seanceId).name}, ${fmtDate(rec.heaviest.date)}`}
            value={`${fmtKg(rec.heaviest.set.weightKg)}`}
          />
        )}
        <Row
          title={`Depuis la 1ʳᵉ ${s.name}`}
          meta={`${s.routineName}, du ${fmtDate(first.date)} au ${fmtDate(last.date)}, ${main.points.length} séances`}
          value={<Status v={v} size={12} word={`${fmtSigned(delta)} kg`} />}
        />
        {curves.slice(1).map((c) => (
          <Row
            key={c.seanceId}
            title={`${seanceInfo(c.seanceId).name} · ${routineName(seanceInfo(c.seanceId).routineId)}`}
            meta={`faite le ${fmtDate(c.points[c.points.length - 1]!.date)}${seanceInfo(c.seanceId).archivedRoutine ? ', routine archivée' : ''}`}
            value={fmt1(c.points[c.points.length - 1]!.e1rm)}
            muted
          />
        ))}
      </List>
    </>
  );
}
