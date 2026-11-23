// PROTOTYPE JETABLE · socle E, Analyse > Journal.
//
// En tête, la durée et le BPM moyen dans le temps : deux petits graphes
// superposés qui partagent l'axe du temps et le même doigt. Un BPM non saisi
// coupe le trait (jamais un zéro, jamais relié en douce). Puis l'historique
// brut, mois par mois, séance par séance, sans dérivation.
//
// Sous-page `seance` : une entrée du journal et son éditeur. Toucher une série
// ouvre une feuille avec la règle de poids et les rangées reps / RIR de la
// Salle (aucun clavier) ; durée et BPM se corrigent au stepper. Supprimer la
// séance passe par une confirmation qui dit ce qui disparaît (ADR 0008). La
// séance en cours ne se corrige pas ici : elle appartient encore à la Salle.
import { useState } from 'react';
import { Chart, dayOf, monthTicks, type ChartSel } from './analyse-chart';
import { fmtDateLong, fmtDuration, fmtInt, fmtMonthTitle, fmtWeekday, useJournal, Page } from './analyse-common';
import { exoName, liftedKg, prescriptionOf, seanceInfo, store, useAnalyseStore, type Execution } from './fixtures-analyse';
import { fmt1, fmtDate, fmtKg, setE1rm, type SetValue } from './format';
import {
  EmptyState,
  List,
  NumberRow,
  PrimaryButton,
  Row,
  Ruler,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  Sheet,
  Stepper,
  Switch,
  TextLink,
} from './kit';
import { useNav, useProto } from './shell';

const nSets = (e: Execution) => e.exercises.reduce((n, x) => n + x.sets.length, 0);
const lifted = (e: Execution) => e.exercises.reduce((n, x) => n + liftedKg(x.sets), 0);

/* ------------------------------------------------------------------------ */
/* Onglet Journal                                                             */
/* ------------------------------------------------------------------------ */

export function JournalTab({ journal }: { journal: Execution[] }) {
  const nav = useNav();
  const { notice } = useAnalyseStore();
  const newest = [...journal].reverse();
  const months: { key: string; items: Execution[] }[] = [];
  for (const e of newest) {
    const key = e.date.slice(0, 7);
    const g = months[months.length - 1];
    if (g && g.key === key) g.items.push(e);
    else months.push({ key, items: [e] });
  }
  return (
    <>
      {notice && (
        <p role="status" className="border-b border-(--line) px-5 py-3 text-[15px] text-(--ink)">
          {notice}
        </p>
      )}
      <Metrics journal={journal} />
      {months.map((m) => (
        <section key={m.key} aria-label={fmtMonthTitle(`${m.key}-01`)}>
          <SectionTitle aside={`${m.items.length} séance${m.items.length > 1 ? 's' : ''}`}>{fmtMonthTitle(`${m.key}-01`)}</SectionTitle>
          <List label={`Séances de ${fmtMonthTitle(`${m.key}-01`)}`}>
            {m.items.map((e) => {
              const s = seanceInfo(e.seanceId);
              return (
                <Row
                  key={e.id}
                  lead={Number(e.date.slice(8, 10))}
                  title={s.name}
                  meta={`${fmtWeekday(e.date)}${s.archivedRoutine ? ` · ${s.routineName}` : ''} · ${nSets(e)} séries`}
                  value={<span className="text-[16px]">{e.live ? 'en cours' : fmtDuration(e.durationMin)}</span>}
                  valueMeta={e.live ? `${e.durationMin} min` : e.bpm !== null ? `${e.bpm} BPM` : undefined}
                  onClick={() => {
                    // Le message d'un geste (suppression) se dit une fois.
                    store.setNotice(null);
                    nav.push('seance', { id: e.id });
                  }}
                  ariaLabel={`${s.name}, ${fmtDateLong(e.date)}. Ouvrir`}
                />
              );
            })}
          </List>
        </section>
      ))}
    </>
  );
}

/** Durée et BPM dans le temps : deux graphes en points seuls (une mesure par
 *  séance, rien d'interpolé), même axe du temps, même doigt. Une séance sans
 *  BPM n'a pas de point dans le second : le curseur y passe quand même. */
function Metrics({ journal }: { journal: Execution[] }) {
  const closed = journal.filter((e) => !e.live);
  const [i, setI] = useState(closed.length - 1);
  if (closed.length === 0) return null;
  const k = Math.min(i, closed.length - 1);
  const e = closed[k]!;
  const domain: [number, number] = [dayOf(closed[0]!.date), dayOf(closed[closed.length - 1]!.date)];
  const ticks = monthTicks(closed[0]!.date, closed[closed.length - 1]!.date);
  const bpm = closed.flatMap((x, at) => (x.bpm === null ? [] : [{ x: dayOf(x.date), y: x.bpm, at }]));
  const bpmSel = bpm.findIndex((p) => p.at === k);

  return (
    <section aria-label="Durée et BPM">
      <SectionTitle aside={`${closed.length} séances, ${bpm.length} avec BPM`}>Durée et BPM</SectionTitle>
      <div className="flex items-baseline justify-between gap-3 px-5" aria-live="polite">
        <span className="text-[15px] text-(--muted)">
          {fmtDate(e.date)} · {seanceInfo(e.seanceId).name}
        </span>
        <span className="text-[17px] font-medium text-(--ink)">
          {fmtDuration(e.durationMin)}
          <span className="text-(--muted)"> · </span>
          {e.bpm !== null ? `${e.bpm} BPM` : <span className="font-normal text-(--muted)">BPM non saisi</span>}
        </span>
      </div>
      <div className="mt-3 px-5">
        <p className="text-[14px] text-(--muted)">Durée, en minutes</p>
        <Chart
          series={[{ id: 'duree', tone: 'ink', line: false, points: closed.map((x) => ({ x: dayOf(x.date), y: x.durationMin })) }]}
          selected={{ series: 'duree', index: k }}
          onSelect={(sel: ChartSel) => setI(sel.index)}
          xDomain={domain}
          xTicks={[]}
          yFormat={(v) => String(Math.round(v))}
          yTarget={2}
          height={104}
          ariaLabel={`Durée des ${closed.length} séances`}
        />
        <p className="mt-2 text-[14px] text-(--muted)">BPM moyen, quand il a été saisi</p>
        {bpm.length === 0 ? (
          <p className="py-6 text-[15px] text-(--muted)">Aucun BPM saisi pour l'instant.</p>
        ) : (
          <Chart
            series={[{ id: 'bpm', tone: 'ink', line: false, points: bpm }]}
            selected={bpmSel >= 0 ? { series: 'bpm', index: bpmSel } : null}
            cursorX={dayOf(e.date)}
            onSelect={(sel: ChartSel) => setI(bpm[sel.index]!.at)}
            xDomain={domain}
            xTicks={ticks}
            yFormat={(v) => String(Math.round(v))}
            yTarget={2}
            height={128}
            ariaLabel={`BPM moyen de ${bpm.length} séances sur ${closed.length}`}
          />
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Sous-page : une séance du journal                                          */
/* ------------------------------------------------------------------------ */

type Editing = { exerciseId: string; rank: number; value: SetValue } | null;

export function SeancePage({ id }: { id: string }) {
  const nav = useNav();
  const journal = useJournal();
  const e = journal.find((x) => x.id === id);
  const [editing, setEditing] = useState<Editing>(null);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);

  if (!e) {
    return (
      <Page>
        <ScreenHeader title="Séance introuvable" back={{ label: 'Journal', onClick: nav.back }} />
        <EmptyState title="Elle n'est plus au journal" body="Supprimée, ou toutes ses séries retirées." />
      </Page>
    );
  }
  const s = seanceInfo(e.seanceId);
  const canEdit = !e.live;

  return (
    <Page>
      <ScreenHeader title={s.name} meta={`${fmtDateLong(e.date)} · ${s.routineName}`} back={{ label: 'Journal', onClick: nav.back }} />

      <dl className="grid grid-cols-4 gap-2 border-y border-(--line) px-5 py-3">
        <Fact label="Durée" value={fmtDuration(e.durationMin)} />
        <Fact label="BPM" value={e.bpm !== null ? String(e.bpm) : null} />
        <Fact label="Séries" value={String(nSets(e))} />
        <Fact label="kg soulevés" value={fmtInt(lifted(e))} />
      </dl>
      {canEdit ? (
        <div className="px-5">
          <TextLink tone="muted" onClick={() => setMetricsOpen(true)}>
            Corriger la durée ou le BPM
          </TextLink>
        </div>
      ) : (
        <p className="px-5 pt-3 text-[15px] leading-[1.45] text-(--muted)">
          En cours en salle. Elle se corrige depuis la Salle tant qu'elle n'est pas close.
        </p>
      )}

      {e.exercises.map((x) => {
        const first = x.sets[0];
        return (
          <section key={x.exerciseId} aria-label={exoName(x.exerciseId)}>
            <SectionTitle aside={first ? `e1RM ${fmt1(setE1rm(first))}` : undefined}>{exoName(x.exerciseId)}</SectionTitle>
            <List label={`Séries de ${exoName(x.exerciseId)}`}>
              {x.sets.map((v, k) => (
                <Row
                  key={k}
                  lead={k + 1}
                  title={`${fmtKg(v.weightKg)} × ${v.reps} · RIR ${v.rir}`}
                  valueMeta={`${fmtInt(v.weightKg * v.reps)} kg`}
                  onClick={canEdit ? () => setEditing({ exerciseId: x.exerciseId, rank: k + 1, value: { ...v } }) : undefined}
                  ariaLabel={`Série ${k + 1}, ${fmtKg(v.weightKg)} × ${v.reps} à RIR ${v.rir}. Corriger`}
                />
              ))}
            </List>
          </section>
        );
      })}
      {canEdit && (
        <div className="px-5 pt-6">
          <TextLink tone="muted" onClick={() => setConfirm(true)}>
            Supprimer cette séance
          </TextLink>
        </div>
      )}

      <SetEditor
        key={editing ? `serie-${editing.exerciseId}-${editing.rank}` : 'serie-ferme'}
        e={e}
        editing={editing}
        onClose={() => setEditing(null)}
        onSave={(v) => {
          if (!editing) return;
          store.updateSet(e.id, editing.exerciseId, editing.rank, v);
          setEditing(null);
        }}
        onRemove={() => {
          if (!editing) return;
          const last = nSets(e) === 1;
          store.removeSet(e.id, editing.exerciseId, editing.rank);
          setEditing(null);
          if (last) {
            store.setNotice(`Séance du ${fmtDate(e.date)} retirée du journal : plus aucune série.`);
            nav.back();
          }
        }}
      />
      <MetricsEditor key={metricsOpen ? 'metriques-ouvert' : 'metriques-ferme'} e={e} open={metricsOpen} onClose={() => setMetricsOpen(false)} />
      <Sheet
        open={confirm}
        title="Supprimer la séance ?"
        onClose={() => setConfirm(false)}
        footer={
          <>
            <SecondaryButton onClick={() => setConfirm(false)} className="w-full">
              Garder la séance
            </SecondaryButton>
            <PrimaryButton
              onClick={() => {
                store.removeExecution(e.id, `${s.name} du ${fmtDate(e.date)} supprimée, ${nSets(e)} séries.`);
                setConfirm(false);
                nav.back();
              }}
              meta={`${nSets(e)} séries`}
            >
              Supprimer
            </PrimaryButton>
          </>
        }
      >
        <p className="px-5 pb-2 text-[16px] leading-[1.5] text-(--ink)">
          {s.name} du {fmtDateLong(e.date)}, {e.exercises.length} exos et {nSets(e)} séries.
        </p>
        <p className="px-5 text-[15px] leading-[1.5] text-(--muted)">
          Elles quittent le journal, les courbes et les records. La suppression ne se défait pas.
        </p>
      </Sheet>
    </Page>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-(--muted)">{label}</dt>
      <dd className={`mt-1 truncate ${value === null ? 'text-[15px] text-(--muted)' : 'text-[18px] font-medium text-(--ink)'}`}>
        {value ?? 'non saisi'}
      </dd>
    </div>
  );
}

const REPS = Array.from({ length: 30 }, (_, i) => i + 1);
const RIRS = [0, 1, 2, 3, 4, 5];

function SetEditor({
  e,
  editing,
  onClose,
  onSave,
  onRemove,
}: {
  e: Execution;
  editing: Editing;
  onClose: () => void;
  onSave: (v: SetValue) => void;
  onRemove: () => void;
}) {
  const { settings } = useProto();
  const [v, setV] = useState<SetValue | null>(editing?.value ?? null);
  if (!editing || !v) return null;
  const step = settings.stepKg;
  const presc = prescriptionOf(e.seanceId, editing.exerciseId);
  const orig = editing.value;
  const changed = v.weightKg !== orig.weightKg || v.reps !== orig.reps || v.rir !== orig.rir;
  const kgStr = fmtKg(v.weightKg);
  return (
    <Sheet
      open
      title={`Série ${editing.rank} · ${exoName(editing.exerciseId)}`}
      onClose={onClose}
      footer={
        <>
          <div className="flex min-h-11 items-center justify-between">
            <TextLink tone="muted" onClick={onRemove}>
              Supprimer cette série
            </TextLink>
            <span className="text-[14px] text-(--muted)">
              avant {fmtKg(orig.weightKg)} × {orig.reps} · RIR {orig.rir}
            </span>
          </div>
          <PrimaryButton onClick={() => onSave(v)} disabled={!changed} meta={`e1RM ${fmt1(setE1rm(v))}`}>
            {changed ? 'Enregistrer' : 'Rien à enregistrer'}
          </PrimaryButton>
        </>
      }
    >
      <p className="px-5 text-[14px] text-(--muted)">
        {seanceInfo(e.seanceId).name}, {fmtDateLong(e.date)}
      </p>
      <output aria-live="polite" className="mt-1 flex items-baseline leading-none">
        <span className="w-1/2 text-right text-[56px] font-[650] tracking-[-0.045em] text-(--ink)">{Math.trunc(v.weightKg)}</span>
        <span className="w-1/2 whitespace-nowrap text-left">
          <span className="text-[56px] font-[650] tracking-[-0.045em] text-(--ink)">{kgStr.includes(',') ? `,${kgStr.split(',')[1]}` : ''}</span>
          <span className="ml-2 text-[20px] font-medium text-(--muted)">kg</span>
        </span>
      </output>
      <div className="mt-2">
        <Ruler
          key={step}
          label="Poids"
          steps={v.weightKg / step}
          max={Math.round(500 / step)}
          pxPerStep={11.2 * step}
          isMajor={(s) => (s * step) % 5 === 0}
          isMid={(s) => (s * step) % 2.5 === 0}
          majorLabel={(s) => fmtKg(s * step)}
          format={(s) => `${fmtKg(s * step)} kg`}
          onChange={(s) => setV({ ...v, weightKg: s * step })}
        />
      </div>
      <div className="mt-2 flex flex-col gap-1.5 pb-2">
        <NumberRow
          label="Reps"
          values={REPS}
          value={v.reps}
          presc={presc?.reps ?? [orig.reps, orig.reps]}
          refValue={null}
          onPick={(n) => setV({ ...v, reps: n })}
          scrollTo={Math.max(1, Math.min(v.reps - 3, 24))}
          perView={7}
        />
        <NumberRow
          label="RIR"
          values={RIRS}
          value={v.rir}
          presc={presc?.rir ?? [orig.rir, orig.rir]}
          refValue={null}
          onPick={(n) => setV({ ...v, rir: n })}
          perView={6}
        />
      </div>
    </Sheet>
  );
}

function MetricsEditor({ e, open, onClose }: { e: Execution; open: boolean; onClose: () => void }) {
  const [duration, setDuration] = useState(e.durationMin);
  const [hasBpm, setHasBpm] = useState(e.bpm !== null);
  const [bpm, setBpm] = useState(e.bpm ?? 130);
  return (
    <Sheet
      open={open}
      title="Durée et BPM"
      onClose={onClose}
      footer={
        <PrimaryButton
          onClick={() => {
            store.updateMetrics(e.id, duration, hasBpm ? bpm : null);
            onClose();
          }}
        >
          Enregistrer
        </PrimaryButton>
      }
    >
      <div className="border-t border-(--line)">
        <Stepper label="Durée" meta="minutes chronométrées" value={duration} onChange={setDuration} min={1} max={600} />
        <Switch label="BPM moyen saisi" meta="Optionnel. Sans saisie, la courbe se coupe ici." checked={hasBpm} onChange={setHasBpm} />
        {hasBpm && <Stepper label="BPM moyen" value={bpm} onChange={setBpm} min={60} max={220} />}
      </div>
    </Sheet>
  );
}
