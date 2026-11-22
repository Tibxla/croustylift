// PROTOTYPE JETABLE · variante C « Signal ».
//
// Idée : monochrome chaud (noir, blanc cassé, gris) et UNE couleur de signal,
// le jaune de signalisation, qui n'a qu'un sens dans toute l'app : « mieux que
// la dernière fois ». Il ne s'allume que sur une série battue, une pente qui
// monte. L'action principale est blanc cassé, pas jaune : l'écran ne devient
// jaune que quand tu progresses.
//
// Salle : une série = un plein écran. La Référence du rang en cours s'affiche
// en très grand, « Refaire » la logge telle quelle (l'app n'invente pas de
// cible), « Ajuster » ouvre un réglage en place, sans clavier OS. Le verdict
// tombe en bandeau pleine largeur juste après le log.
// Analyse : petits multiples nus, même échelle relative pour tous les exos.
//
// Contrastes (script contrast.mjs, WCAG) : signal/fond 13,0:1 · encre sur
// signal 12,5:1 · encre/fond 16,9:1 · gris/fond 9,0:1 · gris discret/fond 5,7:1.
import { useState, type CSSProperties, type ReactNode } from "react";
import {
  e1rm,
  range,
  type ExercisePlan,
  type LoggedSet,
  type SessionFixture,
} from "./fixtures";

export const name = "Signal";

// --- Palette ---------------------------------------------------------------
const PALETTE = {
  "--c-bg": "#100e0c", // noir chaud
  "--c-raise": "#1c1916", // palier +1 (zones de réglage)
  "--c-line": "#3a3733", // filets 1px
  "--c-ink": "#f4f0e7", // blanc cassé
  "--c-muted": "#b5b0a9", // gris secondaire (9:1)
  "--c-faint": "#8f8c85", // gris discret (5,7:1)
  "--c-sig": "#f6d236", // jaune de signalisation : « mieux que la dernière fois »
  "--c-on-sig": "#171309",
} as CSSProperties;

const FONT = '"Inter Variable", "Geist Variable", system-ui, sans-serif';

// --- Formatage ---------------------------------------------------------------
/** Poids à la française, jusqu'à deux décimales (78,75 ; 82,5 ; 80). */
function w(n: number): string {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}
function pct(n: number, digits = 1): string {
  const s = Math.abs(n).toFixed(digits).replace(".", ",");
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${s}`;
}
const MONTHS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];
function day(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

// --- Verdict -----------------------------------------------------------------
type Verdict = "beaten" | "matched" | "below";
type SetValues = { weightKg: number; reps: number; rir: number };

/** Même règle que l'app : comparaison des e1RM au même rang. */
function verdictOf(set: SetValues, ref: SetValues): Verdict {
  const a = e1rm(set.weightKg, set.reps, set.rir);
  const b = e1rm(ref.weightKg, ref.reps, ref.rir);
  return a > b ? "beaten" : a === b ? "matched" : "below";
}
const VERDICT_WORD: Record<Verdict, string> = {
  beaten: "Battu",
  matched: "Égalé",
  below: "En deçà",
};

/** ▲ ▬ ▼ dessinés en SVG (les glyphes manquent ou varient selon la police). */
function Sign({ kind, size = 14 }: { kind: Verdict; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      aria-hidden
      fill="currentColor"
      className="shrink-0"
    >
      {kind === "beaten" && <path d="M6 1.5 11 10.5H1z" />}
      {kind === "matched" && <rect x="1" y="4" width="10" height="4" />}
      {kind === "below" && <path d="M6 10.5 1 1.5h10z" />}
    </svg>
  );
}
/** Couleur d'un verdict : seul « battu » prend le signal. */
const VERDICT_COLOR: Record<Verdict, string> = {
  beaten: "text-(--c-sig)",
  matched: "text-(--c-ink)",
  below: "text-(--c-muted)",
};

// --- Racine -------------------------------------------------------------------
type Screen = "salle" | "analyse";

export function VariantC({ session }: { session: SessionFixture }) {
  const [screen, setScreen] = useState<Screen>("salle");
  return (
    <div
      className="flex min-h-full flex-1 flex-col bg-(--c-bg) text-(--c-ink) antialiased"
      style={{ ...PALETTE, fontFamily: FONT }}
    >
      <Masthead screen={screen} onScreen={setScreen} session={session} />
      {screen === "salle" ? (
        <Salle session={session} />
      ) : (
        <Analyse session={session} />
      )}
    </div>
  );
}

/** Navigation : deux mots, pas d'onglets à icônes. Le mot actif est souligné. */
function Masthead({
  screen,
  onScreen,
  session,
}: {
  screen: Screen;
  onScreen: (s: Screen) => void;
  session: SessionFixture;
}) {
  const tab = (key: Screen, label: string) => (
    <button
      type="button"
      onClick={() => onScreen(key)}
      aria-current={screen === key ? "page" : undefined}
      className={`h-12 pr-5 text-[19px] tracking-[-0.01em] ${
        screen === key
          ? "font-semibold text-(--c-ink) underline decoration-2 underline-offset-[7px]"
          : "font-normal text-(--c-faint)"
      }`}
    >
      {label}
    </button>
  );
  return (
    <header className="flex items-center justify-between px-5 pt-2">
      <nav className="flex" aria-label="Surfaces">
        {tab("salle", "Salle")}
        {tab("analyse", "Analyse")}
      </nav>
      <p className="text-[15px] tabular-nums text-(--c-muted)">
        {screen === "salle"
          ? `${session.seanceName} · ${session.elapsedMin} min`
          : session.routineName}
      </p>
    </header>
  );
}

// --- Salle --------------------------------------------------------------------
type Mode = "serie" | "liste" | "ajuster";
interface Fresh {
  exId: string;
  order: number;
  set: SetValues;
  ref: SetValues | null;
  verdict: Verdict | null;
  refDate: string | null;
}

function Salle({ session }: { session: SessionFixture }) {
  const [currentId, setCurrentId] = useState(
    session.exercises.find((e) => e.status === "in-progress")?.id ??
      session.exercises[0]!.id,
  );
  const [logged, setLogged] = useState<Record<string, LoggedSet[]>>(() =>
    Object.fromEntries(session.exercises.map((e) => [e.id, e.loggedToday])),
  );
  const [mode, setMode] = useState<Mode>("serie");
  const [fresh, setFresh] = useState<Fresh | null>(null);

  const ex = session.exercises.find((e) => e.id === currentId)!;
  const sets = logged[ex.id] ?? [];
  const order = sets.length + 1;
  const ref = ex.reference?.sets[order - 1] ?? null;
  const full = sets.length >= ex.sets[1];
  // Exo suivant : le premier encore à faire, pas l'index + 1.
  const next =
    session.exercises.find(
      (e) =>
        e.id !== ex.id &&
        e.status === "todo" &&
        (logged[e.id]?.length ?? 0) === 0,
    ) ?? null;

  const log = (v: SetValues) => {
    const verdict = ref ? verdictOf(v, ref) : null;
    setLogged((m) => ({
      ...m,
      [ex.id]: [...sets, { order, ...v, vsReference: verdict ?? "none" }],
    }));
    setFresh({
      exId: ex.id,
      order,
      set: v,
      ref,
      verdict,
      refDate: ex.reference?.date ?? null,
    });
    setMode("serie");
  };
  const undo = () => {
    if (!fresh) return;
    setLogged((m) => ({
      ...m,
      [fresh.exId]: (m[fresh.exId] ?? []).slice(0, -1),
    }));
    setFresh(null);
  };
  const goTo = (id: string) => {
    setCurrentId(id);
    setFresh(null);
    setMode("serie");
  };

  if (mode === "liste") {
    return (
      <ExerciseList
        session={session}
        logged={logged}
        currentId={ex.id}
        onPick={goTo}
        onClose={() => setMode("serie")}
      />
    );
  }

  const position = session.exercises.findIndex((e) => e.id === ex.id) + 1;
  const seed: SetValues = ref ??
    sets[sets.length - 1] ??
    ex.reference?.sets.at(-1) ?? {
      weightKg: 10,
      reps: ex.reps[0],
      rir: ex.rir[1],
    };

  return (
    <main className="flex flex-1 flex-col">
      {/* En-tête d'exo : le nom est roi, la prescription en dessous. */}
      <section className="px-5 pt-4">
        <div className="flex items-center justify-between">
          <p className="text-[15px] tabular-nums text-(--c-muted)">
            Exo {position} sur {session.exercises.length}
          </p>
          <button
            type="button"
            onClick={() => setMode("liste")}
            className="-mr-2 h-11 px-2 text-[15px] font-medium text-(--c-ink) underline decoration-(--c-faint) decoration-1 underline-offset-4"
          >
            Tous les exos
          </button>
        </div>
        <h1 className="text-[36px] leading-[1.02] font-[650] tracking-[-0.03em]">
          {ex.name}
        </h1>
        <p className="mt-2 text-[15px] tabular-nums text-(--c-muted)">
          {range(ex.sets)} séries · {range(ex.reps)} reps · RIR {range(ex.rir)}
        </p>
      </section>

      {mode !== "ajuster" && <Ledger ex={ex} sets={sets} order={order} />}

      {mode !== "ajuster" && fresh && fresh.exId === ex.id && (
        <ResultBand fresh={fresh} onUndo={undo} />
      )}

      {mode === "ajuster" ? (
        <Adjust
          key={`${ex.id}-${order}`}
          order={order}
          seed={seed}
          refSet={ref}
          onCancel={() => setMode("serie")}
          onLog={log}
        />
      ) : (
        <>
          <Reference
            ex={ex}
            order={order}
            refSet={ref}
            full={full}
            sets={sets}
          />
          <ActionBar
            refSet={ref}
            full={full}
            order={order}
            next={next}
            onRedo={() => ref && log(ref)}
            onAdjust={() => setMode("ajuster")}
            onNext={() => next && goTo(next.id)}
          />
        </>
      )}
    </main>
  );
}

/** Registre des séries du jour : une colonne par rang prévu, sans boîtes. */
function Ledger({
  ex,
  sets,
  order,
}: {
  ex: ExercisePlan;
  sets: LoggedSet[];
  order: number;
}) {
  const cols = Math.max(ex.sets[1], sets.length);
  return (
    <ol
      className="mt-4 grid border-t border-(--c-line)"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: cols }, (_, i) => {
        const s = sets[i];
        const isCurrent = i + 1 === order;
        const optional = i + 1 > ex.sets[0];
        return (
          <li
            key={i}
            className={`-mt-px border-t-[3px] pt-2.5 pb-3 pr-2 pl-3 first:pl-5 ${
              isCurrent ? "border-(--c-ink)" : "border-transparent"
            }`}
          >
            <p
              className={`text-[13px] ${isCurrent ? "font-semibold text-(--c-ink)" : "text-(--c-muted)"}`}
            >
              Série {i + 1}
            </p>
            {s ? (
              <>
                <p className="mt-0.5 text-[17px] font-medium tabular-nums">
                  {w(s.weightKg)}×{s.reps}
                </p>
                {s.vsReference === "none" ? (
                  <p className="text-[13px] text-(--c-muted)">sans Réf.</p>
                ) : (
                  <p
                    className={`flex items-center gap-1 text-[13px] whitespace-nowrap ${VERDICT_COLOR[s.vsReference]}`}
                  >
                    <Sign kind={s.vsReference} size={10} />
                    {VERDICT_WORD[s.vsReference].toLowerCase()}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-0.5 text-[15px] text-(--c-faint)">
                {isCurrent ? "maintenant" : optional ? "si besoin" : "à venir"}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Verdict juste après le log : bandeau pleine largeur, signe + mot. Jaune seulement si battu. */
function ResultBand({ fresh, onUndo }: { fresh: Fresh; onUndo: () => void }) {
  const v = fresh.verdict;
  const tone =
    v === "beaten"
      ? "bg-(--c-sig) text-(--c-on-sig)"
      : "bg-(--c-raise) text-(--c-ink) border-y border-(--c-line)";
  const detail = fresh.ref
    ? v === "matched"
      ? `pareil que le ${day(fresh.refDate!)}`
      : `le ${day(fresh.refDate!)} : ${w(fresh.ref.weightKg)} × ${fresh.ref.reps} · RIR ${fresh.ref.rir}`
    : "pas de Référence à ce rang";
  return (
    <section
      className={`flex items-center gap-4 px-5 py-4 ${tone}`}
      aria-live="polite"
    >
      <div className="min-w-0 flex-1">
        <p className={`flex items-center gap-2.5 text-[30px] leading-none font-bold tracking-[-0.02em] ${v === "below" ? "text-(--c-muted)" : ""}`}>
          {v && <Sign kind={v} size={22} />}
          {v ? VERDICT_WORD[v] : "Notée"}
        </p>
        <p className="mt-2 text-[15px] font-medium tabular-nums">
          Série {fresh.order} · {w(fresh.set.weightKg)} × {fresh.set.reps} · RIR{" "}
          {fresh.set.rir}
        </p>
        <p
          className={`text-[15px] tabular-nums ${v === "beaten" ? "" : "text-(--c-muted)"}`}
        >
          {detail}
        </p>
      </div>
      <button
        type="button"
        onClick={onUndo}
        className="h-11 shrink-0 px-1 text-[15px] font-medium underline decoration-1 underline-offset-4"
      >
        Annuler
      </button>
    </section>
  );
}

/** La Référence du rang en cours, en très grand. Sans Référence, on le dit. */
function Reference({
  ex,
  order,
  refSet,
  full,
  sets,
}: {
  ex: ExercisePlan;
  order: number;
  refSet: SetValues | null;
  full: boolean;
  sets: LoggedSet[];
}) {
  if (full) {
    return (
      <section className="flex flex-1 flex-col justify-center px-5 py-8">
        <p className="text-[36px] leading-[1.05] font-[650] tracking-[-0.03em]">
          {sets.length} séries faites.
        </p>
        <p className="mt-3 text-[17px] text-(--c-muted)">
          Le maximum prévu est atteint pour cet exo.
        </p>
      </section>
    );
  }
  if (!refSet) {
    return (
      <section className="flex flex-1 flex-col justify-center px-5 py-8">
        <p className="text-[17px] text-(--c-muted)">Série {order}</p>
        <p className="mt-1 text-[36px] leading-[1.05] font-[650] tracking-[-0.03em]">
          Pas de Référence.
        </p>
        <p className="mt-3 max-w-[30ch] text-[17px] leading-snug text-(--c-muted)">
          {ex.reference
            ? `Le ${day(ex.reference.date)}, tu t'es arrêté à ${ex.reference.sets.length} séries : rien à refaire à ce rang.`
            : `Jamais fait dans ${"cette séance"} : rien à refaire ni à battre.`}
        </p>
      </section>
    );
  }
  return (
    <section className="flex flex-1 flex-col justify-center px-5 py-6">
      <p className="text-[17px] text-(--c-muted)">
        La dernière fois, série {order} ·{" "}
        <span className="tabular-nums">{day(ex.reference!.date)}</span>
      </p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-[120px] leading-[0.92] font-[650] tracking-[-0.055em] tabular-nums">
          {w(refSet.weightKg)}
        </span>
        <span className="text-[28px] font-medium text-(--c-muted)">kg</span>
      </p>
      <div className="mt-4 flex gap-10">
        <p className="flex items-baseline gap-2">
          <span className="text-[56px] leading-none font-[650] tracking-[-0.04em] tabular-nums">
            {refSet.reps}
          </span>
          <span className="text-[20px] text-(--c-muted)">reps</span>
        </p>
        <p className="flex items-baseline gap-2">
          <span className="text-[20px] text-(--c-muted)">RIR</span>
          <span className="text-[56px] leading-none font-[650] tracking-[-0.04em] tabular-nums">
            {refSet.rir}
          </span>
        </p>
      </div>
    </section>
  );
}

const BIG =
  "flex h-[104px] w-full flex-col items-start justify-center rounded-[6px] bg-(--c-ink) px-5 text-left text-(--c-bg) active:translate-y-px";
/** Réserve basse : la pastille PROTO (fixed, dev seulement) occupe 16 à 56 px du bas. */
const BAR = "sticky bottom-0 bg-(--c-bg) px-4 pt-1 pb-[68px]";

/** Barre au pouce. Le grand bouton est blanc cassé : il agit, il ne juge pas. */
function ActionBar({
  refSet,
  full,
  order,
  next,
  onRedo,
  onAdjust,
  onNext,
}: {
  refSet: SetValues | null;
  full: boolean;
  order: number;
  next: ExercisePlan | null;
  onRedo: () => void;
  onAdjust: () => void;
  onNext: () => void;
}) {
  const nextLabel = next ? next.name : "Fin de séance";
  if (refSet && !full) {
    return (
      <div className={BAR}>
        <div className="flex items-stretch gap-4">
          <SecondaryBtn onClick={onAdjust}>Ajuster</SecondaryBtn>
          <SecondaryBtn onClick={onNext} align="right" muted>
            Suivant · {nextLabel}
          </SecondaryBtn>
        </div>
        <button type="button" onClick={onRedo} className={BIG}>
          <span className="text-[34px] leading-none font-bold tracking-[-0.025em]">
            Refaire
          </span>
          <span className="mt-2 text-[17px] font-medium tabular-nums">
            {w(refSet.weightKg)} kg × {refSet.reps} · RIR {refSet.rir}
          </span>
        </button>
      </div>
    );
  }
  return (
    <div className={BAR}>
      <div className="flex items-stretch">
        {!full && (
          <SecondaryBtn onClick={onAdjust}>
            Saisir une série {order}
          </SecondaryBtn>
        )}
      </div>
      <button type="button" onClick={onNext} className={BIG}>
        <span className="text-[34px] leading-none font-bold tracking-[-0.025em]">
          Exo suivant
        </span>
        <span className="mt-2 text-[17px] font-medium">{nextLabel}</span>
      </button>
    </div>
  );
}

function SecondaryBtn({
  children,
  onClick,
  align = "left",
  muted = false,
}: {
  children: ReactNode;
  onClick: () => void;
  align?: "left" | "right";
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-14 min-w-0 truncate px-1 text-[17px] font-medium ${align === "right" ? "flex-1 text-right" : "text-left"} ${
        muted
          ? "text-(--c-muted)"
          : "text-(--c-ink) underline decoration-(--c-faint) decoration-1 underline-offset-4"
      }`}
    >
      {children}
    </button>
  );
}

/** Réglage en place : zones rectangulaires au pouce, jamais le clavier OS. */
function Adjust({
  order,
  seed,
  refSet,
  onCancel,
  onLog,
}: {
  order: number;
  seed: SetValues;
  refSet: SetValues | null;
  onCancel: () => void;
  onLog: (v: SetValues) => void;
}) {
  const [v, setV] = useState<SetValues>(seed);
  const verdict = refSet ? verdictOf(v, refSet) : null;
  return (
    <>
      <section className="flex-1 px-5 pt-4">
        <p className="text-[20px] font-semibold tracking-[-0.01em]">
          Série {order}, ce que tu as fait
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-[15px] tabular-nums">
          {verdict && refSet ? (
            <>
              <span
                className={`flex items-center gap-1.5 font-semibold ${VERDICT_COLOR[verdict]}`}
              >
                <Sign kind={verdict} size={11} />
                {VERDICT_WORD[verdict]}
              </span>
              <span className="text-(--c-muted)">
                · dernière fois {w(refSet.weightKg)} × {refSet.reps} · RIR{" "}
                {refSet.rir}
              </span>
            </>
          ) : (
            <span className="text-(--c-muted)">Pas de Référence à ce rang</span>
          )}
        </p>

        <StepRow
          label="Poids"
          unit="kg"
          value={w(v.weightKg)}
          step="1,25"
          onMinus={() =>
            setV((x) => ({ ...x, weightKg: Math.max(0, x.weightKg - 1.25) }))
          }
          onPlus={() => setV((x) => ({ ...x, weightKg: x.weightKg + 1.25 }))}
        />
        <StepRow
          label="Reps"
          value={String(v.reps)}
          step="1"
          onMinus={() => setV((x) => ({ ...x, reps: Math.max(1, x.reps - 1) }))}
          onPlus={() => setV((x) => ({ ...x, reps: x.reps + 1 }))}
        />
        <div className="mt-4">
          <p className="text-[15px] text-(--c-muted)">
            RIR, reps encore possibles
          </p>
          <div
            className="mt-2 grid grid-cols-5 gap-1.5"
            role="radiogroup"
            aria-label="RIR"
          >
            {[0, 1, 2, 3, 4].map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={v.rir === r}
                onClick={() => setV((x) => ({ ...x, rir: r }))}
                className={`h-14 rounded-[4px] text-[22px] font-semibold tabular-nums ${
                  v.rir === r
                    ? "bg-(--c-ink) text-(--c-bg)"
                    : "border border-(--c-line) bg-(--c-raise) text-(--c-ink)"
                }`}
              >
                {r === 4 ? "4+" : r}
              </button>
            ))}
          </div>
        </div>
      </section>
      <div className={BAR}>
        <div className="flex items-stretch">
          <SecondaryBtn onClick={onCancel}>Annuler</SecondaryBtn>
        </div>
        <button type="button" onClick={() => onLog(v)} className={BIG}>
          <span className="text-[34px] leading-none font-bold tracking-[-0.025em]">
            Logger
          </span>
          <span className="mt-2 text-[17px] font-medium tabular-nums">
            {w(v.weightKg)} kg × {v.reps} · RIR {v.rir}
          </span>
        </button>
      </div>
    </>
  );
}

function StepRow({
  label,
  unit,
  value,
  step,
  onMinus,
  onPlus,
}: {
  label: string;
  unit?: string;
  value: string;
  step: string;
  onMinus: () => void;
  onPlus: () => void;
}) {
  const zone =
    "h-16 w-[88px] shrink-0 rounded-[4px] border border-(--c-line) bg-(--c-raise) text-[17px] font-semibold tabular-nums active:bg-(--c-line)";
  return (
    <div className="mt-4">
      <p className="text-[15px] text-(--c-muted)">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onMinus}
          className={zone}
          aria-label={`${label} moins ${step}`}
        >
          −{step}
        </button>
        <p className="flex flex-1 items-baseline justify-center gap-1.5">
          <span className="text-[52px] leading-none font-[650] tracking-[-0.04em] tabular-nums">
            {value}
          </span>
          {unit && <span className="text-[17px] text-(--c-muted)">{unit}</span>}
        </p>
        <button
          type="button"
          onClick={onPlus}
          className={zone}
          aria-label={`${label} plus ${step}`}
        >
          +{step}
        </button>
      </div>
    </div>
  );
}

const STATUS_WORD: Record<ExercisePlan["status"], string> = {
  todo: "à faire",
  "in-progress": "en cours",
  done: "fait",
  skipped: "passé",
};

/** La séance entière, en sommaire : numéro, nom, état en mots. */
function ExerciseList({
  session,
  logged,
  currentId,
  onPick,
  onClose,
}: {
  session: SessionFixture;
  logged: Record<string, LoggedSet[]>;
  currentId: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <main className="flex flex-1 flex-col px-5 pt-4">
      <h1 className="text-[36px] leading-[1.02] font-[650] tracking-[-0.03em]">
        {session.seanceName}
      </h1>
      <p className="mt-2 text-[15px] tabular-nums text-(--c-muted)">
        Commencée à {session.startedAt.replace(":", " h ")} ·{" "}
        {session.elapsedMin} min
      </p>
      <ol className="mt-6 border-t border-(--c-line)">
        {session.exercises.map((e, i) => {
          const n = logged[e.id]?.length ?? 0;
          const current = e.id === currentId;
          const status =
            current || (n > 0 && e.status === "todo")
              ? "en cours"
              : STATUS_WORD[e.status];
          return (
            <li key={e.id} className="border-b border-(--c-line)">
              <button
                type="button"
                onClick={() => onPick(e.id)}
                aria-current={current ? "step" : undefined}
                className="grid min-h-[72px] w-full grid-cols-[28px_1fr_auto] items-center gap-x-2 py-3 text-left"
              >
                <span className="text-[17px] tabular-nums text-(--c-faint)">
                  {i + 1}
                </span>
                <span>
                  <span
                    className={`block text-[20px] leading-tight tracking-[-0.01em] ${current ? "font-semibold" : "font-normal"} ${
                      e.status === "skipped" ? "text-(--c-muted)" : ""
                    }`}
                  >
                    {e.name}
                  </span>
                  <span className="mt-0.5 block text-[15px] tabular-nums text-(--c-muted)">
                    {n} sur {range(e.sets)} séries
                  </span>
                </span>
                <span
                  className={`text-[15px] ${current ? "font-semibold text-(--c-ink)" : "text-(--c-muted)"}`}
                >
                  {status}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="sticky bottom-0 mt-auto bg-(--c-bg) pt-3 pb-[68px]">
        <button
          type="button"
          onClick={onClose}
          className="h-16 w-full rounded-[6px] border border-(--c-ink) text-[19px] font-semibold"
        >
          Retour à la série
        </button>
      </div>
    </main>
  );
}

// --- Analyse ------------------------------------------------------------------
const GRAPH_H = 46;
const GRAPH_W = 350;

const TREND_WORD: Record<Verdict, string> = {
  beaten: "monte",
  matched: "stable",
  below: "recule",
};

function trendOf(rate: number | null): Verdict | null {
  if (rate === null) return null;
  return rate > 0.25 ? "beaten" : rate < -0.25 ? "below" : "matched";
}

function Analyse({ session }: { session: SessionFixture }) {
  const exs = session.exercises;
  const dates = [
    ...new Set(exs.flatMap((e) => e.history.map((h) => h.date))),
  ].sort();
  const rel = (e: ExercisePlan) =>
    e.history.map((h) => ({
      date: h.date,
      p: ((h.e1rm - e.history[0]!.e1rm) / e.history[0]!.e1rm) * 100,
    }));
  const all = exs.flatMap((e) => rel(e).map((x) => x.p));
  // Même échelle pour tous, arrondie au palier de 2 % qui englobe les données.
  const yMin = Math.min(-2, Math.floor(Math.min(...all) / 2) * 2);
  const yMax = Math.max(6, Math.ceil(Math.max(...all) / 2) * 2);

  const counts = { beaten: 0, matched: 0, below: 0 };
  for (const e of exs) {
    const t = trendOf(e.weeklyRatePct);
    if (t) counts[t]++;
  }
  const weeks =
    dates.length > 1
      ? Math.round(
          (Date.parse(dates.at(-1)!) - Date.parse(dates[0]!)) / 604800000,
        )
      : 0;

  return (
    <main className="flex-1 px-5 pt-3 pb-[58px]">
      <h1 className="text-[32px] leading-[1.02] font-[650] tracking-[-0.03em]">
        {counts.beaten}
        {"\u00a0"}exos montent, {counts.matched}
        {"\u00a0"}stagne, {counts.below}
        {"\u00a0"}recule.
      </h1>
      {/* Légende d'échelle et axe des dates, une seule fois pour toute la pile. */}
      <p className="mt-2 text-[15px] leading-snug text-(--c-muted)">
        {weeks} semaines · e1RM 1<sup>re</sup> série, % du premier point ·
        même échelle (pointillé +5{"\u00a0"}%)
      </p>
      <div className="mt-2 flex justify-between text-[13px] whitespace-nowrap tabular-nums text-(--c-faint)">
        <span>{dates[0] && day(dates[0])}</span>
        <span>{dates.at(-1) && day(dates.at(-1)!)}</span>
      </div>

      <ol className="mt-1">
        {exs.map((e) => (
          <Multiple
            key={e.id}
            ex={e}
            series={rel(e)}
            dates={dates}
            yMin={yMin}
            yMax={yMax}
          />
        ))}
      </ol>
    </main>
  );
}

function Multiple({
  ex,
  series,
  dates,
  yMin,
  yMax,
}: {
  ex: ExercisePlan;
  series: { date: string; p: number }[];
  dates: string[];
  yMin: number;
  yMax: number;
}) {
  const x = (d: string) =>
    dates.length > 1 ? (dates.indexOf(d) / (dates.length - 1)) * GRAPH_W : 0;
  const y = (p: number) => 4 + ((yMax - p) / (yMax - yMin)) * (GRAPH_H - 8);
  const t = trendOf(ex.weeklyRatePct);
  const last = series.at(-1);
  const empty = series.length === 0;

  return (
    <li className="border-t border-(--c-line) pt-2 pb-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          className={`text-[20px] leading-tight font-semibold tracking-[-0.015em] ${empty ? "text-(--c-muted)" : ""}`}
        >
          {ex.name}
        </h2>
        {t ? (
          <p
            className={`flex shrink-0 items-center gap-1.5 text-[17px] font-semibold ${VERDICT_COLOR[t]}`}
          >
            <Sign kind={t} size={11} />
            {TREND_WORD[t]}
          </p>
        ) : (
          <p className="shrink-0 text-[15px] text-(--c-muted)">pas de pente</p>
        )}
      </div>

      {/* Sans données, aucun trait, pas même le filet 0 % : un trou n'est jamais un zéro. */}
      {empty ? (
        <p
          className="mt-1 text-[15px] leading-snug text-(--c-muted)"
        >
          Jamais fait dans cette séance : pas de courbe.
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
            width="100%"
            height={GRAPH_H}
            preserveAspectRatio="none"
            className="mt-1.5 block overflow-visible"
            role="img"
            aria-label={`${ex.name} : ${pct(last!.p)} % depuis le premier point`}
          >
            {/* Ligne 0 % commune : la même hauteur sur chaque rangée. */}
            <line
              x1={0}
              x2={GRAPH_W}
              y1={y(0)}
              y2={y(0)}
              stroke="var(--c-line)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {5 <= yMax && (
              <line
                x1={0}
                x2={GRAPH_W}
                y1={y(5)}
                y2={y(5)}
                stroke="var(--c-line)"
                strokeWidth={1}
                strokeDasharray="2 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {
              <polyline
                points={series.map((s) => `${x(s.date)},${y(s.p)}`).join(" ")}
                fill="none"
                stroke="var(--c-ink)"
                strokeWidth={2.25}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            }
          </svg>
          <p className="mt-1.5 flex justify-between gap-3 text-[15px] whitespace-nowrap tabular-nums text-(--c-muted)">
            <span>
              <span className="font-semibold text-(--c-ink)">
                {pct(ex.weeklyRatePct!)}
                {"\u00a0"}%
              </span>{" "}
              par semaine
            </span>
            {ex.pr && (
              <span>
                record{" "}
                <span className="font-semibold text-(--c-ink)">
                  {w(ex.pr.e1rm)} kg
                </span>
                , {day(ex.pr.date)}
              </span>
            )}
          </p>
        </>
      )}
    </li>
  );
}
