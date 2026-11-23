// PROTOTYPE JETABLE · socle E, Analyse > Blocs (ADR 0016).
//
// On compare des VITESSES de progression (%/semaine), jamais des niveaux.
// Onglet Blocs : deux blocs choisis au doigt (feuille basse, aucun clavier),
// donc deux routines quand ils en viennent ; pour chaque exo présent dans les
// deux, sa pente dans chacun, lue dans une seule séance, et un verdict court.
// Sous-page comparer : un exo, deux options « séance · routine · dates », les
// deux trajectoires en % depuis leur départ, semaine de bloc en abscisse.
//
// Honnêteté du verdict : sans deux pentes, pas de verdict ; si les deux
// reculent, pas de gagnant (on dit lequel recule le moins) ; sous 0,25 %/sem
// d'écart, même vitesse. Le ▲ au signal ne marque qu'une pente en hausse.
import { useState } from 'react';
import { Chart, type ChartSeries } from './analyse-chart';
import { compare, compareWord, SlopeStatus, useJournal, type Compare, Page } from './analyse-common';
import {
  BLOCKS,
  blockCurve,
  blockExecutions,
  blockOf,
  curvesOf,
  exoName,
  routineName,
  seanceInfo,
  store,
  useAnalyseStore,
  type Block,
  type Curve,
  type Execution,
} from './fixtures-analyse';
import { fmtDate, fmtPct } from './format';
import { EmptyState, List, Row, ScreenHeader, SecondaryButton, SectionTitle, Sheet } from './kit';
import { useNav } from './shell';

const blockById = (id: string) => BLOCKS.find((b) => b.id === id)!;

export function blockDates(b: Block): string {
  return b.end ? `du ${fmtDate(b.start)} au ${fmtDate(b.end)}` : `depuis le ${fmtDate(b.start)}`;
}

/** « PPL automne, bloc 2 » si la routine a plusieurs blocs. */
export function blockName(b: Block): string {
  const same = BLOCKS.filter((x) => x.routineId === b.routineId);
  return same.length > 1 ? `${routineName(b.routineId)}, bloc ${same.indexOf(b) + 1}` : routineName(b.routineId);
}

/* ------------------------------------------------------------------------ */
/* Onglet Blocs                                                               */
/* ------------------------------------------------------------------------ */

export function AnalyseBlocs({ journal }: { journal: Execution[] }) {
  const nav = useNav();
  const { pair } = useAnalyseStore();
  const [picking, setPicking] = useState<'a' | 'b' | null>(null);
  const live = BLOCKS.filter((b) => blockExecutions(journal, b).length > 0);
  if (live.length < 2) {
    return (
      <EmptyState
        title="Un seul bloc pour l'instant"
        action={<SecondaryButton onClick={() => nav.go('seances')}>Voir tes séances</SecondaryButton>}
      />
    );
  }
  const A = blockById(pair[0]);
  const B = blockById(pair[1]);
  const exos = [...new Set(blockExecutions(journal, A).flatMap((e) => e.exercises.map((x) => x.exerciseId)))];
  const exosB = [...new Set(blockExecutions(journal, B).flatMap((e) => e.exercises.map((x) => x.exerciseId)))];
  const common = exos.filter((id) => exosB.includes(id));
  const rows = common.map((id) => {
    const ca = blockCurve(journal, id, A)!;
    const cb = blockCurve(journal, id, B)!;
    return { id, ca, cb, c: compare(ca.slope, cb.slope) };
  });
  const onlyB = exosB.filter((id) => !exos.includes(id));
  const onlyA = exos.filter((id) => !exosB.includes(id));
  const wins = (side: 'a' | 'b') => rows.filter((r) => r.c.kind === 'win' && r.c.side === side).length;
  const bothDown = rows.filter((r) => r.c.kind === 'both-down').length;
  const ties = rows.filter((r) => r.c.kind === 'tie').length;
  const none = rows.filter((r) => r.c.kind === 'none').length;

  return (
    <>
      <p className="px-5 pt-5 text-[15px] leading-[1.45] text-(--muted)">
        On compare des vitesses de progression, pas des niveaux. Chaque pente se lit dans une seule séance du bloc.
      </p>
      <div className="pt-3">
        <List label="Blocs comparés">
          {(['a', 'b'] as const).map((side) => {
            const b = side === 'a' ? A : B;
            return (
              <Row
                key={side}
                lead={side.toUpperCase()}
                title={blockName(b)}
                meta={`${blockDates(b)} · ${blockExecutions(journal, b).length} séances`}
                onClick={() => setPicking(side)}
                ariaLabel={`Bloc ${side.toUpperCase()} : ${blockName(b)}, ${blockDates(b)}. Changer`}
              />
            );
          })}
        </List>
      </div>

      <section aria-label="Verdict" className="px-5 pt-5">
        <p className="text-[19px] font-medium leading-[1.4] tracking-[-0.01em] text-(--ink)">
          {rows.length === 0
            ? 'Aucun exo commun aux deux blocs : rien à comparer.'
            : `Sur ${rows.length} exo${rows.length > 1 ? 's' : ''} commun${rows.length > 1 ? 's' : ''}, ${summary(wins('a'), wins('b'))}`}
        </p>
        {(bothDown > 0 || ties > 0 || none > 0) && (
          <p className="mt-1.5 text-[15px] leading-[1.45] text-(--muted)">
            {[
              bothDown > 0 && `${bothDown} sans gagnant : les deux pentes reculent`,
              ties > 0 && `${ties} à la même vitesse`,
              none > 0 && `${none} sans verdict, trop peu de séances`,
            ]
              .filter(Boolean)
              .join(' ; ')}
            .
          </p>
        )}
      </section>

      <SectionTitle aside="A puis B">Exo par exo</SectionTitle>
      <List label="Comparaison par exo">
        {rows.map((r) => (
          <Row
            key={r.id}
            title={exoName(r.id)}
            meta={
              <>
                <span className="flex items-center gap-2">
                  <span className="w-4 font-semibold text-(--ink)">A</span>
                  <SlopeStatus slope={r.ca.slope} points={r.ca.points.length} short />
                  <span className="text-(--faint)">{seanceInfo(r.ca.seanceId).name}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className="w-4 font-semibold text-(--ink)">B</span>
                  <SlopeStatus slope={r.cb.slope} points={r.cb.points.length} short />
                  <span className="text-(--faint)">{seanceInfo(r.cb.seanceId).name}</span>
                </span>
              </>
            }
            value={<span className="text-[15px] font-medium">{compareWord(r.c)}</span>}
            onClick={() => nav.push('comparer', { exo: r.id, a: `${A.id}|${r.ca.seanceId}`, b: `${B.id}|${r.cb.seanceId}` })}
            ariaLabel={`${exoName(r.id)} : ${compareWord(r.c)}. Ouvrir la comparaison`}
          />
        ))}
      </List>
      {(onlyA.length > 0 || onlyB.length > 0) && (
        <p className="px-5 pt-4 text-[14px] leading-[1.45] text-(--muted)">
          {onlyB.length > 0 && `${onlyB.length} exo${onlyB.length > 1 ? 's' : ''} seulement dans B, ${onlyA.length} seulement dans A : rien à comparer pour eux.`}
          {onlyB.length === 0 && onlyA.length > 0 && `${onlyA.length} exo${onlyA.length > 1 ? 's' : ''} seulement dans A : rien à comparer pour eux.`}
        </p>
      )}
      <p className="px-5 pt-3 text-[14px] leading-[1.45] text-(--faint)">
        Une lecture de pentes, pas une preuve : séances, ordre, fréquence et période de l'année changent ensemble.
      </p>

      <Sheet open={picking !== null} title={picking === 'a' ? 'Bloc A' : 'Bloc B'} onClose={() => setPicking(null)}>
        <List label="Blocs">
          {[...BLOCKS].reverse().map((b) => {
            const other = picking === 'a' ? B : A;
            const n = blockExecutions(journal, b).length;
            const taken = b.id === other.id;
            return (
              <Row
                key={b.id}
                title={blockName(b)}
                meta={`${blockDates(b)} · ${n} séances · ${b.cause}`}
                current={b.id === (picking === 'a' ? A : B).id}
                muted={taken || n === 0}
                value={taken ? <span className="text-[14px] font-normal text-(--faint)">déjà en {picking === 'a' ? 'B' : 'A'}</span> : undefined}
                onClick={
                  taken || n === 0
                    ? undefined
                    : () => {
                        store.setPair(picking === 'a' ? [b.id, B.id] : [A.id, b.id]);
                        setPicking(null);
                      }
                }
              />
            );
          })}
        </List>
      </Sheet>
    </>
  );
}

function summary(wa: number, wb: number): string {
  if (wa === 0 && wb === 0) return 'aucun bloc ne va plus vite que l’autre.';
  if (wa === 0) return `B va plus vite sur ${wb}, A sur aucun.`;
  if (wb === 0) return `A va plus vite sur ${wa}, B sur aucun.`;
  return `B va plus vite sur ${wb}, A sur ${wa}.`;
}

/* ------------------------------------------------------------------------ */
/* Sous-page : un exo, deux options                                           */
/* ------------------------------------------------------------------------ */

interface Option {
  key: string;
  block: Block;
  curve: Curve;
}

function optionsOf(journal: Execution[], exo: string): Option[] {
  return BLOCKS.flatMap((b) =>
    curvesOf(journal, exo, (e) => blockOf(e.date)?.id === b.id).map((c) => ({ key: `${b.id}|${c.seanceId}`, block: b, curve: c })),
  );
}

function optionLabel(o: Option): string {
  const s = seanceInfo(o.curve.seanceId);
  return `${s.name} · ${s.routineName}`;
}

const WEEK = 7 * 86_400_000;
const weeksFrom = (start: string, iso: string) => (Date.parse(iso) - Date.parse(start)) / WEEK;

export function ComparerExo({ exo, a, b }: { exo: string; a?: string; b?: string }) {
  const nav = useNav();
  const journal = useJournal();
  const options = optionsOf(journal, exo);
  // Par défaut : la plus récente face à la plus récente d'un autre bloc.
  const latest = options[options.length - 1];
  const fallbackA = [...options].reverse().find((o) => latest && o.block.id !== latest.block.id) ?? options[options.length - 2];
  const [keys, setKeys] = useState<[string | undefined, string | undefined]>([a ?? fallbackA?.key, b ?? latest?.key]);
  const [picking, setPicking] = useState<'a' | 'b' | null>(null);
  const oa = options.find((o) => o.key === keys[0]);
  const ob = options.find((o) => o.key === keys[1]);

  if (options.length < 2 || !oa || !ob) {
    return (
      <Page>
        <ScreenHeader title={exoName(exo)} meta="Comparer deux blocs" back={{ label: exoName(exo), onClick: nav.back }} />
        <EmptyState
          title="Rien à comparer"
          body={options.length === 0 ? 'Cet exo n’a aucune séance au journal.' : 'Cet exo n’a été fait que dans un seul bloc. Il en faut deux.'}
        />
      </Page>
    );
  }

  const c = compare(oa.curve.slope, ob.curve.slope);
  const toSeries = (o: Option, side: 'a' | 'b'): ChartSeries => {
    const p0 = o.curve.points[0]!;
    return {
      id: side,
      tone: side === 'b' ? 'ink' : 'muted',
      dashed: side === 'a',
      endLabel: side.toUpperCase(),
      points: o.curve.points.map((p) => ({ x: weeksFrom(p0.date, p.date), y: ((p.e1rm - p0.e1rm) / p0.e1rm) * 100 })),
    };
  };
  const maxWeeks = Math.ceil(Math.max(...[oa, ob].map((o) => weeksFrom(o.curve.points[0]!.date, o.curve.points[o.curve.points.length - 1]!.date))));
  const xTicks = Array.from({ length: Math.floor(maxWeeks / 2) + 1 }, (_, i) => ({ x: i * 2, label: i === 0 ? 'sem. 0' : String(i * 2) }));

  return (
    <Page>
      <ScreenHeader title={exoName(exo)} meta="Deux blocs, vitesse de progression" back={{ label: 'Retour', onClick: nav.back }} />
      <List label="Options comparées">
        {([
          ['a', oa],
          ['b', ob],
        ] as const).map(([side, o]) => (
          <Row
            key={side}
            lead={side.toUpperCase()}
            title={optionLabel(o)}
            meta={
              <>
                <span className="block">
                  {blockDates(o.block)} · {o.curve.points.length} séances
                </span>
                <SlopeStatus slope={o.curve.slope} points={o.curve.points.length} className="mt-0.5" />
              </>
            }
            onClick={() => setPicking(side)}
            ariaLabel={`Option ${side.toUpperCase()} : ${optionLabel(o)}, ${blockDates(o.block)}. Changer`}
          />
        ))}
      </List>

      <div className="px-5 pt-5">
        <Chart
          series={[toSeries(oa, 'a'), toSeries(ob, 'b')]}
          selected={null}
          xTicks={xTicks}
          yFormat={(v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toString().replace('.', ',')} %`}
          zeroLine
          height={200}
          ariaLabel={`Progression en % depuis le départ, A : ${optionLabel(oa)}, B : ${optionLabel(ob)}`}
        />
        <p className="mt-1 text-[13px] text-(--faint)">En % depuis la 1ʳᵉ séance de chaque bloc, semaine par semaine.</p>
      </div>

      <section aria-label="Verdict" className="px-5 pt-5">
        <Verdict c={c} a={oa} b={ob} />
      </section>
      <p className="px-5 pt-3 text-[14px] leading-[1.45] text-(--faint)">
        Une lecture de pentes, pas une preuve : séances, ordre, fréquence et période de l'année changent ensemble.
      </p>

      <Sheet open={picking !== null} title={picking === 'a' ? 'Option A' : 'Option B'} onClose={() => setPicking(null)}>
        <List label="Options">
          {[...options].reverse().map((o) => {
            const other = picking === 'a' ? ob : oa;
            const taken = o.key === other.key;
            return (
              <Row
                key={o.key}
                title={optionLabel(o)}
                meta={`${blockName(o.block)} · ${blockDates(o.block)} · ${o.curve.points.length} séances`}
                value={taken ? <span className="text-[14px] font-normal text-(--faint)">déjà en {picking === 'a' ? 'B' : 'A'}</span> : undefined}
                current={o.key === (picking === 'a' ? oa : ob).key}
                muted={taken}
                onClick={
                  taken
                    ? undefined
                    : () => {
                        setKeys(picking === 'a' ? [o.key, keys[1]] : [keys[0], o.key]);
                        setPicking(null);
                      }
                }
              />
            );
          })}
        </List>
      </Sheet>
    </Page>
  );
}

function Verdict({ c, a, b }: { c: Compare; a: Option; b: Option }) {
  const name = (side: 'a' | 'b') => `${side.toUpperCase()} (${optionLabel(side === 'a' ? a : b)})`;
  const big = 'text-[19px] font-medium leading-[1.4] tracking-[-0.01em] text-(--ink)';
  const small = 'mt-1.5 text-[15px] leading-[1.45] text-(--muted)';
  switch (c.kind) {
    case 'none':
      return (
        <>
          <p className={big}>Pas de verdict.</p>
          <p className={small}>
            {c.missing.map((s) => name(s)).join(' et ')} : moins de 3 séances, pas de pente. Une pente inventée serait pire que pas de pente.
          </p>
        </>
      );
    case 'tie':
      return (
        <>
          <p className={big}>Même vitesse des deux côtés.</p>
          <p className={small}>
            {fmtPct(a.curve.slope!)} contre {fmtPct(b.curve.slope!)} par semaine : l'écart est sous 0,25 %/sem.
          </p>
        </>
      );
    case 'both-down':
      return (
        <>
          <p className={big}>Pas de gagnant : les deux reculent.</p>
          <p className={small}>
            {fmtPct(a.curve.slope!)}/sem en A, {fmtPct(b.curve.slope!)}/sem en B.
            {c.lessBad && ` ${c.lessBad.toUpperCase()} recule moins vite, ce n'est pas une progression.`}
          </p>
        </>
      );
    case 'win': {
      const w = c.side === 'a' ? a : b;
      const l = c.side === 'a' ? b : a;
      return (
        <>
          <p className={big}>
            {c.winnerVerdict === 'up' ? `${name(c.side)} progresse plus vite.` : `${name(c.side)} tient mieux, sans progresser.`}
          </p>
          <p className={small}>
            {fmtPct(w.curve.slope!)}/sem contre {fmtPct(l.curve.slope!)}/sem.
          </p>
        </>
      );
    }
  }
}
