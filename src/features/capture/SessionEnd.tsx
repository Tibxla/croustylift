// Fin de séance (la Clôture), en deux temps sur la même page.
//
//   1. Avant « Ranger la séance » : le récap de l'exécution (`buildSessionRecap`,
//      session-recap.ts) : séries, battues, kg soulevés, nouveaux records ; les
//      exos un par un, y compris en cours, passés ou pas faits ; les séries par
//      muscle de la SEMAINE civile contre le prévu de la routine
//      (`weekSetsByMuscle`, lu par week-muscles.ts) ; la durée chronométrée,
//      corrigeable par crans de 5 min (`nudgeDuration`) ; le BPM moyen
//      facultatif, réglé à la règle (jamais de clavier).
//   2. Après : « Séance rangée », le récap court et « Nouvelle séance ». La
//      Clôture est transitoire (ADR 0009) : remontée, la page ne revient pas.
//
// Le signal ne sert qu'à « mieux que la dernière fois » : séries battues ▲ et
// nouveaux records, chacun dans son axe, son unité et son côté (`RecapRecord` :
// à 0 kg, des reps effectives). Les barres par muscle n'ont ni signe ni couleur de statut :
// un mot (sous, dans, au-dessus du prévu) et la barre contre le crochet du prévu.
// Le chargement de la semaine ne bloque jamais « Ranger la séance » : pendant
// qu'il court, une ligne le dit ; hors ligne, une ligne dit ce qui manque.
//
// La durée : `null` (chrono non mesuré) n'est rien écrit tant que l'utilisateur
// n'y touche pas ; corrigée, elle remplace la durée du chrono.
import { useMemo, useState, type ReactNode } from 'react';
import { errorMessage } from '../../lib/error-message';
import type { PerformedExercise } from '../../domain/set-count';
import { weekStartIso } from '../../domain/week';
import { useSyncState } from '../../shell/useSyncState';
import {
  IconButton,
  List,
  PrimaryButton,
  Row,
  Ruler,
  Screen,
  ScreenHeader,
  SectionTitle,
  Sign,
  Status,
  StateMark,
  Stepper,
  TextLink,
  type ExoState,
} from '../../ui';
import { formatCount, formatE1rm, formatWeight } from './format';
import {
  nudgeDuration,
  weekSetsByMuscle,
  type ExerciseRecap,
  type ExerciseStatus,
  type PlanFit,
  type RecapRecord,
  type SessionRecap,
  type WeekMuscleRow,
} from './session-recap';
import { SESSION_DURATION_MAX_MIN } from './summary';
import type { WeekMusclesInput } from './week-muscles';

/** Ce que la fin de séance remonte au parent pour persistance (champ omis = non saisi). */
export interface SessionEndValues {
  bpmAvg?: number | null;
  /** Durée retenue (min) : celle du chrono, ou corrigée ; omise si rien n'est mesuré ni saisi. */
  durationMin?: number;
}

interface SessionEndProps {
  recap: SessionRecap;
  /** Les exos de la séance du jour, pour le décompte de la semaine. */
  today: PerformedExercise[];
  /** La semaine et le prévu ; `null` pendant le chargement. */
  week: WeekMusclesInput | null;
  /** Date adoptée de la séance (jour ISO). */
  dateIso: string;
  /** Lancement de la séance (ms, ADR 0011) : la plage horaire de « Séance rangée ». */
  startedAt: number;
  /** Durée du chrono (min), du lancement à l'ouverture de la fin ; `null` si non mesurable. */
  durationMin: number | null;
  /** Enregistre les métriques (peut échouer côté réseau ; le parent gère le retry). */
  onSave: (values: SessionEndValues) => Promise<void> | void;
  /** Retour à la séance (elle n'est pas close). */
  onBack: () => void;
  /** Repart sur une séance fraîche, depuis l'écran de confirmation. */
  onNewSession: () => void;
}

const BPM_DEFAULT = 130;
const BPM_MIN = 30;
const BPM_MAX = 240;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
/** Décompte pondéré (ADR 0006) sans « ,0 » inutile : « 4 », « 3,6 ». */
const tally = (v: number) => {
  const s = formatCount(v);
  return s.endsWith(',0') ? s.slice(0, -2) : s;
};
const kg = (v: number) => Math.round(v).toLocaleString('fr-FR');
const fmtDur = (min: number) => (min === 0 ? 'moins d’1 min' : `${min} min`);
const localDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
};
const fmtDay = (iso: string) => localDate(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const weekday = (iso: string) => localDate(iso).toLocaleDateString('fr-FR', { weekday: 'short' });

const sideWord = (side: 'left' | 'right') => (side === 'left' ? 'gauche' : 'droite');

/** Un record dans son axe et son unité : e1RM en kg, charge en « poids × reps »,
 *  et à 0 kg des reps (effectives sur l'axe e1RM, ADR 0013), jamais « 0 kg ». */
function recordValue(r: RecapRecord): string {
  if (r.unit === 'reps') return r.axis === 'e1rm' ? `${r.value} reps effectives` : `${r.value} reps`;
  return r.axis === 'e1rm' ? `e1RM ${formatE1rm(r.value)}` : `${formatWeight(r.set.weightKg)} × ${r.set.reps}`;
}

// Un seul mot pour un exo commencé, partout : « en cours ».
const STATUS_WORD: Record<ExerciseStatus, string> = { fait: 'fait', 'en-cours': 'en cours', passe: 'passé', 'pas-fait': 'pas fait' };
const STATUS_MARK: Record<ExerciseStatus, ExoState> = { fait: 'done', 'en-cours': 'partial', passe: 'skipped', 'pas-fait': 'todo' };

export function SessionEnd({ recap, today, week, dateIso, startedAt, durationMin, onSave, onBack, onNewSession }: SessionEndProps) {
  const [duration, setDuration] = useState<number | null>(durationMin);
  const [durOpen, setDurOpen] = useState(false);
  const [bpmOn, setBpmOn] = useState(false);
  const [bpm, setBpm] = useState(BPM_DEFAULT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SessionEndValues | null>(null);

  async function commit(values: SessionEndValues) {
    setSaving(true);
    setError(null);
    try {
      await onSave(values);
      setSaved(values);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (saved) return <SessionDone recap={recap} dateIso={dateIso} startedAt={startedAt} values={saved} onNewSession={onNewSession} />;

  const started = recap.counts['en-cours'];
  const measure = [duration !== null ? fmtDur(duration) : null, bpmOn ? `${bpm} bpm` : null].filter(Boolean).join(' · ');

  return (
    <Screen
      bottom={
        <>
          {/* Exos en cours : une information, pas un blocage. */}
          {started > 0 && (
            <p className="text-[14px] leading-[1.4] text-muted">
              {plural(started, 'exo')} en cours, rangé{started > 1 ? 's' : ''} tel{started > 1 ? 's' : ''} quel{started > 1 ? 's' : ''}.
            </p>
          )}
          <PrimaryButton
            disabled={saving}
            meta={measure || undefined}
            ariaLabel={`Ranger la séance${duration !== null ? `, ${duration} minutes` : ''}${bpmOn ? `, ${bpm} bpm` : ''}`}
            onClick={() => void commit({ bpmAvg: bpmOn ? bpm : undefined, durationMin: duration ?? undefined })}
          >
            {saving ? 'Rangement…' : 'Ranger la séance'}
          </PrimaryButton>
        </>
      }
    >
      <ScreenHeader title="Fin de séance" meta={`${recap.sessionName} · ${fmtDay(dateIso)}`} back={{ label: 'Séance', onClick: onBack }} />

      <Figures recap={recap} />

      <section aria-labelledby="fin-exos">
        <SectionTitle id="fin-exos" aside={exosAside(recap.counts)}>
          Exos
        </SectionTitle>
        <List label="Exercices de la séance">
          {recap.exercises.map((e, i) => (
            <ExoLine key={e.exerciseId} e={e} i={i} />
          ))}
        </List>
      </section>

      <MuscleWeek today={today} week={week} dateIso={dateIso} />

      <section aria-labelledby="fin-mesures">
        <SectionTitle id="fin-mesures">Durée et cardio</SectionTitle>
        <div className="border-t border-line">
          {durOpen ? (
            <>
              <Stepper
                label="Durée"
                meta={durationMin === null ? 'minutes, chrono non mesuré' : duration === durationMin ? 'minutes, par crans de 5' : `minutes · chrono ${durationMin}`}
                value={duration ?? 0}
                min={0}
                max={SESSION_DURATION_MAX_MIN}
                step={5}
                format={(v) => (duration === null ? '·' : String(v))}
                onChange={(v) => setDuration((d) => nudgeDuration(d, v > (d ?? 0) ? 1 : -1))}
                valueWidth={56}
              />
              <div className="flex justify-end border-b border-line px-5">
                {duration !== durationMin ? (
                  <TextLink tone="muted" onClick={() => setDuration(durationMin)}>
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
              meta={durationMin === null ? 'chrono non mesuré' : 'chronométrée'}
              value={duration === null ? <span className="text-[15px] font-normal text-muted">pas notée</span> : fmtDur(duration)}
              action={<IconButton icon="edit" framed label="Corriger la durée" onClick={() => setDurOpen(true)} />}
            />
          )}
          {bpmOn ? (
            <div className="border-b border-line pb-1 pt-3">
              <p className="tnum px-5 text-center text-[32px] font-[650] leading-none tracking-[-0.03em] text-ink" aria-hidden>
                {bpm}
                <span className="ml-1.5 text-[17px] font-medium text-muted">bpm</span>
              </p>
              <div className="mt-2">
                <Ruler
                  label="BPM moyen"
                  steps={bpm - BPM_MIN}
                  max={BPM_MAX - BPM_MIN}
                  pxPerStep={8}
                  isMajor={(s) => (s + BPM_MIN) % 10 === 0}
                  isMid={(s) => (s + BPM_MIN) % 5 === 0}
                  majorLabel={(s) => String(s + BPM_MIN)}
                  format={(s) => `${s + BPM_MIN} battements par minute`}
                  onChange={(s) => setBpm(s + BPM_MIN)}
                />
              </div>
              <div className="flex justify-end px-5">
                <TextLink tone="muted" onClick={() => setBpmOn(false)}>
                  Retirer le BPM moyen
                </TextLink>
              </div>
            </div>
          ) : (
            <MeasureLine
              label="BPM moyen"
              meta="facultatif"
              value={<span className="text-[15px] font-normal text-muted">pas noté</span>}
              action={<IconButton icon="plus" framed label="Ajouter le BPM moyen" onClick={() => setBpmOn(true)} />}
            />
          )}
        </div>
      </section>

      {error && (
        <p role="alert" className="mx-5 mt-4 break-words border-l-[3px] border-ink pl-3 text-[15px] leading-[1.45] text-ink">
          Échec de l’enregistrement : {error}
        </p>
      )}
    </Screen>
  );
}

function exosAside(c: Record<ExerciseStatus, number>): string {
  const parts = [`${c.fait} fait${c.fait > 1 ? 's' : ''}`];
  if (c['en-cours']) parts.push(`${c['en-cours']} en cours`);
  if (c.passe) parts.push(`${c.passe} passé${c.passe > 1 ? 's' : ''}`);
  if (c['pas-fait']) parts.push(`${c['pas-fait']} pas fait${c['pas-fait'] > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

/** Trois chiffres, même grille que l'instrument (22 px, pas de chiffre géant). */
function Figures({ recap }: { recap: SessionRecap }) {
  const records = recap.records.length;
  return (
    <dl className="grid grid-cols-3 gap-3 px-5">
      <div>
        <dt className="text-[13px] text-muted">Séries</dt>
        <dd className="tnum mt-1 text-[22px] font-medium leading-none tracking-[-0.01em] text-ink">{recap.setsLogged}</dd>
        <dd className="mt-1.5 text-[13px]">
          {recap.beaten > 0 ? <Status v="up" word={`${recap.beaten} battue${recap.beaten > 1 ? 's' : ''}`} /> : <span className="text-faint">aucune battue</span>}
        </dd>
      </div>
      <div>
        <dt className="text-[13px] text-muted">kg soulevés</dt>
        <dd className="tnum mt-1 text-[22px] font-medium leading-none tracking-[-0.01em] text-ink">{kg(recap.liftedKg)}</dd>
      </div>
      <div className="text-right">
        <dt className="text-[13px] text-muted">Records</dt>
        {records > 0 ? (
          <>
            <dd className="tnum mt-1 flex items-center justify-end gap-1.5 text-[22px] font-medium leading-none tracking-[-0.01em] text-sig">
              <Sign v="up" size={13} />
              {records}
            </dd>
            <dd className="mt-1.5 text-[13px] text-sig">nouveau{records > 1 ? 'x' : ''}</dd>
          </>
        ) : (
          <dd className="mt-1 text-[16px] text-muted">aucun</dd>
        )}
      </div>
    </dl>
  );
}

function ExoLine({ e, i }: { e: ExerciseRecap; i: number }) {
  const worked = e.status === 'fait' || e.status === 'en-cours';
  const origin = e.origin === 'added' ? 'ajouté' : e.origin === 'swapped' ? 'remplacé' : null;
  const side = e.openSide ? `série ${e.setsDone} : ${e.openSide === 'left' ? 'gauche' : 'droite'} faite` : null;
  return (
    <Row
      lead={i + 1}
      title={e.name}
      muted={!worked}
      meta={
        worked ? (
          <span className="flex flex-wrap items-center gap-x-2">
            <span>
              {plural(e.setsDone, 'série')}
              {e.status === 'en-cours' && ` sur ${e.setsPlanned.min}`}
              {side && `, ${side}`}
            </span>
            {e.beaten > 0 && <Status v="up" word={`${e.beaten} battue${e.beaten > 1 ? 's' : ''}`} />}
            {e.matched > 0 && <Status v="eq" word={`${e.matched} égalée${e.matched > 1 ? 's' : ''}`} />}
            {e.newRecords.map((r) => (
              <Status key={`${r.axis}-${r.side ?? ''}`} v="up" word={`record${r.side ? ` ${sideWord(r.side)}` : ''} ${recordValue(r)}`} />
            ))}
            {origin && <span>· {origin}</span>}
          </span>
        ) : (
          (origin ?? undefined)
        )
      }
      value={
        <StateMark state={STATUS_MARK[e.status]} size={15} className={`text-[15px] ${worked ? 'font-medium text-ink' : 'font-normal text-muted'}`}>
          {STATUS_WORD[e.status]}
        </StateMark>
      }
    />
  );
}

/** Ligne de mesure repliée : libellé, méta, valeur, action à droite. */
function MeasureLine({ label, meta, value, action }: { label: string; meta: string; value: ReactNode; action: ReactNode }) {
  return (
    <div className="flex min-h-16 items-center gap-3 border-b border-line px-5 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-[14px] text-muted">{meta}</span>
      </span>
      <span className="tnum flex-none text-[17px] font-medium text-ink">{value}</span>
      <span className="flex-none">{action}</span>
    </div>
  );
}

// --- Séries par muscle, semaine ----------------------------------------------

/** Un mot, sans signe ni couleur : ▲ ▬ ▼ disent « par rapport à la dernière fois ». */
const FIT: Record<PlanFit, string> = { sous: 'sous le prévu', dans: 'dans le prévu', 'au-dela': 'au-dessus du prévu' };
const fmtPlan = (r: { min: number; max: number }) => (tally(r.min) === tally(r.max) ? tally(r.min) : `${tally(r.min)}-${tally(r.max)}`);

/** Les séances faites plus tôt dans la semaine, regroupées par séance et par
 *  jour : « Upper A (lun.), Lower A (mar., 2 fois) ». */
function seancesLine(seances: { name: string; performedOn: string }[]): string {
  const groups: { name: string; day: string; n: number }[] = [];
  for (const s of seances) {
    const day = weekday(s.performedOn);
    const last = groups[groups.length - 1];
    if (last && last.name === s.name && last.day === day) last.n += 1;
    else groups.push({ name: s.name, day, n: 1 });
  }
  return groups.map((g) => `${g.name} (${g.day}${g.n > 1 ? `, ${g.n} fois` : ''})`).join(', ');
}

function MuscleWeek({ today, week, dateIso }: { today: PerformedExercise[]; week: WeekMusclesInput | null; dateIso: string }) {
  const [all, setAll] = useState(false);
  const rows = useMemo(
    () => weekSetsByMuscle({ before: week?.before ?? [], today, planned: week?.planned?.exercises ?? [] }),
    [today, week],
  );
  const scale = useMemo(() => {
    const top = Math.max(1, ...rows.map((r) => Math.max(r.total, r.planned?.max ?? 0)));
    return Math.ceil(top / 5) * 5;
  }, [rows]);
  if (rows.length === 0) return null;
  const worked = rows.filter((r) => r.today > 0);
  const others = rows.filter((r) => r.today === 0);
  const shown = all ? [...worked, ...others] : worked;

  const seances = week?.seancesBefore ?? [];
  const context =
    week === null
      ? 'Lecture de la semaine…'
      : [
          week.before === null
            ? 'Hors ligne : les séances précédentes de la semaine ne sont pas comptées.'
            : seances.length > 0
              ? `Avant : ${seancesLine(seances)}.`
              : 'Première de la semaine.',
          week.planned === null
            ? 'Prévu de la routine indisponible.'
            : week.routineName !== null
              ? `Prévu : ${week.routineName}, ${plural(week.planned.seanceCount, 'séance')}.`
              : week.planned.seanceCount > 1
                ? `Prévu : les ${week.planned.seanceCount} séances de la routine.`
                : 'Prévu : la séance de la routine.',
          'Sous 5 reps, une série compte en partie.',
        ].join(' ');

  return (
    <section aria-labelledby="fin-muscles">
      <SectionTitle id="fin-muscles" aside={`semaine du ${fmtDay(weekStartIso(dateIso))}`}>
        Séries par muscle
      </SectionTitle>
      <p role="status" className="px-5 text-[14px] leading-[1.45] text-muted">
        {context}
      </p>
      <Legend />
      <ul aria-label="Séries par muscle, semaine" className="border-t border-line">
        {shown.map((r) => (
          <MuscleLine key={r.muscle} r={r} scale={scale} planKnown={week?.planned != null} />
        ))}
      </ul>
      {others.length > 0 && (
        <div className="px-5 pt-1">
          <TextLink tone="muted" onClick={() => setAll((v) => !v)}>
            {all ? 'Seulement les muscles du jour' : others.length > 1 ? `Voir les ${others.length} autres muscles` : 'Voir l’autre muscle'}
          </TextLink>
        </div>
      )}
    </section>
  );
}

function Legend() {
  return (
    <div aria-hidden className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-2 pt-3 text-[13px] text-faint">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-[4px] w-4 bg-ink" />
        aujourd’hui
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-[4px] w-4 bg-muted" />
        plus tôt
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-[10px] w-4 border-x-2 border-b-2 border-faint" />
        prévu
      </span>
    </div>
  );
}

function MuscleLine({ r, scale, planKnown }: { r: WeekMuscleRow; scale: number; planKnown: boolean }) {
  const fit = r.fit ? FIT[r.fit] : null;
  const pct = (v: number) => `${(Math.min(v, scale) / scale) * 100}%`;
  const name = r.muscle.charAt(0).toUpperCase() + r.muscle.slice(1);
  return (
    <li
      className="border-b border-line px-5 py-3"
      aria-label={`${name} : ${tally(r.total)} séries cette semaine, dont ${tally(r.today)} aujourd’hui.${
        r.planned ? ` Prévu ${tally(r.planned.min)} à ${tally(r.planned.max)}, ${fit}.` : planKnown ? ' Hors du prévu de la routine.' : ''
      }`}
    >
      <div aria-hidden className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[16px] font-medium text-ink">{name}</span>
        <span className="flex-none text-[16px] font-medium text-ink">
          <span className="tnum">{tally(r.total)}</span>
          {(r.planned || planKnown) && (
            <span className="ml-1.5 text-[14px] font-normal text-muted">{r.planned ? `prévu ${fmtPlan(r.planned)}` : 'pas au prévu'}</span>
          )}
        </span>
      </div>
      {/* Piste pleine : « plus tôt » en gris, « aujourd'hui » en blanc cassé, le
          prévu en crochet sous la piste. */}
      <div aria-hidden className="relative mt-2 h-[15px]">
        <span className="absolute inset-x-0 top-[3px] h-[6px] bg-line" />
        <span className="absolute left-0 top-[3px] h-[6px] bg-muted" style={{ width: pct(r.before) }} />
        <span className="absolute top-[3px] h-[6px] bg-ink" style={{ left: pct(r.before), width: `calc(${pct(r.total)} - ${pct(r.before)})` }} />
        {r.planned && (
          <span
            className="absolute inset-y-0 border-x-2 border-b-2 border-faint"
            style={{ left: `calc(${pct(r.planned.min)} - 1px)`, width: `calc(${pct(r.planned.max)} - ${pct(r.planned.min)} + 2px)` }}
          />
        )}
      </div>
      <div aria-hidden className="mt-1.5 flex items-baseline justify-between gap-3 text-[13px]">
        {fit ? <span className="text-muted">{fit}</span> : <span className="text-faint">{planKnown ? 'aucune séance du plan ne le travaille' : ''}</span>}
        <span className="tnum text-faint">{r.today > 0 ? `+${tally(r.today)} aujourd’hui` : 'rien aujourd’hui'}</span>
      </div>
    </li>
  );
}

// --- Séance rangée -------------------------------------------------------------

/** Une heure en français : « 18 h 02 ». */
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
};

/** La plage horaire de la séance : « 18 h 02 à 19 h 10 », ou « lancée à 18 h 02 »
 *  quand la durée n'est pas connue ou nulle. */
function timeSpan(startedAt: number, durationMin: number | undefined): string | null {
  if (!Number.isFinite(startedAt)) return null;
  if (!durationMin) return `lancée à ${clock(startedAt)}`;
  return `${clock(startedAt)} à ${clock(startedAt + durationMin * 60_000)}`;
}

/** Où en est la séance rangée : dans le journal, en cours d'envoi, ou gardée sur
 *  l'appareil hors ligne (la Clôture part avec la file, rien à faire). */
function savedLine(sync: { offline: boolean; pending: number }): string {
  const entries = `${sync.pending} saisie${sync.pending > 1 ? 's' : ''}`;
  if (sync.offline) {
    return sync.pending > 0
      ? `Gardée sur cet appareil, avec ${entries} en attente. Tout part au retour du réseau, rien à faire.`
      : 'Gardée sur cet appareil. Elle part au retour du réseau, rien à faire.';
  }
  if (sync.pending > 0) return `${entries} en cours d’envoi.`;
  return 'Elle est dans le journal, avec la durée et le récap.';
}

function SessionDone({
  recap,
  dateIso,
  startedAt,
  values,
  onNewSession,
}: {
  recap: SessionRecap;
  dateIso: string;
  startedAt: number;
  values: SessionEndValues;
  onNewSession: () => void;
}) {
  const sync = useSyncState();
  const span = timeSpan(startedAt, values.durationMin);
  return (
    <Screen bottom={<PrimaryButton onClick={onNewSession}>Nouvelle séance</PrimaryButton>}>
      <ScreenHeader title="Séance rangée" meta={`${recap.sessionName} · ${fmtDay(dateIso)}${span ? `, ${span}` : ''}`} />
      <dl className="border-t border-line">
        {values.durationMin !== undefined && <Fact label="Durée" value={fmtDur(values.durationMin)} />}
        <Fact
          label="Séries"
          value={String(recap.setsLogged)}
          aside={recap.beaten > 0 ? <Status v="up" word={`${recap.beaten} battue${recap.beaten > 1 ? 's' : ''}`} /> : undefined}
        />
        <Fact label="kg soulevés" value={kg(recap.liftedKg)} />
        {typeof values.bpmAvg === 'number' && <Fact label="BPM moyen" value={`${values.bpmAvg} bpm`} />}
        {recap.records.map((r) => (
          <RecordFact key={`${r.exerciseId}-${r.axis}-${r.side ?? ''}`} r={r} />
        ))}
      </dl>
      <p role="status" className="px-5 pt-5 text-[15px] leading-[1.45] text-muted">
        {savedLine(sync)}
      </p>
    </Screen>
  );
}

/** Un nouveau record : le nom de l'exo (et son côté) en entier, sur deux lignes
 *  au besoin, « nouveau record » dessous, la valeur à droite en signal. */
function RecordFact({ r }: { r: RecapRecord }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-line px-5 py-2.5">
      <dt className="min-w-0">
        <span className="block break-words text-[16px] leading-[1.3] text-ink">
          {r.name}
          {r.side ? `, ${sideWord(r.side)}` : ''}
        </span>
        <span className="mt-0.5 block text-[14px]">
          <Status v="up" word="nouveau record" />
        </span>
      </dt>
      <dd className="tnum flex-none text-right text-[16px] font-medium text-sig">{recordValue(r)}</dd>
    </div>
  );
}

function Fact({ label, value, aside }: { label: string; value: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-line px-5 py-2.5">
      <dt className="flex min-w-0 items-center gap-3">
        <span className="truncate text-[16px] text-muted">{label}</span>
        {aside && <span className="flex-none text-[14px]">{aside}</span>}
      </dt>
      <dd className="tnum flex-none text-[16px] font-medium text-ink">{value}</dd>
    </div>
  );
}
