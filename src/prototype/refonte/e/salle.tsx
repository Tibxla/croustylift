// PROTOTYPE JETABLE · socle E, surface Salle (Capture). Reprise de la
// variante E « Signal » : mêmes gestes (règle graduée au pouce, reps et RIR en
// un tap, balayage du nom, index des exos), plus deux corrections :
//
//   a. Le sommaire de la séance (sous-page `sommaire`), à un geste de
//      l'instrument : bouton « Sommaire » à gauche de l'action principale.
//      Chaque exo avec sa prescription et son état ; le toucher rouvre
//      l'instrument dessus. Il porte Ajouter, « Remplacer ou passer » et
//      Terminer la séance (bouton secondaire au-dessus de Reprendre).
//   b. L'enchaînement : dès le minimum de séries du plan atteint, le bloc
//      principal devient « Exo suivant » (prochain exo ni fait ni passé), et
//      « Logger la série n » passe en bouton secondaire juste au-dessus. Quand
//      il ne reste rien : « Terminer la séance ». Avant le seuil, un lien
//      « Exo suivant » permet de passer à la suite sur demande.
//
// Pages : index (instrument, ou choix de la séance si aucune en cours),
// sommaire, fin-de-seance (bouchon dans salle-fin.tsx).
import { useLayoutEffect, useRef, useState } from 'react';
import type { ExercisePlan } from '../fixtures';
import { catalog, MUSCLES, type Muscle, routines } from './fixtures-e';
import {
  fmt1,
  fmtDate,
  fmtKg,
  fmtSigned,
  range,
  refAt,
  setE1rm,
  verdict,
  WORDS,
  type SetValue,
} from './format';
import {
  Choice,
  List,
  NumberRow,
  PrimaryButton,
  Row,
  Ruler,
  Screen,
  ScreenHeader,
  SecondaryButton,
  Sheet,
  Sign,
  Status,
  TextLink,
  TONE,
} from './kit';
import { SalleFin } from './salle-fin';
import { draftOf, nextIndex, progressOf, totalSets, type Progress, type SeanceState } from './seance';
import { Pages, useNav, useProto } from './shell';

export function Salle() {
  const { seance } = useProto();
  return (
    <Pages
      pages={{
        index: () => (seance.state.phase === 'en-cours' ? <Instrument /> : <ChoixSeance />),
        sommaire: () => <Sommaire />,
        'fin-de-seance': () => <SalleFin />,
      }}
    />
  );
}

const REPS = Array.from({ length: 30 }, (_, i) => i + 1);
const RIRS = [0, 1, 2, 3, 4, 5];

function repsWindowStart([lo, hi]: [number, number]): number {
  let start = Math.max(1, lo - 2);
  if (hi > start + 6) start = hi - 6;
  return start;
}

const PROGRESS_WORD: Record<Progress, string> = { todo: 'à faire', partial: 'en cours', done: 'fait', skipped: 'passé' };

/* ------------------------------------------------------------------------ */
/* Instrument                                                                 */
/* ------------------------------------------------------------------------ */

function ExerciseIndex({ state, onPick }: { state: SeanceState; onPick: (i: number) => void }) {
  const n = state.exercises.length;
  // Au-delà de 5 colonnes le mot « passé » ne tient plus : la jauge en pointillés suffit.
  const roomy = n <= 5;
  return (
    <div className="grid px-3" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} role="tablist" aria-label="Exercices de la séance">
      {state.exercises.map((ex, i) => {
        const count = (state.logged[ex.id] ?? []).length;
        const p = progressOf(state, ex);
        const fill = Math.min(1, count / ex.sets[0]);
        const active = i === state.idx;
        return (
          <button
            key={ex.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${i + 1}. ${ex.name}, ${PROGRESS_WORD[p]}`}
            onClick={() => onPick(i)}
            className="flex h-11 min-w-0 flex-col justify-center px-2"
          >
            <span className={`truncate text-left text-[14px] ${active ? 'font-semibold text-(--ink)' : 'text-(--muted)'}`}>
              {i + 1}
              {p === 'skipped' && roomy && <span className="ml-1.5 text-[13px]">passé</span>}
            </span>
            {p === 'skipped' ? (
              <span className="mt-1.5 block h-[3px] w-full border-t-[3px] border-dashed border-(--dim)" />
            ) : (
              <span className="relative mt-1.5 block h-[3px] w-full bg-(--line)">
                <span className={`absolute inset-y-0 left-0 ${active ? 'bg-(--ink)' : 'bg-(--muted)'}`} style={{ width: `${fill * 100}%` }} />
                {active && fill === 0 && <span className="absolute inset-y-0 left-0 w-2 bg-(--ink)" />}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ExerciseHeader({ ex, next, onSwipe }: { ex: ExercisePlan; next: ExercisePlan | null; onSwipe: (dir: 1 | -1) => void }) {
  const g = useRef<{ x: number } | null>(null);
  const [dx, setDx] = useState(0);
  return (
    <div
      className="relative touch-pan-y select-none overflow-hidden px-5 pt-1.5"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        g.current = { x: e.clientX };
      }}
      onPointerMove={(e) => {
        if (g.current) setDx(e.clientX - g.current.x);
      }}
      onPointerUp={() => {
        if (Math.abs(dx) > 56) onSwipe(dx < 0 ? 1 : -1);
        g.current = null;
        setDx(0);
      }}
      onPointerCancel={() => {
        g.current = null;
        setDx(0);
      }}
    >
      <div
        className="flex items-baseline gap-6 whitespace-nowrap"
        style={{ transform: `translateX(${dx * 0.6}px)`, transition: dx === 0 ? 'transform 200ms var(--ease-out-quart)' : 'none' }}
      >
        <h1 className="text-[32px] font-[650] leading-[1.1] tracking-[-0.03em] text-(--ink)">{ex.name}</h1>
        {next && (
          <span aria-hidden className="text-[32px] font-normal leading-[1.1] tracking-[-0.03em] text-(--dim)">
            {next.name}
          </span>
        )}
      </div>
      <p className="mt-1 text-[15px] text-(--muted)">
        {range(ex.sets)} séries · {range(ex.reps)} reps · RIR {range(ex.rir)}
      </p>
    </div>
  );
}

function SetBand({ ex, logged, draft }: { ex: ExercisePlan; logged: SetValue[]; draft: SetValue }) {
  const slots = Math.max(ex.sets[1], logged.length + 1);
  const scroll = slots > 4;
  const band = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    // Au-delà de 4 emplacements la bande défile : la série en cours reste en vue.
    const el = band.current;
    const first = el?.children[Math.max(0, logged.length - 3)] as HTMLElement | undefined;
    if (!el || !first) return;
    el.scrollLeft += first.getBoundingClientRect().left - el.getBoundingClientRect().left - 20;
  }, [logged.length, slots]);
  return (
    <ol ref={band} className={`flex px-5 ${scroll ? 'overflow-x-auto' : ''}`} style={{ scrollbarWidth: 'none' }} aria-label="Séries de cet exo">
      {Array.from({ length: slots }, (_, i) => {
        const rank = i + 1;
        const s = logged[i];
        const isCurrent = i === logged.length;
        const ref = refAt(ex, rank);
        const v = s && ref ? verdict(setE1rm(s), setE1rm(ref)) : null;
        return (
          <li key={rank} className="relative min-w-0 pb-2 pr-2" style={{ flex: scroll ? '0 0 25%' : '1 1 0' }}>
            <div className="flex h-[18px] items-center gap-2 text-[13px]">
              <span className={isCurrent ? 'font-semibold text-(--ink)' : 'text-(--faint)'}>{rank}</span>
              {v && <Status v={v} word={WORDS.set[v]} />}
              {!v && isCurrent && <span className="text-(--muted)">en cours</span>}
              {i >= ex.sets[1] && !v && !isCurrent && <span className="text-(--faint)">en plus</span>}
            </div>
            <div className={`mt-1 truncate text-[16px] font-medium tracking-[-0.01em] ${s ? 'text-(--ink)' : isCurrent ? 'text-(--muted)' : 'text-(--faint)'}`}>
              {s ? `${fmtKg(s.weightKg)}×${s.reps}` : isCurrent ? `${fmtKg(draft.weightKg)}×${draft.reps}` : '·'}
            </div>
            <div className="text-[13px] text-(--faint)">{s ? `RIR ${s.rir}` : isCurrent ? `RIR ${draft.rir}` : ' '}</div>
            <span
              className={`absolute bottom-0 left-0 right-2 ${isCurrent ? 'h-[3px] bg-(--ink)' : s ? 'h-px bg-(--muted)' : 'h-px bg-(--line)'}`}
            />
          </li>
        );
      })}
    </ol>
  );
}

function Instrument() {
  const nav = useNav();
  const { seance, settings, account } = useProto();
  const state = seance.state;
  const { idx, exercises } = state;
  const ex = exercises[idx]!;
  const sets = state.logged[ex.id] ?? [];
  const draft = draftOf(state, ex);
  const rank = sets.length + 1;
  const ref = refAt(ex, rank);
  const e1 = setE1rm(draft);
  const v = ref ? verdict(e1, setE1rm(ref)) : null;
  const todayBest = Math.max(0, ...sets.map(setE1rm));
  const best = Math.max(ex.pr?.e1rm ?? 0, todayBest);
  const bestIsToday = todayBest > (ex.pr?.e1rm ?? 0);
  const isRecord = best > 0 && e1 > best;
  const step = settings.stepKg;
  const kgStr = fmtKg(draft.weightKg);

  const reached = sets.length >= ex.sets[0];
  const nextI = nextIndex(state);
  const nextEx = nextI === null ? null : exercises[nextI]!;
  const logLabel = rank > ex.sets[1] ? 'Logger une de plus' : `Logger la série ${rank}`;
  const logMeta = `${fmtKg(draft.weightKg)} × ${draft.reps}`;
  const logValue = `${logMeta} · RIR ${draft.rir}`;
  const done = exercises.filter((e) => progressOf(state, e) === 'done').length;

  // Le bloc principal change de sens sous le pouce juste après un log : on
  // ignore un second tap trop rapproché pour ne pas sauter d'exo par réflexe.
  const flippedAt = useRef(0);
  const log = () => {
    const willReach = !reached && sets.length + 1 >= ex.sets[0];
    seance.log();
    if (willReach) flippedAt.current = Date.now();
  };
  const finish = () => nav.push('fin-de-seance');
  const goNext = () => {
    if (Date.now() - flippedAt.current < 700) return;
    if (nextI === null) finish();
    else seance.setIdx(nextI);
  };
  const update = (patch: Partial<SetValue>) => seance.setDraft(ex.id, { ...draft, ...patch });

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1">
        <ExerciseIndex state={state} onPick={seance.setIdx} />
        {/* Le fantôme, le balayage vers l'avant et « Exo suivant » désignent le même
            exo : le prochain à faire. Vers l'arrière, le balayage suit l'ordre. */}
        <ExerciseHeader
          ex={ex}
          next={nextEx}
          onSwipe={(d) => {
            if (d === -1) seance.setIdx(idx - 1);
            else if (nextI !== null) seance.setIdx(nextI);
          }}
        />

        <div className="mt-3">
          <SetBand ex={ex} logged={sets} draft={draft} />
        </div>

        <div className="mt-3 flex items-baseline justify-between gap-3 px-5 text-[14px]">
          {ref ? (
            <>
              <span className="text-(--muted)">
                Référence série {rank} · {fmtDate(ex.reference!.date)}
              </span>
              <span className="font-medium text-(--ink)">
                {fmtKg(ref.weightKg)} × {ref.reps} · RIR {ref.rir}
              </span>
            </>
          ) : (
            <span className="text-(--muted)">
              {ex.reference ? `Pas de série ${rank} la dernière fois, rien à battre` : `Pas encore de Référence dans ${state.seanceName}`}
            </span>
          )}
        </div>

        {/* La virgule tombe pile au-dessus de l'aiguille. */}
        <output aria-live="polite" className="mt-0.5 flex items-baseline leading-none">
          <span className="w-1/2 text-right text-[72px] font-[650] tracking-[-0.045em] text-(--ink)">{Math.trunc(draft.weightKg)}</span>
          <span className="w-1/2 whitespace-nowrap text-left">
            <span className="text-[72px] font-[650] tracking-[-0.045em] text-(--ink)">{kgStr.includes(',') ? `,${kgStr.split(',')[1]}` : ''}</span>
            <span className="ml-2 text-[22px] font-medium text-(--muted)">kg</span>
          </span>
        </output>

        <div className="mt-2.5">
          <Ruler
            key={step}
            label="Poids"
            steps={draft.weightKg / step /* fractionnaire si le pas a changé : l'aiguille tombe entre deux crans */}
            max={Math.round(500 / step)}
            pxPerStep={Math.max(8, 11.2 * step) /* un petit pas reste lisible : 8 px minimum entre deux crans */}
            isMajor={(s) => (s * step) % 5 === 0}
            isMid={(s) => (s * step) % 2.5 === 0}
            majorLabel={(s) => fmtKg(s * step)}
            format={(s) => `${fmtKg(s * step)} kg`}
            onChange={(s) => update({ weightKg: s * step })}
            animateTap={settings.rulerTapAnim && !settings.reduceMotion}
          />
        </div>

        <dl className="grid grid-cols-3 gap-3 px-5">
          <div>
            <dt className="text-[13px] text-(--muted)">e1RM</dt>
            <dd className="mt-1 text-[22px] font-medium leading-none tracking-[-0.01em] text-(--ink)">{fmt1(e1)}</dd>
            <dd className="mt-1.5 text-[13px] text-(--faint)">kg</dd>
          </div>
          <div>
            <dt className="text-[13px] text-(--muted)">Écart à la réf.</dt>
            {ref && v ? (
              <>
                <dd className={`mt-1 flex items-center gap-1.5 text-[22px] font-medium leading-none tracking-[-0.01em] ${TONE[v]}`}>
                  <Sign v={v} size={13} />
                  {fmtSigned(Math.round((e1 - setE1rm(ref)) * 10) / 10)}
                </dd>
                <dd className={`mt-1.5 text-[13px] ${TONE[v]}`}>{WORDS.gap[v]}</dd>
              </>
            ) : (
              <dd className="mt-1 text-[16px] text-(--muted)">aucune réf.</dd>
            )}
          </div>
          <div className="text-right">
            <dt className="text-[13px] text-(--muted)">Record</dt>
            {isRecord ? (
              <>
                <dd className="mt-1 flex items-center justify-end gap-1.5 text-[22px] font-medium leading-none tracking-[-0.01em] text-(--sig)">
                  <Sign v="up" size={13} />
                  {fmt1(e1)}
                </dd>
                <dd className="mt-1.5 text-[13px] text-(--sig)">nouveau</dd>
              </>
            ) : best > 0 ? (
              <>
                <dd className="mt-1 text-[22px] font-medium leading-none tracking-[-0.01em] text-(--muted)">{fmt1(best)}</dd>
                <dd className="mt-1.5 text-[13px] text-(--faint)">{bestIsToday || !ex.pr ? 'aujourd’hui' : fmtDate(ex.pr.date)}</dd>
              </>
            ) : (
              <dd className="mt-1 text-[16px] text-(--muted)">aucun</dd>
            )}
          </div>
        </dl>

        <div className="mt-3 flex flex-col gap-1.5">
          <NumberRow
            key={`reps-${ex.id}`}
            label="Reps"
            values={REPS}
            value={draft.reps}
            presc={ex.reps}
            refValue={ref?.reps ?? null}
            onPick={(n) => update({ reps: n })}
            scrollTo={repsWindowStart(ex.reps)}
            perView={7}
          />
          <NumberRow
            key={`rir-${ex.id}`}
            label="RIR"
            values={RIRS}
            value={draft.rir}
            presc={ex.rir}
            refValue={ref?.rir ?? null}
            onPick={(n) => update({ rir: n })}
            perView={6}
          />
        </div>
      </div>

      {/* Zone du pouce. Ligne du haut : les actions de rechange (annuler, l'autre
          choix). Ligne du bas : Sommaire + l'action attendue, toujours au même endroit. */}
      <div className="sticky bottom-0 z-10 mt-2 bg-(--bg) px-5 pb-(--pad-bottom) pt-1">
        {(state.lastLog === ex.id || reached || nextI !== null) && (
          <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
            {state.lastLog === ex.id ? (
              <TextLink tone="muted" onClick={seance.undo}>
                Annuler la série {sets.length}
              </TextLink>
            ) : (
              <span />
            )}
            {reached ? (
              // Sans les valeurs en méta : elles sont juste au-dessus (série en cours),
              // et « Annuler la série n » doit tenir sur la même ligne en entier.
              <SecondaryButton onClick={log} press={false} className="ml-auto min-w-0 flex-1" ariaLabel={`${logLabel}, ${logValue}`}>
                {logLabel}
              </SecondaryButton>
            ) : (
              nextEx && (
                <TextLink tone="muted" onClick={goNext} ariaLabel={`Passer à l'exo suivant, ${nextEx.name}`}>
                  Exo suivant
                </TextLink>
              )
            )}
          </div>
        )}
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => nav.push('sommaire')}
            aria-label={`Sommaire de la séance, ${done} exos faits sur ${exercises.length}${account.offline ? `, hors ligne, ${account.pendingSync} saisies sur l'appareil` : ''}`}
            className="e-press flex h-14 w-[104px] flex-none flex-col items-start justify-center rounded-(--r) border-[1.5px] border-(--ink) bg-(--raise) px-3 text-left active:bg-(--line)"
          >
            <span className="text-[16px] font-medium leading-tight text-(--ink)">Sommaire</span>
            {account.offline || account.pendingSync > 0 ? (
              <span className="whitespace-nowrap text-[13px] font-medium leading-tight text-(--ink)">
                {account.offline ? 'hors ligne' : 'envoi'} · {account.pendingSync}
              </span>
            ) : (
              <span className="text-[13px] leading-tight text-(--muted)">
                {done} sur {exercises.length} faits
              </span>
            )}
          </button>
          {!reached ? (
            <PrimaryButton onClick={log} over={logLabel} ariaLabel={`${logLabel}, ${logValue}`} press={false}>
              {logValue}
            </PrimaryButton>
          ) : nextEx ? (
            <PrimaryButton onClick={goNext} over="Exo suivant" ariaLabel={`Exo suivant · ${nextEx.name}`} press={false}>
              {nextEx.name}
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={finish} press={false}>
              Terminer la séance
            </PrimaryButton>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Sommaire                                                                   */
/* ------------------------------------------------------------------------ */

type CatalogTarget = { mode: 'add' } | { mode: 'replace'; id: string; name: string };

function Sommaire() {
  const nav = useNav();
  const { seance } = useProto();
  const state = seance.state;
  const current = state.exercises[state.idx]!;
  const [target, setTarget] = useState<CatalogTarget | null>(null);
  const remaining = state.exercises.some((e) => {
    const p = progressOf(state, e);
    return p === 'todo' || p === 'partial';
  });
  const open = (i: number) => {
    seance.setIdx(i);
    nav.back();
  };

  return (
    <Screen
      bottom={
        remaining ? (
          <>
            <SecondaryButton onClick={() => nav.push('fin-de-seance')}>Terminer la séance</SecondaryButton>
            <PrimaryButton onClick={nav.back} over="Reprendre" ariaLabel={`Reprendre · ${current.name}`}>
              {current.name}
            </PrimaryButton>
          </>
        ) : (
          <PrimaryButton onClick={() => nav.push('fin-de-seance')}>Terminer la séance</PrimaryButton>
        )
      }
    >
      <ScreenHeader
        title={state.seanceName}
        meta={`${state.routineName} · depuis ${state.startedAt} · ${state.elapsedMin} min · ${totalSets(state)} séries`}
        back={{ label: current.name, onClick: nav.back }}
      />
      <List label="Exercices de la séance">
        {state.exercises.map((ex, i) => {
          const p = progressOf(state, ex);
          const n = (state.logged[ex.id] ?? []).length;
          const beaten = (state.logged[ex.id] ?? []).filter((s, k) => {
            const r = refAt(ex, k + 1);
            return r && setE1rm(s) > setE1rm(r);
          }).length;
          return (
            <Row
              key={ex.id}
              lead={i + 1}
              title={ex.name}
              meta={
                <>
                  <span className="block">
                    {range(ex.sets)} × {range(ex.reps)} · RIR {range(ex.rir)}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2">
                    <span className={p === 'partial' || p === 'done' ? 'font-medium text-(--ink)' : 'text-(--muted)'}>
                      {PROGRESS_WORD[p]}
                      {(p === 'partial' || p === 'done') && ` · ${n} série${n > 1 ? 's' : ''}`}
                    </span>
                    {beaten > 0 && <Status v="up" word={`${beaten} battue${beaten > 1 ? 's' : ''}`} />}
                  </span>
                </>
              }
              current={i === state.idx}
              muted={p === 'skipped'}
              onClick={() => open(i)}
              ariaLabel={`${i + 1}. ${ex.name}, ${PROGRESS_WORD[p]}${n ? `, ${n} séries` : ''}. Ouvrir dans l'instrument`}
              trailing={
                p === 'skipped' ? (
                  // « Remettre », pas « Reprendre » : « Reprendre » est déjà le retour à l'instrument, en bas.
                  <TextLink tone="muted" onClick={() => seance.skip(ex.id)} ariaLabel={`Remettre ${ex.name} dans la séance`} className="-mr-1 px-1 text-[15px]">
                    Remettre
                  </TextLink>
                ) : n === 0 ? (
                  <TextLink
                    tone="muted"
                    onClick={() => setTarget({ mode: 'replace', id: ex.id, name: ex.name })}
                    ariaLabel={`Remplacer ou passer ${ex.name}`}
                    className="-mr-1 px-1 py-1 text-right text-[15px] leading-[1.3]"
                  >
                    {/* Sur deux lignes : sur une seule, le lien écrase le nom de l'exo à 390 px. */}
                    <span>
                      Remplacer
                      <br />
                      ou passer
                    </span>
                  </TextLink>
                ) : undefined
              }
            />
          );
        })}
      </List>
      <div className="px-5 pt-4">
        <SecondaryButton onClick={() => setTarget({ mode: 'add' })} className="w-full">
          Ajouter un exo
        </SecondaryButton>
      </div>
      <CatalogSheet
        key={target ? JSON.stringify(target) : 'ferme'}
        target={target}
        inSession={state.exercises.map((e) => e.id)}
        onClose={() => setTarget(null)}
        onPick={(id) => {
          if (!target) return;
          if (target.mode === 'add') seance.add(id);
          else seance.replace(target.id, id);
          setTarget(null);
        }}
        onSkip={(id) => {
          seance.skip(id);
          setTarget(null);
        }}
      />
    </Screen>
  );
}

/** Catalogue en feuille basse, filtré par muscle (aucun champ de recherche : pas de clavier en salle). */
function CatalogSheet({
  target,
  inSession,
  onClose,
  onPick,
  onSkip,
}: {
  target: CatalogTarget | null;
  inSession: string[];
  onClose: () => void;
  onPick: (catalogId: string) => void;
  onSkip: (id: string) => void;
}) {
  const [muscle, setMuscle] = useState<Muscle | 'tous'>('tous');
  const used = MUSCLES.filter((m) => catalog.some((c) => c.muscles.includes(m)));
  const shown = catalog.filter((c) => muscle === 'tous' || c.muscles.includes(muscle));
  return (
    <Sheet
      open={target !== null}
      title={target?.mode === 'replace' ? `Remplacer ${target.name}` : 'Ajouter un exo'}
      onClose={onClose}
    >
      {target?.mode === 'replace' && (
        <div className="flex items-center justify-between gap-3 border-b border-(--line) px-5 pb-3">
          <span className="text-[14px] text-(--muted)">Ou ne pas le faire aujourd'hui</span>
          <SecondaryButton onClick={() => onSkip(target.id)}>Passer cet exo</SecondaryButton>
        </div>
      )}
      <div className="overflow-x-auto px-3 pt-1" style={{ scrollbarWidth: 'none' }}>
        <Choice
          label="Muscle"
          wrap={false}
          value={muscle}
          onChange={setMuscle}
          options={[{ value: 'tous' as const, label: 'Tous' }, ...used.map((m) => ({ value: m, label: m[0]!.toUpperCase() + m.slice(1) }))]}
        />
      </div>
      <List label="Catalogue">
        {shown.map((c) => {
          const there = inSession.includes(c.id);
          return (
            <Row
              key={c.id}
              title={c.name}
              meta={c.muscles.join(' · ')}
              value={there ? <span className="text-[14px] font-normal text-(--faint)">dans la séance</span> : c.kind === 'perso' ? <span className="text-[14px] font-normal text-(--muted)">perso</span> : undefined}
              muted={there}
              onClick={there ? undefined : () => onPick(c.id)}
            />
          );
        })}
      </List>
    </Sheet>
  );
}

/* ------------------------------------------------------------------------ */
/* Choix de la séance (aucune en cours)                                       */
/* ------------------------------------------------------------------------ */

function ChoixSeance() {
  const { seance } = useProto();
  const routine = routines.find((r) => r.current)!;
  return (
    <Screen>
      <ScreenHeader title="Quelle séance ?" meta={`${routine.name} · routine courante`} />
      <List label="Séances de la routine courante">
        {routine.seances
          .filter((s) => !s.archived)
          .map((s) => (
            <Row
              key={s.id}
              title={s.name}
              meta={`${s.items.length} exos`}
              valueMeta={s.lastDone ? `faite le ${fmtDate(s.lastDone)}` : 'jamais faite'}
              onClick={() => seance.start(s.id)}
            />
          ))}
      </List>
    </Screen>
  );
}
