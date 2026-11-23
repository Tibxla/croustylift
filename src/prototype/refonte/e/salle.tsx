// PROTOTYPE JETABLE · socle E, surface Salle (Capture). Reprise de la
// variante E « Signal » : mêmes gestes (règle graduée au pouce, reps et RIR en
// un tap, balayage du nom, index des exos), plus deux corrections :
//
//   a. Le sommaire de la séance (sous-page `sommaire`), à un geste de
//      l'instrument : bouton « Sommaire » à gauche de l'action principale.
//      Chaque exo avec sa prescription et son état ; le toucher rouvre
//      l'instrument dessus. Il porte Ajouter (+ en tête), les options d'un exo
//      pas commencé (⋯ : feuille « Remplacer · Passer »), « Remettre » sur un exo
//      passé, les marques « ajouté » / « remplacé », « Annuler la séance »
//      (confirmation qui dit ce qui part) et Terminer la séance.
//   d. Notes (icône page, à droite de la ligne sous le nom, sans hauteur en
//      plus) : note du jour, « tu notais », instructions, dans une feuille.
//      Dès le minimum atteint, cette ligne devient le bilan de l'exo.
//   e. Séance d'hier jamais rangée : la Salle demande Ranger ou Reprendre.
//   b. L'enchaînement : dès le minimum de séries du plan atteint, le bloc
//      principal devient « Exo suivant » (prochain exo ni fait ni passé), et
//      « Logger la série n » passe en bouton secondaire juste au-dessus. Quand
//      il ne reste rien : « Terminer la séance ». Avant le seuil, un lien
//      « Exo suivant » permet de passer à la suite sur demande.
//   c. Exo unilatéral (ADR 0005, 0010) : la ligne de Référence devient le
//      sélecteur « Gauche · Droite » (44 px, côté déjà saisi marqué « fait »),
//      avec la Référence de ce côté ; la bande montre chaque série en deux
//      demi-cases G/D ; Écart et Record se lisent par côté. Après un côté,
//      l'instrument passe à l'autre, mêmes valeurs. Seules les séries complètes
//      comptent (jauges, « Exo suivant », Sommaire) ; un seul côté = entamée.
//
// Pages : index (instrument, ou choix de la séance si aucune en cours),
// sommaire, fin-de-seance (bouchon dans salle-fin.tsx).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ExercisePlan } from '../fixtures';
import { catalog, MUSCLES, type Muscle, routines } from './fixtures-e';
import {
  fmt1,
  fmtDate,
  fmtKg,
  fmtSigned,
  range,
  refAt,
  REPS_MAX,
  REPS_MIN,
  RIR_MAX,
  RIR_MIN,
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
import { TextArea } from './exercices-champs';
import { catalogue, useCatalogue } from './fixtures-exercices';
import { IconButton } from './icons';
import {
  activeSide,
  draftOf,
  entryCount,
  exoSummary,
  isUni,
  lastDatedNote,
  nextIndex,
  openSet,
  progressOf,
  SIDE_WORD,
  sidePr,
  sideRef,
  sideRefDate,
  totalSets,
  type ExoSummary,
  type Progress,
  type SeanceState,
  type Side,
  type UniSet,
} from './seance';
import { Pages, useNav, useProto } from './shell';

export function Salle() {
  const { seance } = useProto();
  return (
    <Pages
      pages={{
        index: () => (seance.state.phase !== 'en-cours' ? <ChoixSeance /> : seance.state.stale ? <SeanceHier /> : <Instrument />),
        sommaire: () => <Sommaire />,
        'fin-de-seance': () => <SalleFin />,
      }}
    />
  );
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
        const count = (state.logged[ex.id] ?? []).length + (openSet(state, ex) ? 0.5 : 0);
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

/** Nom de l'exo (balayable) et, dessous, UNE ligne : la prescription, puis le
 *  bilan dès que le minimum de séries est atteint. La ligne garde une marge à
 *  droite pour le bouton Notes, posé HORS de cette zone (elle capture le pointeur). */
function ExerciseHeader({ ex, next, meta, onSwipe }: { ex: ExercisePlan; next: ExercisePlan | null; meta: ReactNode; onSwipe: (dir: 1 | -1) => void }) {
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
      <p className="mt-1 flex h-[22px] items-center gap-2 overflow-hidden whitespace-nowrap pr-12 text-[15px] text-(--muted)">{meta}</p>
    </div>
  );
}

/** Bilan de fin d'exo, une ligne : « fait · 3 séries · ▲ 2 battues · ▲ record ».
 *  Mêmes comptes que le Sommaire et la fin de séance (`exoSummary`). */
function ExoBilan({ sum }: { sum: ExoSummary }) {
  return (
    <>
      <span className="font-medium text-(--ink)">fait · {sum.sets} série{sum.sets > 1 ? 's' : ''}</span>
      {sum.beaten > 0 && <Status v="up" word={`${sum.beaten} battue${sum.beaten > 1 ? 's' : ''}`} />}
      {sum.beaten === 0 && sum.matched > 0 && <Status v="eq" word={`${sum.matched} égalée${sum.matched > 1 ? 's' : ''}`} />}
      {sum.record !== null && <Status v="up" word="record" />}
    </>
  );
}

/** Feuille des notes d'un exo, ouverte par l'icône Notes de l'instrument :
 *  la note du jour (clavier autorisé : c'est de la prose, pas une mesure), le
 *  repère « tu notais » (lecture seule, daté) et la note d'instructions. */
function NotesSheet({ open, onClose, ex }: { open: boolean; onClose: () => void; ex: ExercisePlan }) {
  const { seance } = useProto();
  const state = seance.state;
  const exos = useCatalogue();
  const instr = exos.find((e) => e.id === ex.id)?.note ?? '';
  const prev = lastDatedNote(state, ex.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(instr);
  return (
    <Sheet open={open} title={ex.name} onClose={onClose}>
      <div className="px-5 pb-4">
        <div className="flex items-baseline justify-between gap-3 pb-1.5">
          <span className="text-[15px] font-semibold text-(--ink)">Note du jour</span>
          <span className="text-[14px] text-(--muted)">{fmtDate(state.dateIso)}</span>
        </div>
        <TextArea
          label={`Note du jour, ${ex.name}`}
          value={state.notes[ex.id] ?? ''}
          onChange={(v) => seance.setNote(ex.id, v)}
          placeholder="Sensations, douleur, machine prise"
        />
        {prev && (
          <div className="mt-5">
            <p className="text-[15px] font-semibold text-(--ink)">
              Tu notais <span className="font-normal text-(--muted)">le {fmtDate(prev.date)}</span>
            </p>
            <p className="mt-1 max-w-[40ch] text-[16px] leading-[1.45] text-(--muted)">{prev.body}</p>
          </div>
        )}
        <div className="mt-4 border-t border-(--line) pt-1">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <span className="text-[15px] font-semibold text-(--ink)">Instructions</span>
            {!editing && (
              <IconButton
                icon="edit"
                tone="muted"
                className="-mr-2.5"
                label={instr ? 'Modifier les instructions' : 'Écrire les instructions'}
                onClick={() => {
                  setDraft(instr);
                  setEditing(true);
                }}
              />
            )}
          </div>
          {editing ? (
            <>
              <TextArea label="Instructions" value={draft} onChange={setDraft} placeholder="Réglages de la machine, placement" />
              <div className="mt-3 flex items-center gap-4">
                <SecondaryButton
                  onClick={() => {
                    catalogue.setNote(ex.id, draft);
                    setEditing(false);
                  }}
                >
                  Enregistrer
                </SecondaryButton>
                <TextLink tone="muted" onClick={() => setEditing(false)}>
                  Annuler
                </TextLink>
              </div>
            </>
          ) : instr ? (
            <p className="max-w-[40ch] text-[16px] leading-[1.45] text-(--ink)">{instr}</p>
          ) : (
            <p className="text-[15px] text-(--muted)">Aucune.</p>
          )}
        </div>
      </div>
    </Sheet>
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

const SIDES: Side[] = ['G', 'D'];
const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1);

/** Bande des séries d'un exo unilatéral : chaque série tient sur deux demi-cases
 *  superposées, G puis D, valeurs et signe PAR CÔTÉ (Référence de ce côté, à
 *  cette position). Une ligne de RIR en moins que la bande bilatérale : la
 *  bande reste plus basse, le sélecteur de côté tient sans grandir l'instrument. */
function UniSetBand({ pairs, side, draft, refOf, slotsMin }: { pairs: UniSet[]; side: Side; draft: SetValue; refOf: (rank: number, s: Side) => SetValue | null; slotsMin: number }) {
  const done = pairs.filter((p) => p.G && p.D).length;
  const slots = Math.max(slotsMin, done + 1);
  const scroll = slots > 4;
  const band = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    const el = band.current;
    const first = el?.children[Math.max(0, done - 3)] as HTMLElement | undefined;
    if (!el || !first) return;
    el.scrollLeft += first.getBoundingClientRect().left - el.getBoundingClientRect().left - 20;
  }, [done, slots]);
  return (
    <ol ref={band} className={`flex px-5 ${scroll ? 'overflow-x-auto' : ''}`} style={{ scrollbarWidth: 'none' }} aria-label="Séries de cet exo, gauche et droite">
      {Array.from({ length: slots }, (_, i) => {
        const rank = i + 1;
        const p = pairs[i];
        const isCurrent = i === done;
        const started = !!p && !(p.G && p.D);
        return (
          <li key={rank} className="relative min-w-0 pb-2 pr-2" style={{ flex: scroll ? '0 0 25%' : '1 1 0' }}>
            <div className="flex h-[18px] items-center gap-2 text-[13px]">
              <span className={isCurrent ? 'font-semibold text-(--ink)' : 'text-(--faint)'}>{rank}</span>
              {isCurrent && <span className="text-(--muted)">{started ? 'entamée' : 'en cours'}</span>}
              {i >= slotsMin && !isCurrent && <span className="text-(--faint)">en plus</span>}
            </div>
            {SIDES.map((sd) => {
              const v = p?.[sd] ?? null;
              const r = refOf(rank, sd);
              const verd = v && r ? verdict(setE1rm(v), setE1rm(r)) : null;
              const live = isCurrent && !v && sd === side;
              const txt = v ? `${fmtKg(v.weightKg)}×${v.reps}` : live ? `${fmtKg(draft.weightKg)}×${draft.reps}` : '·';
              return (
                <div key={sd} className="mt-0.5 flex h-[19px] min-w-0 items-center gap-1 whitespace-nowrap">
                  <span className={`w-2.5 flex-none text-[13px] ${live ? 'font-semibold text-(--ink)' : 'text-(--faint)'}`}>{sd}</span>
                  <span className={`truncate text-[14px] font-medium tracking-[-0.01em] ${v ? 'text-(--ink)' : live ? 'text-(--muted)' : 'text-(--faint)'}`}>{txt}</span>
                  {verd && (
                    <span className={TONE[verd]} aria-label={WORDS.set[verd]}>
                      <Sign v={verd} size={10} />
                    </span>
                  )}
                </div>
              );
            })}
            <span className={`absolute bottom-0 left-0 right-2 ${isCurrent ? 'h-[3px] bg-(--ink)' : p ? 'h-px bg-(--muted)' : 'h-px bg-(--line)'}`} />
          </li>
        );
      })}
    </ol>
  );
}

/** Sélecteur de côté, en mots, au pouce : le côté actif net (souligné épais),
 *  le côté déjà saisi pour cette série marqué « fait » et éteint. À droite, la
 *  Référence de CE côté à cette position. Il remplace la ligne de Référence de
 *  l'exo bilatéral, sur une seule rangée de 44 px. */
function SideRow({
  side,
  open,
  rank,
  refV,
  refDate,
  onSide,
}: {
  side: Side;
  open: UniSet | null;
  rank: number;
  refV: SetValue | null;
  refDate: string | null;
  onSide: (s: Side) => void;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2 px-5">
      <div role="radiogroup" aria-label="Côté" className="-ml-2.5 flex flex-none">
        {SIDES.map((sd) => {
          const sel = sd === side;
          const done = !!open?.[sd];
          return (
            <button
              key={sd}
              type="button"
              role="radio"
              aria-checked={sel}
              disabled={done}
              aria-label={done ? `${cap(SIDE_WORD[sd])}, saisi pour la série ${rank}` : cap(SIDE_WORD[sd])}
              onClick={() => onSide(sd)}
              className={`h-11 flex-none px-2.5 text-[17px] ${
                sel ? 'font-semibold text-(--ink) underline decoration-[3px] underline-offset-[8px]' : done ? 'text-(--faint)' : 'text-(--muted) active:text-(--ink)'
              }`}
            >
              {cap(SIDE_WORD[sd])}
              {done && <span className="ml-1 text-[13px] text-(--faint)">fait</span>}
            </button>
          );
        })}
      </div>
      <div className="min-w-0 text-right leading-tight">
        {refV ? (
          <>
            <span className="block truncate text-[13px] text-(--muted)">
              réf. série {rank} · {fmtDate(refDate!)}
            </span>
            <span className="block whitespace-nowrap text-[14px] font-medium text-(--ink)">
              {fmtKg(refV.weightKg)} × {refV.reps} · RIR {refV.rir}
            </span>
          </>
        ) : (
          <span className="text-[14px] text-(--muted)">{refDate ? 'rien à battre' : 'aucune réf.'}</span>
        )}
      </div>
    </div>
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
  // Unilatéral : tout se lit PAR CÔTÉ (Référence, écart, Record) ; ADR 0010.
  const uni = isUni(state, ex);
  const pairs = uni ? (state.uni[ex.id] ?? []) : [];
  const side = activeSide(state, ex);
  const open = uni ? openSet(state, ex) : null;
  const ref = uni ? sideRef(state, ex, rank, side) : refAt(ex, rank);
  const e1 = setE1rm(draft);
  const v = ref ? verdict(e1, setE1rm(ref)) : null;
  const todayBest = uni
    ? Math.max(0, ...pairs.flatMap((p) => (p[side] ? [setE1rm(p[side]!)] : [])))
    : Math.max(0, ...sets.map(setE1rm));
  const pr = uni ? sidePr(ex, side) : ex.pr;
  const best = Math.max(pr?.e1rm ?? 0, todayBest);
  const bestIsToday = todayBest > (pr?.e1rm ?? 0);
  const isRecord = best > 0 && e1 > best;
  const step = settings.stepKg;
  const kgStr = fmtKg(draft.weightKg);

  const reached = sets.length >= ex.sets[0];
  const nextI = nextIndex(state);
  const nextEx = nextI === null ? null : exercises[nextI]!;
  // Unilatéral : toujours le numéro de série (la bande le montre, « une de plus »
  // ne tiendrait pas à côté de « Annuler »).
  const logLabel = uni
    ? `Logger ${SIDE_WORD[side]} · série ${rank}`
    : rank > ex.sets[1]
      ? 'Logger une de plus'
      : `Logger la série ${rank}`;
  // Dernier côté saisi (pour « Annuler ») : le second d'une paire complète, sinon le seul.
  const lastPair = pairs[pairs.length - 1];
  const lastSide: Side | null = !lastPair ? null : lastPair.G && lastPair.D ? (lastPair.first === 'G' ? 'D' : 'G') : lastPair.G ? 'G' : 'D';
  // Unilatéral : le côté suffit (c'est toujours la dernière saisie, visible dans la bande).
  const undoLabel = uni && lastSide ? `Annuler ${SIDE_WORD[lastSide]}` : `Annuler la série ${sets.length}`;
  const logMeta = `${fmtKg(draft.weightKg)} × ${draft.reps}`;
  const logValue = `${logMeta} · RIR ${draft.rir}`;
  const done = exercises.filter((e) => progressOf(state, e) === 'done').length;
  const [notesOpen, setNotesOpen] = useState(false);
  const instrNote = useCatalogue().find((e) => e.id === ex.id)?.note ?? '';
  const hasNote = !!instrNote.trim() || !!state.notes[ex.id]?.trim() || !!lastDatedNote(state, ex.id);

  // Le bloc principal change de sens sous le pouce juste après un log : on
  // ignore un second tap trop rapproché pour ne pas sauter d'exo par réflexe.
  const flippedAt = useRef(0);
  const log = () => {
    // Unilatéral : seul le second côté complète la série.
    const willReach = !reached && sets.length + 1 >= ex.sets[0] && (!uni || !!open);
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
        <div className="relative">
          <ExerciseHeader
            ex={ex}
            next={nextEx}
            meta={reached ? <ExoBilan sum={exoSummary(state, ex)} /> : `${range(ex.sets)} séries · ${range(ex.reps)} reps · RIR ${range(ex.rir)}`}
            onSwipe={(d) => {
              if (d === -1) seance.setIdx(idx - 1);
              else if (nextI !== null) seance.setIdx(nextI);
            }}
          />
          {/* Notes : hors de la zone de balayage, centré sur la ligne de méta, sans
              hauteur en plus. Le carré dit qu'il y a déjà quelque chose à lire. */}
          <div className="absolute bottom-[-11px] right-2.5">
            <IconButton
              icon="note"
              tone="muted"
              dot={hasNote}
              label={`Notes de ${ex.name}${hasNote ? ', une note à lire' : ''}`}
              onClick={() => setNotesOpen(true)}
            />
          </div>
        </div>
        <NotesSheet key={ex.id} open={notesOpen} onClose={() => setNotesOpen(false)} ex={ex} />

        {uni ? (
          <>
            <div className="mt-1">
              <UniSetBand pairs={pairs} side={side} draft={draft} refOf={(r, sd) => sideRef(state, ex, r, sd)} slotsMin={ex.sets[1]} />
            </div>
            <SideRow side={side} open={open} rank={rank} refV={ref} refDate={sideRefDate(state, ex)} onSide={(sd) => seance.setSide(ex.id, sd)} />
          </>
        ) : (
          <>
        <div className="mt-3">
          <SetBand ex={ex} logged={sets} draft={draft} />
        </div>

        <div className="mt-3 flex items-baseline justify-between gap-3 px-5 text-[14px]">
          {ref ? (
            <>
              <span className="text-(--muted)">
                réf. série {rank} · {fmtDate(ex.reference!.date)}
              </span>
              <span className="font-medium text-(--ink)">
                {fmtKg(ref.weightKg)} × {ref.reps} · RIR {ref.rir}
              </span>
            </>
          ) : (
            <span className="text-(--muted)">
              {ex.reference ? `Série ${rank} : rien à battre` : `Pas encore de réf. dans ${state.seanceName}`}
            </span>
          )}
        </div>
          </>
        )}

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
            <dt className="text-[13px] text-(--muted)">{uni ? `Record ${SIDE_WORD[side]}` : 'Record'}</dt>
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
                <dd className="mt-1.5 text-[13px] text-(--faint)">{bestIsToday || !pr ? 'aujourd’hui' : fmtDate(pr.date)}</dd>
              </>
            ) : (
              <dd className="mt-1 text-[16px] text-(--muted)">aucun</dd>
            )}
          </div>
        </dl>

        <div className="mt-3 flex flex-col gap-1.5">
          {/* Remontées à chaque exo et à chaque série : elles repartent calées. */}
          <NumberRow
            key={`reps-${ex.id}-${rank}${uni ? side : ''}`}
            label="Reps"
            min={REPS_MIN}
            max={REPS_MAX}
            value={draft.reps}
            presc={ex.reps}
            refValue={ref?.reps ?? null}
            onPick={(n) => update({ reps: n })}
          />
          <NumberRow
            key={`rir-${ex.id}-${rank}${uni ? side : ''}`}
            label="RIR"
            min={RIR_MIN}
            max={RIR_MAX}
            value={draft.rir}
            presc={ex.rir}
            refValue={ref?.rir ?? null}
            onPick={(n) => update({ rir: n })}
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
                {undoLabel}
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** Marque de déviation au plan, sobre : un mot (« ajouté », « remplacé »). */
function originWord(state: SeanceState, id: string): string | null {
  return state.origin[id]?.kind ?? null;
}

/** Méta d'une ligne du Sommaire, UNE ligne : la prescription tant que rien n'est
 *  fait, sinon l'état et le bilan (la prescription se relit dans l'instrument). */
function SommaireMeta({ state, ex }: { state: SeanceState; ex: ExercisePlan }) {
  const p = progressOf(state, ex);
  const sum = exoSummary(state, ex);
  const started = openSet(state, ex);
  const origin = originWord(state, ex.id);
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      <span className={p === 'partial' || p === 'done' ? 'font-medium text-(--ink)' : 'text-(--muted)'}>
        {p === 'todo' && `${range(ex.sets)} × ${range(ex.reps)} · RIR ${range(ex.rir)}`}
        {p === 'skipped' && 'passé'}
        {p === 'partial' && `en cours · ${sum.sets} sur ${range(ex.sets)}${started ? `, série ${sum.sets + 1} entamée` : ''}`}
        {p === 'done' && `fait · ${plural(sum.sets, 'série')}`}
        {origin && <span className="font-normal text-(--muted)"> · {origin}</span>}
      </span>
      {sum.beaten > 0 && <Status v="up" word={`${sum.beaten} battue${sum.beaten > 1 ? 's' : ''}`} />}
    </span>
  );
}

/** Ce qu'« Annuler la séance » fait perdre, accordé : « 1 série sera perdue »,
 *  « 1 côté saisi et tes notes du jour seront perdus ». */
function lossText(total: number, entries: number, notes: boolean): string {
  const what = total > 0 ? plural(total, 'série') : entries > 0 ? `${plural(entries, 'côté')} saisi${entries > 1 ? 's' : ''}` : null;
  const fem = total > 0 || !what;
  const many = (what !== null && notes) || total > 1 || (total === 0 && entries > 1) || (!what && notes);
  const subject = [what, notes ? 'tes notes du jour' : null].filter(Boolean).join(' et ');
  return `${subject[0]!.toUpperCase()}${subject.slice(1)} ${many ? 'seront' : 'sera'} perdu${fem ? 'e' : ''}${many ? 's' : ''}.`;
}

function Sommaire() {
  const nav = useNav();
  const { seance, account, setAccount } = useProto();
  const state = seance.state;
  const current = state.exercises[state.idx]!;
  const [target, setTarget] = useState<CatalogTarget | null>(null);
  const [options, setOptions] = useState<ExercisePlan | null>(null);
  const [cancelAsk, setCancelAsk] = useState(false);
  const remaining = state.exercises.some((e) => {
    const p = progressOf(state, e);
    return p === 'todo' || p === 'partial';
  });
  const open = (i: number) => {
    seance.setIdx(i);
    nav.back();
  };
  const total = totalSets(state);
  const entries = entryCount(state);
  const hasNotes = Object.values(state.notes).some((b) => b.trim());
  const cancel = () => {
    // Les saisies de cette séance quittent la file d'envoi ; rien n'entre au journal.
    if (account.pendingSync > 0) setAccount({ pendingSync: Math.max(0, account.pendingSync - entries) });
    seance.cancel();
    setCancelAsk(false);
    nav.reset();
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
        meta={`${state.routineName} · ${state.elapsedMin} min · ${plural(total, 'série')}`}
        back={{ label: current.name, onClick: nav.back }}
        action={<IconButton icon="plus" framed label="Ajouter un exo" onClick={() => setTarget({ mode: 'add' })} />}
      />
      <List label="Exercices de la séance">
        {state.exercises.map((ex, i) => {
          const p = progressOf(state, ex);
          const n = (state.logged[ex.id] ?? []).length;
          const started = openSet(state, ex);
          const origin = originWord(state, ex.id);
          return (
            <Row
              key={ex.id}
              lead={i + 1}
              title={ex.name}
              meta={<SommaireMeta state={state} ex={ex} />}
              current={i === state.idx}
              muted={p === 'skipped'}
              onClick={() => open(i)}
              ariaLabel={`${i + 1}. ${ex.name}, ${PROGRESS_WORD[p]}${n ? `, ${n} séries` : ''}${started ? `, série ${n + 1} entamée` : ''}${origin ? `, ${origin}` : ''}. Ouvrir dans l'instrument`}
              trailing={
                p === 'skipped' ? (
                  // « Remettre », pas « Reprendre » : « Reprendre » est déjà le retour à l'instrument, en bas.
                  <TextLink tone="muted" onClick={() => seance.skip(ex.id)} ariaLabel={`Remettre ${ex.name} dans la séance`} className="-mr-1 px-1 text-[15px]">
                    Remettre
                  </TextLink>
                ) : n === 0 && !started ? (
                  <IconButton icon="more" tone="muted" label={`Remplacer ou passer ${ex.name}`} onClick={() => setOptions(ex)} className="-mr-2.5" />
                ) : undefined
              }
            />
          );
        })}
      </List>
      <div className="px-5 pt-5">
        <TextLink tone="muted" onClick={() => (entries === 0 && !hasNotes ? cancel() : setCancelAsk(true))}>
          Annuler la séance
        </TextLink>
      </div>

      <Sheet open={options !== null} title={options?.name ?? ''} onClose={() => setOptions(null)}>
        <div className="flex gap-2 px-5 pb-1 pt-2">
          <SecondaryButton
            className="flex-1"
            ariaLabel={`Remplacer ${options?.name ?? ''}`}
            onClick={() => {
              const ex = options!;
              setOptions(null);
              setTarget({ mode: 'replace', id: ex.id, name: ex.name });
            }}
          >
            Remplacer
          </SecondaryButton>
          <SecondaryButton
            className="flex-1"
            ariaLabel={`Passer ${options?.name ?? ''}`}
            onClick={() => {
              seance.skip(options!.id);
              setOptions(null);
            }}
          >
            Passer
          </SecondaryButton>
        </div>
      </Sheet>

      <Sheet open={cancelAsk} title="Annuler la séance ?" onClose={() => setCancelAsk(false)}>
        <div className="px-5 pb-2 pt-1">
          <p className="max-w-[36ch] text-[16px] leading-[1.45] text-(--ink)">
            {lossText(total, entries, hasNotes)} Rien n’entre au journal.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4">
            <SecondaryButton onClick={() => setCancelAsk(false)}>Garder la séance</SecondaryButton>
            <TextLink tone="muted" onClick={cancel}>
              Annuler la séance
            </TextLink>
          </div>
        </div>
      </Sheet>

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
}: {
  target: CatalogTarget | null;
  inSession: string[];
  onClose: () => void;
  onPick: (catalogId: string) => void;
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
              meta={`${c.muscles.join(' · ')}${c.unilateral ? ' · unilatéral' : ''}`}
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
/* Séance d'hier non rangée (frontière minuit)                                */
/* ------------------------------------------------------------------------ */

/** Ouverture de la Salle après minuit sur une séance commencée la veille et
 *  jamais rangée. Le plus probable : elle est finie et on l'a oubliée, d'où
 *  « Ranger » en bloc principal (vers la fin de séance, à sa date d'hier).
 *  « Reprendre » la rouvre telle quelle (séance qui passe minuit). Sans aucune
 *  série, rien à ranger : on la quitte. */
function SeanceHier() {
  const nav = useNav();
  const { seance } = useProto();
  const s = seance.state;
  const total = totalSets(s);
  const done = s.exercises.filter((e) => progressOf(s, e) === 'done').length;
  return (
    <Screen
      bottom={
        <>
          <SecondaryButton onClick={seance.resume} ariaLabel={`Reprendre la séance d’hier, ${s.seanceName}`}>
            Reprendre
          </SecondaryButton>
          {total > 0 ? (
            <PrimaryButton onClick={() => nav.push('fin-de-seance')} meta={`${total} série${total > 1 ? 's' : ''}`}>
              Ranger la séance
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={seance.cancel}>Quitter la séance</PrimaryButton>
          )}
        </>
      }
    >
      <div className="pt-3" />
      <ScreenHeader title="Pas rangée hier" meta={`${s.seanceName} · ${s.routineName} · ${fmtDate(s.dateIso)}, lancée à ${s.startedAt}`} />
      <dl className="border-t border-(--line)">
        <div className="flex min-h-12 items-center justify-between gap-4 border-b border-(--line) px-5 py-2.5">
          <dt className="text-[16px] text-(--muted)">Exos faits</dt>
          <dd className="text-[16px] font-medium text-(--ink)">
            {done} sur {s.exercises.length}
          </dd>
        </div>
      </dl>
      <p className="px-5 pt-4 text-[15px] leading-[1.45] text-(--muted)">Rangée ou reprise, elle garde sa date : {fmtDate(s.dateIso)}</p>
    </Screen>
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
