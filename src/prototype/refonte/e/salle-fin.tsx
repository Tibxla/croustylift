// PROTOTYPE JETABLE · socle E, sous-page Salle « fin-de-seance » : la Clôture.
//
// Trois états sur la même page :
//   1. Avant la Clôture : récap de l'Exécution (séries, kg soulevés, records,
//      exos un par un, y compris ceux en partie ou pas faits), décompte de
//      séries par muscle de la semaine contre le prévu de la routine, durée
//      chronométrée (corrigeable au stepper), BPM moyen facultatif (stepper).
//      Pas de note ici : la Note datée est par exo et se prend en Salle.
//   2. Après « Ranger la séance » (la Clôture) : « Séance rangée », récap
//      court, « Nouvelle séance » et un lien vers l'Analyse. Le bouton dit ce
//      qui se passe, avec le mot de l'écran d'arrivée (rangée). Écart assumé
//      avec le bouchon : le bouton
//      fait seance.close() et reste sur la page ; nav.reset() part sur
//      « Nouvelle séance » (sinon l'état rangé ne s'afficherait jamais).
//   3. Aucune série loggée : ce n'est pas une Exécution (CONTEXT.md), rien à
//      ranger, ni durée ni BPM ; seule action, quitter la séance.
//
// Clôture transitoire (ADR 0009) : si la page est remontée alors que la séance
// est déjà close (changement de surface puis retour), on repart au choix de
// la séance au lieu de réafficher un écran de fin.
//
// Signal : seulement pour « battue » et « record » (mieux que la dernière
// fois). Les barres par muscle n'ont ni signe ▲ ▬ ▼ (ils veulent dire « par
// rapport à la dernière fois ») ni couleur de statut : un mot, et la position
// de la barre contre le crochet du prévu.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ExercisePlan } from '../fixtures';
import type { Muscle } from './fixtures-e';
import { byCanonicalOrder, lastBpm, musclesOf, plannedWeek, setWeight, weekBefore, weekStart } from './fixtures-fin';
import { fmt1, fmtDate, fmtKg, range, refAt, setE1rm } from './format';
import {
  EmptyState,
  List,
  PrimaryButton,
  Row,
  Screen,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  Sign,
  Status,
  Stepper,
  TextLink,
} from './kit';
import { progressOf, totalSets, type Progress, type SeanceState } from './seance';
import { useNav, useProto } from './shell';

/* ------------------------------------------------------------------------ */
/* Calculs du récap                                                           */
/* ------------------------------------------------------------------------ */

interface ExoRecap {
  ex: ExercisePlan;
  progress: Progress;
  sets: number;
  beaten: number;
  matched: number;
  /** e1RM du record personnel battu aujourd'hui, null sinon. */
  record: number | null;
}

interface Recap {
  exos: ExoRecap[];
  sets: number;
  kg: number;
  beaten: number;
  records: { name: string; e1rm: number }[];
  count: Record<Progress, number>;
  /** Décompte pondéré du jour par muscle principal. */
  today: Partial<Record<Muscle, number>>;
}

function buildRecap(s: SeanceState): Recap {
  const count: Record<Progress, number> = { todo: 0, partial: 0, done: 0, skipped: 0 };
  const today: Partial<Record<Muscle, number>> = {};
  let kg = 0;
  const exos = s.exercises.map((ex): ExoRecap => {
    const logged = s.logged[ex.id] ?? [];
    const progress = progressOf(s, ex);
    count[progress]++;
    let beaten = 0;
    let matched = 0;
    logged.forEach((set, k) => {
      kg += set.weightKg * set.reps;
      const r = refAt(ex, k + 1);
      if (r && setE1rm(set) > setE1rm(r)) beaten++;
      else if (r && setE1rm(set) === setE1rm(r)) matched++;
    });
    const w = logged.reduce((n, set) => n + setWeight(set.reps), 0);
    if (w > 0) for (const m of musclesOf(ex.id)) today[m] = (today[m] ?? 0) + w;
    // Record personnel : meilleure e1RM du jour au-dessus de l'ancien record (ou
    // record déjà daté d'aujourd'hui). Un exo sans historique n'en bat aucun.
    const best = Math.max(0, ...logged.map(setE1rm));
    const record = ex.pr && best > 0 && (best > ex.pr.e1rm || (ex.pr.date === s.dateIso && best >= ex.pr.e1rm)) ? best : null;
    return { ex, progress, sets: logged.length, beaten, matched, record };
  });
  return {
    exos,
    sets: totalSets(s),
    kg: Math.round(kg),
    beaten: exos.reduce((n, e) => n + e.beaten, 0),
    records: exos.filter((e) => e.record !== null).map((e) => ({ name: e.ex.name, e1rm: e.record! })),
    count,
    today,
  };
}

/** « 3 460 » : espace fine insécable des milliers. */
const fmtInt = (n: number) => n.toLocaleString('fr-FR');

function addMinutes(hhmm: string, min: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = ((h ?? 0) * 60 + (m ?? 0) + min) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Durée : « 27 min » ; 0 (lancée il y a moins de 30 s, ADR 0011) se dit en mots. */
const fmtDur = (min: number) => (min === 0 ? 'moins d’1 min' : `${min} min`);

/** Plage horaire de la séance, ou l'heure de lancement seule si la durée est nulle. */
const span = (start: string, min: number) => (min === 0 ? `lancée à ${start}` : `de ${start} à ${addMinutes(start, min)}`);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

const PROGRESS_WORD: Record<Progress, string> = { done: 'fait', partial: 'en partie', skipped: 'passé', todo: 'pas fait' };

/* ------------------------------------------------------------------------ */
/* Page                                                                       */
/* ------------------------------------------------------------------------ */

interface Closing {
  duration: number;
  bpm: number | null;
}

export function SalleFin() {
  const nav = useNav();
  const { seance } = useProto();
  const s = seance.state;
  const recap = useMemo(() => buildRecap(s), [s]);
  const [closed, setClosed] = useState<Closing | null>(null);

  // Remontée sur une séance déjà close : la Clôture est un moment, pas un
  // statut (ADR 0009), on repart au choix de la séance.
  const stale = useRef(s.phase === 'aucune');
  useEffect(() => {
    if (stale.current) nav.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (stale.current && !closed) return null;

  if (closed) return <Rangee recap={recap} closing={closed} />;
  if (recap.sets === 0) return <SansSerie />;
  return <Cloture recap={recap} onClosed={setClosed} />;
}

/* ------------------------------------------------------------------------ */
/* 1. Avant la Clôture                                                        */
/* ------------------------------------------------------------------------ */

function Cloture({ recap, onClosed }: { recap: Recap; onClosed: (c: Closing) => void }) {
  const nav = useNav();
  const { seance, account, setAccount } = useProto();
  const s = seance.state;

  const [duration, setDuration] = useState(s.elapsedMin);
  const [durOpen, setDurOpen] = useState(false);
  const last = lastBpm(s.seanceName);
  const [bpmOn, setBpmOn] = useState(false);
  const [bpm, setBpm] = useState(last?.bpm ?? 130);

  const close = (c: Closing) => {
    seance.close();
    // Hors ligne, la Clôture rejoint les saisies en attente (outbox).
    if (account.offline) setAccount({ pendingSync: account.pendingSync + 1 });
    onClosed(c);
  };
  const pending = account.pendingSync;

  // Corriger la durée par crans de 5 min alignés (27 → 30 ou 25), au plus près
  // de ce qu'on retient d'une séance.
  const stepDuration = (v: number) => {
    const up = v > duration;
    setDuration(Math.max(1, up ? Math.floor(duration / 5) * 5 + 5 : Math.ceil(duration / 5) * 5 - 5));
  };

  return (
    <Screen
      bottom={
        <>
          {(account.offline || pending > 0) && (
            <p className="text-[14px] leading-[1.4] text-(--muted)">
              {account.offline
                ? `Hors ligne : la séance reste sur cet appareil et part au retour du réseau${pending ? `, avec ${plural(pending, 'saisie')} en attente` : ''}.`
                : `${plural(pending, 'saisie')} en cours d'envoi, la séance suit.`}
            </p>
          )}
          <PrimaryButton
            onClick={() => close({ duration, bpm: bpmOn ? bpm : null })}
            meta={`${fmtDur(duration)}${bpmOn ? ` · ${bpm} bpm` : ''}`}
            ariaLabel={`Ranger la séance, ${duration} minutes${bpmOn ? `, ${bpm} bpm` : ''}`}
          >
            Ranger la séance
          </PrimaryButton>
        </>
      }
    >
      <ScreenHeader
        title="Fin de séance"
        meta={`${s.seanceName} · ${s.routineName} · ${fmtDate(s.dateIso)}`}
        back={{ label: 'Séance', onClick: nav.back }}
      />

      <Figures recap={recap} />

      <section aria-labelledby="fin-exos">
        <SectionTitle aside={exosAside(recap.count)}>
          <span id="fin-exos">Exos</span>
        </SectionTitle>
        <List label="Exercices de la séance">
          {recap.exos.map((e, i) => (
            <ExoLine key={e.ex.id} e={e} i={i} />
          ))}
        </List>
      </section>

      <MuscleWeek today={recap.today} dateIso={s.dateIso} />

      <section aria-labelledby="fin-mesures">
        <SectionTitle>
          <span id="fin-mesures">Durée et cardio</span>
        </SectionTitle>
        <div className="border-t border-(--line)">
          {durOpen ? (
            <>
              <Stepper
                label="Durée"
                meta={duration === s.elapsedMin ? 'minutes, par crans de 5' : `minutes · chrono ${s.elapsedMin}`}
                value={duration}
                min={1}
                max={300}
                step={5}
                onChange={stepDuration}
              />
              <div className="flex justify-end border-b border-(--line) px-5">
                {duration !== s.elapsedMin ? (
                  <TextLink tone="muted" onClick={() => setDuration(s.elapsedMin)}>
                    Revenir au chrono
                  </TextLink>
                ) : (
                  <TextLink tone="muted" onClick={() => setDurOpen(false)}>
                    Garder le chrono
                  </TextLink>
                )}
              </div>
            </>
          ) : (
            <MeasureLine
              label="Durée"
              meta={s.elapsedMin === 0 ? `chrono lancé à ${s.startedAt}` : `chrono ${s.startedAt} à ${addMinutes(s.startedAt, s.elapsedMin)}`}
              value={fmtDur(duration)}
              action={<SecondaryButton size="sm" onClick={() => setDurOpen(true)} ariaLabel="Corriger la durée">Corriger</SecondaryButton>}
            />
          )}
          {bpmOn ? (
            <>
              <Stepper
                label="BPM moyen"
                meta={last ? `noté ${last.bpm} le ${fmtDate(last.date)}` : 'battements par minute'}
                value={bpm}
                min={40}
                max={220}
                onChange={setBpm}
              />
              <div className="flex justify-end border-b border-(--line) px-5">
                <TextLink tone="muted" onClick={() => setBpmOn(false)}>
                  Retirer le BPM
                </TextLink>
              </div>
            </>
          ) : (
            <MeasureLine
              label="BPM moyen"
              meta="facultatif, lu sur ta montre"
              value={<span className="text-[15px] font-normal text-(--muted)">pas noté</span>}
              action={<SecondaryButton size="sm" onClick={() => setBpmOn(true)} ariaLabel="Ajouter le BPM moyen">Ajouter</SecondaryButton>}
            />
          )}
        </div>
      </section>

    </Screen>
  );
}

function exosAside(c: Record<Progress, number>): string {
  const parts = [`${c.done} fait${c.done > 1 ? 's' : ''}`];
  if (c.partial) parts.push(`${c.partial} en partie`);
  if (c.skipped) parts.push(`${c.skipped} passé${c.skipped > 1 ? 's' : ''}`);
  if (c.todo) parts.push(`${c.todo} pas fait${c.todo > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

/** Trois chiffres, même grille que l'instrument (22 px, pas de chiffre géant). */
function Figures({ recap }: { recap: Recap }) {
  return (
    <dl className="grid grid-cols-3 gap-3 px-5">
      <div>
        <dt className="text-[13px] text-(--muted)">Séries</dt>
        <dd className="mt-1 text-[22px] font-medium leading-none tracking-[-0.01em] text-(--ink)">{recap.sets}</dd>
        <dd className="mt-1.5 text-[13px]">
          {recap.beaten > 0 ? <Status v="up" word={`${recap.beaten} battue${recap.beaten > 1 ? 's' : ''}`} /> : <span className="text-(--faint)">aucune battue</span>}
        </dd>
      </div>
      <div>
        <dt className="text-[13px] text-(--muted)">kg soulevés</dt>
        <dd className="mt-1 text-[22px] font-medium leading-none tracking-[-0.01em] text-(--ink)">{fmtInt(recap.kg)}</dd>
        <dd className="mt-1.5 text-[13px] text-(--faint)">poids × reps</dd>
      </div>
      <div className="text-right">
        <dt className="text-[13px] text-(--muted)">Records</dt>
        {recap.records.length > 0 ? (
          <>
            <dd className="mt-1 flex items-center justify-end gap-1.5 text-[22px] font-medium leading-none tracking-[-0.01em] text-(--sig)">
              <Sign v="up" size={13} />
              {recap.records.length}
            </dd>
            <dd className="mt-1.5 text-[13px] text-(--sig)">battu{recap.records.length > 1 ? 's' : ''}</dd>
          </>
        ) : (
          <dd className="mt-1 text-[16px] text-(--muted)">aucun</dd>
        )}
      </div>
    </dl>
  );
}

function ExoLine({ e, i }: { e: ExoRecap; i: number }) {
  const { ex, progress: p } = e;
  const worked = p === 'done' || p === 'partial';
  return (
    <Row
      lead={i + 1}
      title={ex.name}
      muted={!worked}
      meta={
        worked ? (
          <span className="flex flex-wrap items-center gap-x-2">
            <span>
              {plural(e.sets, 'série')}
              {p === 'partial' && ` sur ${range(ex.sets)}`}
            </span>
            {e.beaten > 0 && <Status v="up" word={`${e.beaten} battue${e.beaten > 1 ? 's' : ''}`} />}
            {e.matched > 0 && <Status v="eq" word={`${e.matched} égalée${e.matched > 1 ? 's' : ''}`} />}
            {e.record !== null && <Status v="up" word={`record ${fmt1(e.record)}`} />}
          </span>
        ) : p === 'skipped' ? (
          'passé aujourd’hui'
        ) : (
          `aucune série sur ${range(ex.sets)}`
        )
      }
      value={
        <span className={`text-[15px] ${p === 'done' ? 'font-medium text-(--ink)' : 'font-normal text-(--muted)'}`}>{PROGRESS_WORD[p]}</span>
      }
    />
  );
}

/** Ligne de mesure repliée : libellé, méta, valeur, action à droite. */
function MeasureLine({ label, meta, value, action }: { label: string; meta: string; value: ReactNode; action: ReactNode }) {
  return (
    <div className="flex min-h-16 items-center gap-3 border-b border-(--line) px-5 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-medium text-(--ink)">{label}</span>
        <span className="mt-0.5 block text-[14px] text-(--muted)">{meta}</span>
      </span>
      <span className="flex-none text-[17px] font-medium text-(--ink)">{value}</span>
      <span className="flex-none">{action}</span>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Décompte de séries par muscle, semaine                                     */
/* ------------------------------------------------------------------------ */

type Fit = 'sous' | 'dans' | 'au-dela';

function fitOf(total: number, [lo, hi]: [number, number]): Fit {
  if (total < lo - 0.05) return 'sous';
  if (total > hi + 0.05) return 'au-dela';
  return 'dans';
}

/** Un mot, sans signe ni couleur de statut : ▲ ▬ ▼ sont réservés à la
 *  comparaison avec la dernière fois. La barre contre le crochet dit le reste. */
const FIT: Record<Fit, string> = {
  sous: 'sous le prévu',
  dans: 'dans le prévu',
  'au-dela': 'au-dessus du prévu',
};

/** Bornes du prévu : entiers sans virgule, sinon une décimale. */
const fmtCount = (n: number) => fmtKg(Math.round(n * 10) / 10);
const fmtPlan = ([lo, hi]: [number, number]) => (fmtCount(lo) === fmtCount(hi) ? fmtCount(lo) : `${fmtCount(lo)}-${fmtCount(hi)}`);

interface MuscleRow {
  muscle: Muscle;
  before: number;
  today: number;
  plan: [number, number] | null;
}

function MuscleWeek({ today, dateIso }: { today: Partial<Record<Muscle, number>>; dateIso: string }) {
  const [all, setAll] = useState(false);
  const { rows, scale, routineName, seanceCount, seancesBefore } = useMemo(() => {
    const week = weekBefore(dateIso);
    const plan = plannedWeek();
    const muscles = new Set<Muscle>([
      ...(Object.keys(week.byMuscle) as Muscle[]),
      ...(Object.keys(plan.byMuscle) as Muscle[]),
      ...(Object.keys(today) as Muscle[]),
    ]);
    const rows: MuscleRow[] = [...muscles].sort(byCanonicalOrder).map((m) => ({
      muscle: m,
      before: week.byMuscle[m] ?? 0,
      today: today[m] ?? 0,
      plan: plan.byMuscle[m] ?? null,
    }));
    const top = Math.max(1, ...rows.map((r) => Math.max(r.before + r.today, r.plan?.[1] ?? 0)));
    return { rows, scale: Math.ceil(top / 5) * 5, routineName: plan.routineName, seanceCount: plan.seanceCount, seancesBefore: week.seances };
  }, [today, dateIso]);

  const worked = rows.filter((r) => r.today > 0);
  const others = rows.filter((r) => r.today === 0);
  const shown = all ? [...worked, ...others] : worked;

  return (
    <section aria-labelledby="fin-muscles">
      <SectionTitle aside={`semaine du ${fmtDate(weekStart(dateIso))}`}>
        <span id="fin-muscles">Séries par muscle</span>
      </SectionTitle>
      <p className="px-5 text-[14px] leading-[1.45] text-(--muted)">
        {seancesBefore.length > 0 ? `Avant aujourd’hui : ${seancesBefore.join(', ')}. ` : 'Première séance de la semaine. '}
        Prévu : {routineName}, ses {seanceCount} séances une fois. Une série de moins de 5 reps compte en partie.
      </p>
      <Legend />
      <ul aria-label="Séries par muscle, semaine" className="border-t border-(--line)">
        {shown.map((r) => (
          <MuscleLine key={r.muscle} r={r} scale={scale} />
        ))}
      </ul>
      {others.length > 0 && (
        <div className="px-5 pt-1">
          <TextLink tone="muted" onClick={() => setAll((v) => !v)}>
            {all ? 'Seulement les muscles du jour' : `Voir les ${others.length} autres muscles`}
          </TextLink>
        </div>
      )}
    </section>
  );
}

function Legend() {
  return (
    <div aria-hidden className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-2 pt-3 text-[13px] text-(--faint)">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-[4px] w-4 bg-(--ink)" />
        aujourd’hui
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-[4px] w-4 bg-(--muted)" />
        plus tôt
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-[10px] w-4 border-x-2 border-b-2 border-(--faint)" />
        prévu
      </span>
    </div>
  );
}

function MuscleLine({ r, scale }: { r: MuscleRow; scale: number }) {
  const total = r.before + r.today;
  const fit = r.plan ? FIT[fitOf(total, r.plan)] : null;
  const pct = (v: number) => `${(Math.min(v, scale) / scale) * 100}%`;
  const name = r.muscle[0]!.toUpperCase() + r.muscle.slice(1);
  return (
    <li
      className="border-b border-(--line) px-5 py-3"
      aria-label={`${name} : ${fmt1(total)} séries cette semaine, dont ${fmt1(r.today)} aujourd’hui. ${
        r.plan ? `Prévu ${fmtCount(r.plan[0])} à ${fmtCount(r.plan[1])}, ${fit}.` : 'Hors du prévu de la routine.'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[16px] font-medium text-(--ink)">{name}</span>
        <span className="flex-none text-[16px] font-medium text-(--ink)">
          {fmt1(total)}
          <span className="ml-1.5 text-[14px] font-normal text-(--muted)">{r.plan ? `prévu ${fmtPlan(r.plan)}` : 'pas au prévu'}</span>
        </span>
      </div>
      {/* Piste pleine, « plus tôt » en gris, « aujourd'hui » en blanc cassé, et le
          prévu en crochet sous la piste : deux bornes qui traversent la barre. */}
      <div aria-hidden className="relative mt-2 h-[15px]">
        <span className="absolute inset-x-0 top-[3px] h-[6px] bg-(--line)" />
        <span className="absolute left-0 top-[3px] h-[6px] bg-(--muted)" style={{ width: pct(r.before) }} />
        <span className="absolute top-[3px] h-[6px] bg-(--ink)" style={{ left: pct(r.before), width: `calc(${pct(total)} - ${pct(r.before)})` }} />
        {r.plan && (
          <span
            className="absolute inset-y-0 border-x-2 border-b-2 border-(--faint)"
            style={{ left: `calc(${pct(r.plan[0])} - 1px)`, width: `calc(${pct(r.plan[1])} - ${pct(r.plan[0])} + 2px)` }}
          />
        )}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-[13px]">
        {fit ? (
          <span className="text-(--muted)">{fit}</span>
        ) : (
          <span className="text-(--faint)">aucune séance du plan ne le travaille</span>
        )}
        <span className="text-(--faint)">{r.today > 0 ? `+${fmt1(r.today)} aujourd’hui` : 'rien aujourd’hui'}</span>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------------ */
/* 2. Séance rangée                                                           */
/* ------------------------------------------------------------------------ */

function Rangee({ recap, closing }: { recap: Recap; closing: Closing }) {
  const nav = useNav();
  const { seance, account } = useProto();
  const s = seance.state;
  const pending = account.pendingSync;
  return (
    <Screen bottom={<PrimaryButton onClick={() => nav.reset()}>Nouvelle séance</PrimaryButton>}>
      <div className="pt-3" />
      <ScreenHeader
        title="Séance rangée"
        meta={`${s.seanceName} · ${fmtDate(s.dateIso)}, ${span(s.startedAt, closing.duration)}`}
      />
      <dl className="border-t border-(--line)">
        <Fact label="Durée" value={fmtDur(closing.duration)} />
        <Fact label="Séries" value={String(recap.sets)} aside={recap.beaten > 0 ? <Status v="up" word={`${recap.beaten} battue${recap.beaten > 1 ? 's' : ''}`} /> : undefined} />
        <Fact label="kg soulevés" value={fmtInt(recap.kg)} />
        {closing.bpm !== null && <Fact label="BPM moyen" value={String(closing.bpm)} />}
        {recap.records.map((r) => (
          <Fact key={r.name} label={r.name} value={<span className="text-(--sig)">{fmt1(r.e1rm)}</span>} aside={<Status v="up" word="nouveau record" />} />
        ))}
      </dl>
      <p role="status" className="px-5 pt-5 text-[15px] leading-[1.45] text-(--muted)">
        {account.offline
          ? `Gardée sur cet appareil, avec ${plural(pending, 'saisie')} en attente. Tout part au retour du réseau, rien à faire.`
          : pending > 0
            ? `${plural(pending, 'saisie')} en cours d’envoi.`
            : 'Elle est dans le journal, avec la durée et le récap.'}
      </p>
      <div className="px-5 pt-1">
        <TextLink
          onClick={() => {
            nav.reset();
            nav.go('analyse');
          }}
        >
          Voir dans l’Analyse
        </TextLink>
      </div>
    </Screen>
  );
}

function Fact({ label, value, aside }: { label: string; value: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-(--line) px-5 py-2.5">
      <dt className="flex min-w-0 items-center gap-3">
        <span className="truncate text-[16px] text-(--muted)">{label}</span>
        {aside && <span className="flex-none text-[14px]">{aside}</span>}
      </dt>
      <dd className="flex-none text-[16px] font-medium text-(--ink)">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* 3. Aucune série loggée                                                     */
/* ------------------------------------------------------------------------ */

function SansSerie() {
  const nav = useNav();
  const { seance } = useProto();
  const s = seance.state;
  return (
    <Screen
      bottom={
        <PrimaryButton
          onClick={() => {
            seance.close();
            nav.reset();
          }}
        >
          Quitter la séance
        </PrimaryButton>
      }
    >
      <ScreenHeader title="Fin de séance" meta={`${s.seanceName} · ${s.routineName}`} back={{ label: 'Séance', onClick: nav.back }} />
      <EmptyState
        title="Aucune série loggée"
        body="Elle n’entre pas au journal."
      />
    </Screen>
  );
}
