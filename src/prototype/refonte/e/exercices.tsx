// PROTOTYPE JETABLE · socle E, surface Exercices (d'après ExercisesScreen.tsx et
// ExerciseForm.tsx de l'app).
//
// Pages :
//   index      catalogue : recherche au clavier (texte libre, donc admis), filtre
//              par muscle principal en mots soulignés, « Tes exercices » (perso)
//              puis « Catalogue commun » (base). Une ligne = nom, muscles
//              principaux, « unilatéral » en mot ; « ta version » à droite d'un
//              exo de base personnalisé. L'action principale : créer un exo perso.
//   fiche      un exo : muscles principaux, mouvement, origine (base, perso, ta
//              version et son original), historique résumé (e1RM, pente, record,
//              lien vers l'Analyse), séances qui le prescrivent, note
//              d'instructions modifiable sur place, puis la porte de sortie :
//              revenir à l'original (override), archiver (perso déjà utilisé) ou
//              supprimer (perso jamais utilisé), chacune derrière une garde sobre.
//   nouveau    formulaire de création (exercices-form.tsx), pré-rempli par la
//              recherche quand elle n'a rien trouvé.
//   modifier   même formulaire : exo perso, ou override d'un exo de base.
//   archives   exos perso archivés, à ressortir.
//
// L'état vit dans fixtures-exercices.ts (magasin au niveau du module). Le
// catalogue de la Salle (fixtures-e.ts) n'est pas touché : dans le prototype,
// un exo créé ici n'apparaît pas encore dans la feuille « Ajouter » en salle.
import { useMemo, useState, type ReactNode } from "react";
import { ExoForm } from "./exercices-form";
import { Notice, TextArea } from "./exercices-champs";
import { SlopeStatus, useJournal } from "./analyse-common";
import {
  curvesOf,
  recordsOf,
  seanceInfo,
  type Execution,
} from "./fixtures-analyse";
import {
  catalogue,
  MUSCLES,
  prescribedIn,
  useCatalogue,
  type Exo,
  type Muscle,
} from "./fixtures-exercices";
import { fmt1, fmtDate, fmtPct, slopeVerdict, WORDS } from "./format";
import {
  Choice,
  EmptyState,
  List,
  PrimaryButton,
  Row,
  Screen,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  Sign,
  TextLink,
  TONE,
} from "./kit";
import { Pages, useNav } from "./shell";

export function Exercices() {
  // Chiffres tabulaires réservés aux nombres (classe `tabular-nums`) : sur le
  // texte, ils espacent les traits d'union (« ischio-jambiers »).
  return (
    <div className="flex flex-1 flex-col [font-variant-numeric:normal]">
      <Pages
        pages={{
          index: () => <Catalogue />,
          fiche: (p) => <Fiche id={p.id ?? ""} />,
          nouveau: (p) => <ExoForm prefill={p.name} />,
          modifier: (p) => <ExoForm id={p.id} />,
          archives: () => <Archives />,
        }}
      />
    </div>
  );
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Comparaison sans casse ni accents : « developpe » trouve « Développé ». */
const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Un muscle ne se coupe jamais en fin de ligne (« avant épaule »). */
const nb = (ms: string[], sep: string) =>
  ms.map((m) => m.replace(/ /g, "\u00a0")).join(sep);

function musclesLine(e: Exo) {
  return `${nb(e.shownMuscles, " · ")}${e.shownUnilateral ? " · unilatéral" : ""}`;
}

/* ------------------------------------------------------------------------ */
/* Catalogue                                                                  */
/* ------------------------------------------------------------------------ */

function Catalogue() {
  const nav = useNav();
  const all = useCatalogue();
  const [q, setQ] = useState("");
  const [muscle, setMuscle] = useState<Muscle | "tous">("tous");

  const active = all.filter((e) => !e.archived);
  const archived = all.filter((e) => e.archived);
  const used = MUSCLES.filter((m) =>
    active.some((e) => e.shownMuscles.includes(m)),
  );
  const shown = useMemo(() => {
    const k = fold(q);
    return active
      .filter((e) => muscle === "tous" || e.shownMuscles.includes(muscle))
      .filter(
        (e) =>
          !k ||
          fold(e.shownName).includes(k) ||
          (e.overridden && fold(e.name).includes(k)),
      );
  }, [active, q, muscle]);
  const perso = shown.filter((e) => e.kind === "perso");
  const base = shown
    .filter((e) => e.kind === "base")
    .sort((a, b) => a.shownName.localeCompare(b.shownName, "fr"));
  const nPerso = active.filter((e) => e.kind === "perso").length;

  const row = (e: Exo) => (
    <Row
      key={e.id}
      title={e.shownName}
      meta={musclesLine(e)}
      value={
        e.overridden ? (
          <span className="text-[14px] font-normal text-(--muted)">
            ta version
          </span>
        ) : undefined
      }
      onClick={() => nav.push("fiche", { id: e.id })}
    />
  );

  return (
    <Screen
      bottom={
        <PrimaryButton
          onClick={() =>
            nav.push(
              "nouveau",
              q.trim() && shown.length === 0 ? { name: q.trim() } : {},
            )
          }
        >
          Créer un exo perso
        </PrimaryButton>
      }
    >
      <ScreenHeader
        title="Exercices"
        meta={
          <span className="tabular-nums">{`${active.length} exercices · ${nPerso} perso`}</span>
        }
      />

      <div className="px-5">
        <label htmlFor="exo-search" className="sr-only">
          Chercher un exercice
        </label>
        <div className="flex items-center gap-2">
          <input
            id="exo-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Chercher un exercice"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            maxLength={80}
            className="h-12 w-full min-w-0 flex-1 rounded-(--r) border border-(--dim) bg-(--raise) px-3.5 text-[17px] text-(--ink) outline-none placeholder:text-(--faint) focus:border-(--ink) [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <TextLink tone="muted" onClick={() => setQ("")} className="px-1">
              Effacer
            </TextLink>
          )}
        </div>
      </div>

      <div
        className="mt-1 overflow-x-auto px-3"
        style={{ scrollbarWidth: "none" }}
      >
        <Choice
          label="Muscle principal"
          wrap={false}
          value={muscle}
          onChange={setMuscle}
          options={[
            { value: "tous" as const, label: "Tous" },
            ...used.map((m) => ({ value: m, label: cap(m) })),
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={
            q ? `Rien pour « ${q.trim()} »` : "Aucun exercice pour ce muscle"
          }
          body={
            q
              ? "Vérifie l’orthographe, ou crée-le : il sera visible de toi seul."
              : "Choisis un autre muscle, ou crée un exo perso."
          }
          action={
            q ? (
              <SecondaryButton
                onClick={() => nav.push("nouveau", { name: q.trim() })}
              >
                Créer « {q.trim()} »
              </SecondaryButton>
            ) : undefined
          }
        />
      ) : (
        <>
          <SectionTitle aside={perso.length ? String(perso.length) : undefined}>
            Tes exercices
          </SectionTitle>
          {perso.length ? (
            <List label="Tes exercices">{perso.map(row)}</List>
          ) : (
            <p className="border-t border-(--line) px-5 py-3 text-[15px] text-(--muted)">
              {q || muscle !== "tous"
                ? "Aucun de tes exos ne correspond."
                : "Pas encore d’exo perso."}
            </p>
          )}
          <SectionTitle aside={String(base.length)}>
            Catalogue commun
          </SectionTitle>
          {base.length ? (
            <List label="Catalogue commun">{base.map(row)}</List>
          ) : (
            <p className="border-t border-(--line) px-5 py-3 text-[15px] text-(--muted)">
              Aucun exo de base ne correspond.
            </p>
          )}
        </>
      )}

      {archived.length > 0 && !q && muscle === "tous" && (
        <div className="px-5 pt-4">
          <TextLink tone="muted" onClick={() => nav.push("archives")}>
            {archived.length} exo{archived.length > 1 ? "s" : ""} archivé
            {archived.length > 1 ? "s" : ""}
          </TextLink>
        </div>
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------------------ */
/* Fiche                                                                      */
/* ------------------------------------------------------------------------ */

function Line({
  label,
  children,
  sub,
}: {
  label: string;
  children: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="flex min-h-12 items-baseline justify-between gap-4 border-b border-(--line) px-5 py-3">
      <span className="flex-none text-[16px] text-(--muted)">{label}</span>
      <span className="min-w-0 text-right">
        <span className="block text-[16px] text-(--ink)">{children}</span>
        {sub && (
          <span className="mt-0.5 block text-[14px] text-(--faint)">{sub}</span>
        )}
      </span>
    </div>
  );
}

type Guard = null | "reset" | "archive" | "delete";

function Fiche({ id }: { id: string }) {
  const nav = useNav();
  const all = useCatalogue();
  const journal = useJournal();
  const e = all.find((x) => x.id === id);
  const [guard, setGuard] = useState<Guard>(null);
  const [editNote, setEditNote] = useState(false);
  const [note, setNote] = useState(e?.note ?? "");
  const [flash, setFlash] = useState<string | null>(null);

  if (!e) {
    return (
      <Screen>
        <ScreenHeader
          title="Exercice introuvable"
          back={{ label: "Exercices", onClick: () => nav.reset() }}
        />
        <EmptyState
          title="Cet exercice n’existe plus."
          body="Il a peut-être été supprimé."
        />
      </Screen>
    );
  }

  const o = e.override;
  const origin =
    e.kind === "perso"
      ? e.archived
        ? "Exo perso archivé"
        : "Exo perso, visible de toi seul"
      : e.overridden
        ? "Ta version d’un exo de base"
        : "Exo de base, catalogue commun";
  const used = !!e.usage || curvesOf(journal, e.id).length > 0;
  const seances = prescribedIn(e.id);

  return (
    <Screen>
      <ScreenHeader
        title={e.shownName}
        meta={origin}
        back={{
          label: e.archived ? "Archives" : "Exercices",
          onClick: nav.back,
        }}
        action={
          !e.archived && (
            <TextLink
              onClick={() => nav.push("modifier", { id: e.id })}
              className="px-1"
            >
              {e.kind === "base"
                ? e.overridden
                  ? "Modifier ta version"
                  : "Personnaliser"
                : "Modifier"}
            </TextLink>
          )
        }
      />

      {flash && (
        <p
          role="status"
          className="mx-5 mb-3 border-l-[3px] border-(--muted) pl-3 text-[15px] text-(--ink)"
        >
          {flash}
        </p>
      )}

      <div className="border-t border-(--line)">
        <Line
          label="Muscles principaux"
          sub={o?.muscles ? `original : ${nb(e.muscles, ", ")}` : undefined}
        >
          {nb(e.shownMuscles, ", ")}
        </Line>
        <Line
          label="Mouvement"
          sub={
            o?.unilateral !== undefined
              ? `original : ${e.unilateral ? "unilatéral" : "bilatéral"}`
              : e.shownUnilateral
                ? "un côté à la fois, la courbe suit le côté faible"
                : undefined
          }
        >
          {e.shownUnilateral ? "unilatéral" : "bilatéral"}
        </Line>
        {o?.name && <Line label="Nom d’origine">{e.name}</Line>}
      </div>

      <History e={e} journal={journal} />

      {seances.length > 0 && (
        <section>
          <SectionTitle>Dans tes séances</SectionTitle>
          <List label="Séances qui le prescrivent">
            {seances.map((s) => (
              <Row
                key={`${s.routine}-${s.seance}`}
                title={s.seance}
                meta={s.routine}
                value={
                  <span className="text-[15px] font-normal text-(--ink)">
                    {s.presc}
                  </span>
                }
              />
            ))}
          </List>
        </section>
      )}

      <section>
        <SectionTitle
          aside={e.note && !editNote ? "visible en salle" : undefined}
        >
          Note d’instructions
        </SectionTitle>
        {editNote ? (
          <div className="px-5">
            <TextArea
              label="Note d’instructions"
              value={note}
              onChange={setNote}
              placeholder="Réglages de la machine, placement, consignes"
              hint="Elle t’appartient : la modifier ne personnalise pas l’exercice."
            />
            <div className="mt-3 flex items-center gap-4">
              <SecondaryButton
                onClick={() => {
                  catalogue.setNote(e.id, note);
                  setEditNote(false);
                  setFlash(note.trim() ? "Note enregistrée." : "Note effacée.");
                }}
              >
                Enregistrer la note
              </SecondaryButton>
              <TextLink
                tone="muted"
                onClick={() => {
                  setNote(e.note);
                  setEditNote(false);
                }}
              >
                Annuler
              </TextLink>
            </div>
          </div>
        ) : (
          <div className="px-5">
            {e.note ? (
              <p className="max-w-[36ch] text-[16px] leading-[1.5] text-(--ink)">
                {e.note}
              </p>
            ) : (
              <p className="text-[15px] leading-[1.45] text-(--muted)">
                Aucune note. Elle s’affiche en salle sous le nom de l’exo.
              </p>
            )}
            <TextLink
              onClick={() => {
                setNote(e.note);
                setEditNote(true);
                setFlash(null);
              }}
            >
              {e.note ? "Modifier la note" : "Écrire une note"}
            </TextLink>
          </div>
        )}
      </section>

      <ExitSection
        e={e}
        used={used}
        seances={seances}
        guard={guard}
        setGuard={setGuard}
      />
      <div className="h-(--pad-bottom)" />
    </Screen>
  );
}

/** Historique résumé, lu dans le journal de l'Analyse : la fiche et la courbe
 *  disent la même chose. Courbe = 1ʳᵉ série de chaque exécution, une par séance. */
function History({ e, journal }: { e: Exo; journal: Execution[] }) {
  const nav = useNav();
  const curves = curvesOf(journal, e.id);
  const rec = recordsOf(journal, e.id);
  const toAnalyse = (
    <TextLink onClick={() => nav.go("analyse", "exo", { id: e.id })}>
      Voir la courbe dans l’Analyse
    </TextLink>
  );

  let body: ReactNode;
  const main = curves[0];
  if (main) {
    const pts = main.points;
    const lastPt = pts[pts.length - 1]!;
    body = (
      <>
        <dl className="grid grid-cols-[1fr_1.25fr_1fr] gap-3 border-t tabular-nums border-(--line) px-5 pt-3">
          <div>
            <dt className="text-[13px] text-(--muted)">e1RM</dt>
            <dd className="mt-1 text-[22px] font-medium leading-none tracking-[-0.01em] text-(--ink)">
              {fmt1(lastPt.e1rm)}
            </dd>
            <dd className="mt-1.5 text-[13px] text-(--faint)">
              {fmtDate(lastPt.date)}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-(--muted)">Pente</dt>
            {main.slope !== null ? (
              <>
                <dd
                  className={`mt-1 flex items-center gap-1.5 text-[22px] font-medium leading-none tracking-[-0.01em] ${TONE[slopeVerdict(main.slope)]}`}
                >
                  <Sign v={slopeVerdict(main.slope)} size={13} />
                  {fmtPct(main.slope)}
                </dd>
                <dd
                  className={`mt-1.5 text-[13px] ${TONE[slopeVerdict(main.slope)]}`}
                >
                  {WORDS.slope[slopeVerdict(main.slope)]} par sem.
                </dd>
              </>
            ) : (
              <dd className="mt-1 text-[15px] leading-tight text-(--muted)">
                <SlopeStatus slope={null} points={pts.length} />
              </dd>
            )}
          </div>
          <div className="text-right">
            <dt className="text-[13px] text-(--muted)">Record</dt>
            {rec ? (
              <>
                <dd className="mt-1 text-[22px] font-medium leading-none tracking-[-0.01em] text-(--ink)">
                  {fmt1(rec.best.e1rm)}
                </dd>
                <dd className="mt-1.5 text-[13px] text-(--faint)">
                  {fmtDate(rec.best.date)}
                </dd>
              </>
            ) : (
              <dd className="mt-1 text-[16px] text-(--muted)">aucun</dd>
            )}
          </div>
        </dl>
        {pts.length > 1 && <Spark values={pts.map((p) => p.e1rm)} />}
        <p className="px-5 text-[14px] leading-[1.45] text-(--muted)">
          {seanceInfo(main.seanceId).name} · {pts.length} exécution
          {pts.length > 1 ? "s" : ""} du {fmtDate(pts[0]!.date)} au{" "}
          {fmtDate(lastPt.date)} · e1RM en kg de la 1ʳᵉ série
        </p>
        {curves.length > 1 && (
          <ul className="mt-2 px-5" aria-label="Autres séances">
            {curves.slice(1).map((c) => (
              <li
                key={c.seanceId}
                className="flex items-baseline justify-between gap-3 py-1 text-[14px]"
              >
                <span className="text-(--muted)">
                  aussi dans{" "}
                  <span className="text-(--ink)">
                    {seanceInfo(c.seanceId).name}
                  </span>
                </span>
                <SlopeStatus slope={c.slope} points={c.points.length} short />
              </li>
            ))}
          </ul>
        )}
        <div className="px-5">{toAnalyse}</div>
      </>
    );
  } else if (e.usage) {
    body = (
      <div className="border-t border-(--line) px-5 pt-3">
        <p className="text-[16px] text-(--ink)">
          {e.usage.executions} exécutions · {e.usage.sets} séries
        </p>
        <p className="mt-0.5 text-[14px] text-(--muted)">
          {e.usage.seanceName} · du {fmtDate(e.usage.first)} au{" "}
          {fmtDate(e.usage.last)}
        </p>
      </div>
    );
  } else {
    body = (
      <p className="border-t border-(--line) px-5 pt-3 text-[15px] leading-[1.45] text-(--muted)">
        Jamais fait. La courbe apparaît dans l’Analyse après la première série.
      </p>
    );
  }

  return (
    <section>
      <SectionTitle>Historique</SectionTitle>
      {body}
    </section>
  );
}

/** Courbe e1RM minuscule, trait blanc cassé, dernier point marqué. Aucun axe : la vraie est dans l'Analyse. */
function Spark({ values }: { values: number[] }) {
  const W = 350;
  const H = 56;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => 4 + (i / Math.max(1, values.length - 1)) * (W - 8);
  const y = (v: number) =>
    H - 6 - ((v - lo) / Math.max(0.1, hi - lo)) * (H - 14);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mx-5 my-3 block h-14 w-[calc(100%-40px)]"
      aria-hidden
      preserveAspectRatio="none"
    >
      <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--line)" />
      <path
        d={values
          .map(
            (v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`,
          )
          .join(" ")}
        fill="none"
        stroke="var(--ink)"
        strokeWidth="2"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x={x(values.length - 1) - 3.5}
        y={y(values[values.length - 1]!) - 3.5}
        width="7"
        height="7"
        fill="var(--ink)"
      />
    </svg>
  );
}

/** Sortie : revenir à l'original (override), archiver (déjà servi) ou supprimer (jamais servi). */
function ExitSection({
  e,
  used,
  seances,
  guard,
  setGuard,
}: {
  e: Exo;
  used: boolean;
  seances: ReturnType<typeof prescribedIn>;
  guard: Guard;
  setGuard: (g: Guard) => void;
}) {
  const nav = useNav();
  if (e.kind === "base" && !e.overridden) return null;

  if (e.kind === "base") {
    return (
      <section className="px-5 pt-8">
        {guard === "reset" ? (
          <Notice
            title={`Revenir à « ${e.name} » ?`}
            actions={
              <>
                <SecondaryButton
                  onClick={() => {
                    catalogue.resetOverride(e.id);
                    setGuard(null);
                  }}
                >
                  Revenir à l’original
                </SecondaryButton>
                <TextLink tone="muted" onClick={() => setGuard(null)}>
                  Garder ta version
                </TextLink>
              </>
            }
          >
            Ton nom, tes muscles et ton réglage du mouvement sont retirés. Ta
            note et ton historique restent.
          </Notice>
        ) : (
          <TextLink tone="muted" onClick={() => setGuard("reset")}>
            Revenir à l’original
          </TextLink>
        )}
      </section>
    );
  }

  if (e.archived) {
    return (
      <section className="px-5 pt-8">
        <SecondaryButton
          onClick={() => {
            catalogue.archive(e.id, false);
            nav.back();
          }}
        >
          Ressortir des archives
        </SecondaryButton>
        <p className="mt-2 text-[14px] text-(--muted)">
          Il revient au catalogue et dans les choix en salle.
        </p>
      </section>
    );
  }

  const blocking = seances.filter((s) => !s.lastDone || s.current);
  if (used) {
    return (
      <section className="px-5 pt-8">
        {guard === "archive" ? (
          blocking.length > 0 ? (
            <Notice
              title="Encore prescrit"
              actions={
                <>
                  <SecondaryButton onClick={() => nav.go("seances")}>
                    Ouvrir Séances
                  </SecondaryButton>
                  <TextLink tone="muted" onClick={() => setGuard(null)}>
                    Fermer
                  </TextLink>
                </>
              }
            >
              Il figure dans {blocking.map((s) => s.seance).join(", ")}.
              Retire-le de ces séances avant de l’archiver.
            </Notice>
          ) : (
            <Notice
              title={`Archiver « ${e.shownName} » ?`}
              actions={
                <>
                  <SecondaryButton
                    onClick={() => {
                      catalogue.archive(e.id, true);
                      nav.back();
                    }}
                  >
                    Archiver
                  </SecondaryButton>
                  <TextLink tone="muted" onClick={() => setGuard(null)}>
                    Annuler
                  </TextLink>
                </>
              }
            >
              Il sort du catalogue et des choix en salle. Ses séries restent
              dans ton historique. Tu pourras le ressortir des archives.
            </Notice>
          )
        ) : (
          <>
            <TextLink tone="muted" onClick={() => setGuard("archive")}>
              Archiver cet exo
            </TextLink>
            <p className="text-[14px] text-(--faint)">
              Il a déjà servi : il s’archive, il ne se supprime pas.
            </p>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="px-5 pt-8">
      {guard === "delete" ? (
        <Notice
          title={`Supprimer « ${e.shownName} » ?`}
          actions={
            <>
              <SecondaryButton onClick={() => setGuard(null)}>
                Garder
              </SecondaryButton>
              <TextLink
                onClick={() => {
                  catalogue.remove(e.id);
                  nav.back();
                }}
              >
                Supprimer définitivement
              </TextLink>
            </>
          }
        >
          Aucune série ni séance ne l’utilise : rien d’autre ne disparaît. Ce
          geste ne se défait pas.
        </Notice>
      ) : (
        <>
          <TextLink tone="muted" onClick={() => setGuard("delete")}>
            Supprimer cet exo
          </TextLink>
          <p className="text-[14px] text-(--faint)">
            Jamais utilisé : il peut encore se supprimer.
          </p>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Archives                                                                   */
/* ------------------------------------------------------------------------ */

function Archives() {
  const nav = useNav();
  const archived = useCatalogue().filter((e) => e.archived);
  return (
    <Screen>
      <ScreenHeader
        title="Exos archivés"
        meta="Hors du catalogue et des choix en salle. Leur historique reste entier."
        back={{ label: "Exercices", onClick: nav.back }}
      />
      {archived.length === 0 ? (
        <EmptyState title="Aucun exo archivé." />
      ) : (
        <List label="Exos archivés">
          {archived.map((e) => (
            <Row
              key={e.id}
              title={e.shownName}
              meta={`${musclesLine(e)}${e.usage ? ` · dernière fois le ${fmtDate(e.usage.last)}` : ""}`}
              muted
              onClick={() => nav.push("fiche", { id: e.id })}
              trailing={
                <TextLink
                  tone="muted"
                  onClick={() => catalogue.archive(e.id, false)}
                  className="-mr-1 px-1 text-[15px]"
                >
                  Ressortir
                </TextLink>
              }
            />
          ))}
        </List>
      )}
      <div className="h-(--pad-bottom)" />
    </Screen>
  );
}
