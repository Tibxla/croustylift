// Surface « Exercices » : gestion du catalogue d'exos (issue #49).
//
// Architecture (calquée sur SeancesScreen / SeanceEditor) : on SÉPARE le
// chargement Supabase de la PRÉSENTATION. `ExercisesView` est PUR (props =
// données + callbacks) et se monte tel quel dans le harness de screenshot, sans
// réseau. `ExercisesScreen` est le conteneur : il charge via listExercises (lit
// base + perso), mute via create/update/deletePersonalExercise, et recharge.
//
// Périmètre (cf. GLOSSARY.md) :
//   - exo de BASE (owner_id null) : la LIGNE de base reste lecture seule pour
//     tous, mais l'user peut la PERSONNALISER via un override per-user (nom,
//     unilatéral, muscles principaux ; issue #50) et la réinitialiser. La ligne
//     partagée n'est jamais modifiée ; l'override est invisible des autres users.
//   - exo PERSO (owner_id = auth.uid()) : créer, modifier (nom + muscles +
//     unilatéral, « renommer » = changer le champ nom) et supprimer.
//   - NOTE par exo (exercise_notes #26, déjà per-user) : éditable pour TOUS les
//     exos (base ET perso) DANS le formulaire « Modifier / Personnaliser » (la note
//     vit dans ExerciseForm, plus d'action note sur la carte de liste). Chargée à
//     l'ouverture du form ; corps vide = suppression.
//
// Pages (kit E, DESIGN.md), en état local comme l'Analyse :
//   liste     recherche au clavier (texte libre, admis), filtre par muscle
//             principal en mots soulignés, « Tes exos » puis « Catalogue
//             commun ». Une ligne = nom, muscles, « unilatéral » en mot ; « ta
//             version » à droite d'un exo de base personnalisé. Action
//             principale en bas : créer un exo perso (pré-rempli par une
//             recherche qui n'a rien trouvé).
//   fiche     un exo : muscles, mouvement, origine ; note d'instructions lue,
//             modifiée sur geste explicite ; puis la sortie (revenir à l'exo de
//             base, ou supprimer un exo perso) derrière une confirmation en
//             ligne où l'option sûre est le bouton.
//   formulaire  ExerciseForm en écran entier : créer, modifier un exo perso,
//             personnaliser un exo de base (override).
// Aucun signal ici (rien n'y est « mieux que la dernière fois »), aucun badge :
// un statut est un mot. Cibles de 44 px au moins, aucun tiret long affiché.
//
// Suppression SÛRE : la couche data (deletePersonalExercise) compte d'abord les
// références (prescriptions + séries faites) et REFUSE avec un message lisible si
// l'exo est encore utilisé, au lieu de laisser la base lever une violation de FK.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Confirm,
  EmptyState,
  IconButton,
  List,
  LoadError,
  Loading,
  PrimaryButton,
  Row,
  Screen,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  TextArea,
  TextField,
  TextLink,
  Choice,
} from '../../ui';
import { MUSCLE_GROUPS } from '../authoring/exercise-input';
import { localTemplates, seancesUsing } from './local-usage';
import { useReloadBlockWhile } from '../../pwa/useReloadBlockWhile';
import { listExercises } from '../capture/data';
import {
  createPersonalExercise,
  updatePersonalExercise,
  deletePersonalExercise,
} from '../authoring/data';
import { loadExerciseNote, saveExerciseNote } from '../notes/data';
import { invalidatePlanCopies } from '../capture/plan-copies';
import {
  loadExerciseOverrides,
  upsertExerciseOverride,
  resetExerciseOverride,
} from './overrides';
import { isOverridden } from '../../domain/exercise-override';
import { ExerciseForm, type ExerciseFormValue } from './ExerciseForm';

/** Un champ d'exercice (nom / muscles / unilatéral) diffère-t-il des valeurs courantes ?
    Sert à n'écrire un override d'exo de base QUE si l'utilisateur a vraiment
    personnalisé (éditer la seule note ne doit pas créer de personnalisation). */
function exerciseFieldsChanged(exo: ListExercise, value: ExerciseFormValue): boolean {
  if (exo.name !== value.name) return true;
  if (exo.unilateral !== value.unilateral) return true;
  const a = [...exo.primaryMuscles].sort().join('|');
  const b = [...value.primaryMuscles].sort().join('|');
  return a !== b;
}
import {
  filterByMuscle,
  filterExercises,
  isPersonalExercise,
  musclesInUse,
  musclesOf,
  toListExercise,
  type ListExercise,
} from './exercises-list';
import { errorMessage } from '../../lib/error-message';

// =====================================================================
// Conteneur : chargement + mutations
// =====================================================================

type Load =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; exercises: ListExercise[]; overridden: Set<string> };

export function ExercisesScreen() {
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let active = true;
    // Loader au 1er chargement seulement ; un rafraîchissement (reload() après
    // un save) garde le contenu monté → pas de saut de scroll en haut.
    if (reloadKey === 0) setLoad({ phase: 'loading' });

    void (async () => {
      try {
        // `listExercises` renvoie déjà les champs FUSIONNÉS (override per-user) ;
        // les overrides bruts servent juste à savoir QUELS exos sont personnalisés
        // (badge + pré-remplissage du formulaire / réinitialisation).
        const [rows, overrides] = await Promise.all([
          listExercises(),
          loadExerciseOverrides(),
        ]);
        if (!active) return;
        const overridden = new Set(
          [...overrides.entries()]
            .filter(([, values]) => isOverridden(values))
            .map(([id]) => id),
        );
        setLoad({ phase: 'ready', exercises: rows.map(toListExercise), overridden });
      } catch (err) {
        if (!active) return;
        setLoad({ phase: 'error', message: errorMessage(err) });
      }
    })();

    return () => {
      active = false;
    };
  }, [reloadKey]);

  if (load.phase === 'loading') {
    return (
      <Page>
        <ScreenHeader title="Exercices" />
        <Loading label="Chargement des exercices…" />
      </Page>
    );
  }

  if (load.phase === 'error') {
    return (
      <Page>
        <ScreenHeader title="Exercices" />
        <LoadError intro="Impossible de charger tes exercices." message={load.message} onRetry={reload} />
      </Page>
    );
  }

  return (
    <ExercisesView
      exercises={load.exercises}
      overridden={load.overridden}
      onCreate={async (value) => {
        await createPersonalExercise(value);
        reload();
      }}
      onUpdate={async (id, value) => {
        await updatePersonalExercise(id, value);
        reload();
      }}
      onDelete={async (id) => {
        await deletePersonalExercise(id);
        reload();
      }}
      onSaveOverride={async (id, value) => {
        // Les templates et le catalogue servis à la Capture portent les champs
        // personnalisés : leurs copies sont périmées.
        try {
          await upsertExerciseOverride(id, value);
        } finally {
          invalidatePlanCopies();
        }
        reload();
      }}
      onResetOverride={async (id) => {
        try {
          await resetExerciseOverride(id);
        } finally {
          invalidatePlanCopies();
        }
        reload();
      }}
      onLoadNote={loadExerciseNote}
      onSaveNote={saveExerciseNote}
    />
  );
}

// =====================================================================
// Présentation pure (montable sans réseau dans le harness)
// =====================================================================

export interface ExercisesViewProps {
  exercises: ListExercise[];
  /** Ids des exos de base PERSONNALISÉS par l'user (override effectif, issue #50). */
  overridden: Set<string>;
  /** Crée un exo perso. Résolu = créé (le conteneur recharge). */
  onCreate: (value: ExerciseFormValue) => Promise<void>;
  /** Édite un exo perso (renommer + muscles + unilatéral). */
  onUpdate: (id: string, value: ExerciseFormValue) => Promise<void>;
  /** Supprime un exo perso. Rejette avec un message si l'exo est référencé. */
  onDelete: (id: string) => Promise<void>;
  /** Crée/maj l'override d'un exo de BASE (jamais la ligne de base). */
  onSaveOverride: (id: string, value: ExerciseFormValue) => Promise<void>;
  /** Réinitialise un exo de base (supprime l'override per-user). */
  onResetOverride: (id: string) => Promise<void>;
  /** Charge la note (exercise_notes #26) d'un exo, '' si aucune. */
  onLoadNote: (exerciseId: string) => Promise<string>;
  /** Enregistre la note d'un exo (corps vide = suppression). */
  onSaveNote: (exerciseId: string, body: string) => Promise<void>;
}

/** Où l'utilisateur se trouve dans l'onglet. */
type Page =
  | { kind: 'list' }
  | { kind: 'fiche'; id: string }
  | { kind: 'new'; prefill?: string }
  | { kind: 'edit'; id: string };

/** Raison du blocage de rechargement tenu par une note d'exo en cours d'écriture. */
const NOTE_DRAFT_BLOCK = 'brouillon-note-exercice';

/** Valeur « tous les muscles » du filtre (un muscle canonique n'a pas ce nom). */
const ALL = 'tous';

const exos = (n: number) => `${n} exo${n > 1 ? 's' : ''}`;
const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
/** Un muscle ne se coupe jamais en fin de ligne (« avant épaule »). */
const keepTogether = (m: string) => m.replace(/ /g, ' ');

function musclesLine(exo: ListExercise): string {
  return [...musclesOf(exo).map((m) => keepTogether(capitalize(m))), ...(exo.unilateral ? ['unilatéral'] : [])].join(' · ');
}

export function ExercisesView({
  exercises,
  overridden,
  onCreate,
  onUpdate,
  onDelete,
  onSaveOverride,
  onResetOverride,
  onLoadNote,
  onSaveNote,
}: ExercisesViewProps) {
  const [page, setPage] = useState<Page>({ kind: 'list' });
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<string>(ALL);
  // Une phrase qui confirme le dernier geste (« créé », « supprimé »), sur la
  // page où il mène ; effacée à la navigation suivante.
  const [flash, setFlash] = useState<string | null>(null);

  // Changer de page : instantané, sans animation (geste fréquent), et la
  // nouvelle page s'ouvre sur son en-tête.
  const go = (next: Page, message: string | null = null) => {
    setPage(next);
    setFlash(message);
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  };

  const byId = (id: string) => exercises.find((e) => e.id === id);

  if (page.kind === 'new') {
    return (
      <ExerciseForm
        frame={{ title: 'Nouvel exo perso', meta: 'Visible de toi seul.', backLabel: 'Exercices' }}
        prefillName={page.prefill}
        submitLabel="Créer l’exo"
        submitBusyLabel="Création…"
        onCancel={() => go({ kind: 'list' })}
        onSubmit={async (value) => {
          await onCreate(value);
          setQuery('');
          setMuscle(ALL);
          go({ kind: 'list' }, `« ${value.name} » est créé, dans Tes exos.`);
        }}
      />
    );
  }

  if (page.kind === 'edit') {
    const exo = byId(page.id);
    if (!exo) return <Missing onBack={() => go({ kind: 'list' })} />;
    const base = !isPersonalExercise(exo.ownerId);
    const isOverridden = overridden.has(exo.id);
    return (
      <ExerciseForm
        frame={{
          title: base ? (isOverridden ? 'Ta version' : 'Personnaliser') : 'Modifier l’exo',
          meta: base
            ? 'Pour toi seul. Le catalogue commun ne change pas, ta note et ton historique non plus.'
            : 'Exo perso, visible de toi seul.',
          backLabel: exo.name,
        }}
        initial={{ name: exo.name, primaryMuscles: exo.primaryMuscles, unilateral: exo.unilateral }}
        autoFocusName={false}
        submitLabel="Enregistrer"
        submitBusyLabel="Enregistrement…"
        onCancel={() => go({ kind: 'fiche', id: exo.id })}
        onSubmit={async (value) => {
          const changed = exerciseFieldsChanged(exo, value);
          // Exo de base : l'override ne s'écrit que si un champ a changé (rien
          // n'est personnalisé pour un simple aller-retour).
          if (base) {
            if (changed) await onSaveOverride(exo.id, value);
          } else if (changed) {
            await onUpdate(exo.id, value);
          }
          go({ kind: 'fiche', id: exo.id }, changed ? 'Modifications enregistrées.' : null);
        }}
      />
    );
  }

  if (page.kind === 'fiche') {
    const exo = byId(page.id);
    if (!exo) return <Missing onBack={() => go({ kind: 'list' })} />;
    return (
      <Fiche
        key={exo.id}
        exo={exo}
        overridden={overridden.has(exo.id)}
        flash={flash}
        onBack={() => go({ kind: 'list' })}
        onEdit={() => go({ kind: 'edit', id: exo.id })}
        onFlash={setFlash}
        onLoadNote={onLoadNote}
        onSaveNote={onSaveNote}
        onResetOverride={async () => {
          await onResetOverride(exo.id);
          setFlash('L’exo est revenu à sa version de base.');
        }}
        onDelete={async () => {
          await onDelete(exo.id);
          go({ kind: 'list' }, `« ${exo.name} » est supprimé.`);
        }}
      />
    );
  }

  return (
    <Catalogue
      exercises={exercises}
      overridden={overridden}
      query={query}
      onQuery={(q) => {
        setQuery(q);
        setFlash(null);
      }}
      muscle={muscle}
      onMuscle={setMuscle}
      flash={flash}
      onOpen={(id) => go({ kind: 'fiche', id })}
      onCreate={(prefill) => go({ kind: 'new', prefill })}
    />
  );
}

// --- Liste ------------------------------------------------------------------

function Catalogue({
  exercises,
  overridden,
  query,
  onQuery,
  muscle,
  onMuscle,
  flash,
  onOpen,
  onCreate,
}: {
  exercises: ListExercise[];
  overridden: Set<string>;
  query: string;
  onQuery: (q: string) => void;
  muscle: string;
  onMuscle: (m: string) => void;
  flash: string | null;
  onOpen: (id: string) => void;
  onCreate: (prefill?: string) => void;
}) {
  const used = useMemo(() => musclesInUse(exercises, MUSCLE_GROUPS), [exercises]);
  const { base, personal } = useMemo(
    () => filterExercises(filterByMuscle(exercises, muscle === ALL ? null : muscle), query),
    [exercises, muscle, query],
  );
  const nPersonal = exercises.filter((e) => isPersonalExercise(e.ownerId)).length;
  const typed = query.trim();
  const shown = base.length + personal.length;
  const filtered = typed !== '' || muscle !== ALL;

  const row = (exo: ListExercise) => (
    <Row
      key={exo.id}
      title={exo.name}
      meta={musclesLine(exo)}
      value={
        overridden.has(exo.id) ? <span className="text-[14px] font-normal text-muted">ta version</span> : undefined
      }
      onClick={() => onOpen(exo.id)}
      ariaLabel={overridden.has(exo.id) ? `${exo.name}, ta version` : undefined}
    />
  );

  return (
    <Page
      bottom={
        <PrimaryButton onClick={() => onCreate(typed && shown === 0 ? typed : undefined)}>Créer un exo perso</PrimaryButton>
      }
    >
      <ScreenHeader title="Exercices" meta={`${exos(exercises.length)} · ${nPersonal} perso`} />

      {flash && <Flash>{flash}</Flash>}

      <div className="flex items-center gap-2 px-5">
        <TextField
          label="Chercher un exo"
          hideLabel
          value={query}
          onChange={onQuery}
          placeholder="Chercher un exo"
          inputMode="search"
          enterKeyHint="search"
          className="min-w-0 flex-1"
        />
        {query && (
          <TextLink tone="muted" onClick={() => onQuery('')} className="px-1">
            Effacer
          </TextLink>
        )}
      </div>

      {used.length > 1 && (
        <div className="mt-1 overflow-x-auto px-3 [scrollbar-width:none]">
          <Choice
            label="Muscle principal"
            wrap={false}
            value={muscle}
            onChange={onMuscle}
            options={[{ value: ALL, label: 'Tous' }, ...used.map((m) => ({ value: m, label: capitalize(m) }))]}
          />
        </div>
      )}

      {shown === 0 ? (
        <EmptyState
          title={typed ? `Rien pour « ${typed} »` : 'Aucun exo pour ce muscle'}
          body={typed ? 'Vérifie l’orthographe, ou crée-le : il sera visible de toi seul.' : undefined}
          action={typed ? <SecondaryButton onClick={() => onCreate(typed)}>Créer « {typed} »</SecondaryButton> : undefined}
        />
      ) : (
        <>
          <SectionTitle aside={personal.length ? String(personal.length) : undefined}>Tes exos</SectionTitle>
          {personal.length ? (
            <List label="Tes exos">{personal.map(row)}</List>
          ) : (
            <p className="border-t border-line px-5 py-3 text-[15px] text-muted">
              {filtered ? 'Aucun de tes exos ne correspond.' : 'Pas encore d’exo perso. Le bouton du bas en crée un.'}
            </p>
          )}
          <SectionTitle aside={String(base.length)}>Catalogue commun</SectionTitle>
          {base.length ? (
            <List label="Catalogue commun">{base.map(row)}</List>
          ) : (
            <p className="border-t border-line px-5 py-3 text-[15px] text-muted">Aucun exo de base ne correspond.</p>
          )}
          <p className="px-5 pt-3 text-[14px] leading-[1.45] text-faint">
            Un exo de base se personnalise pour toi seul : le catalogue commun ne change pas pour les autres.
          </p>
        </>
      )}
    </Page>
  );
}

// --- Fiche ------------------------------------------------------------------

type NoteLoad = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; body: string };

function Fiche({
  exo,
  overridden,
  flash,
  onBack,
  onEdit,
  onFlash,
  onLoadNote,
  onSaveNote,
  onResetOverride,
  onDelete,
}: {
  exo: ListExercise;
  overridden: boolean;
  flash: string | null;
  onBack: () => void;
  onEdit: () => void;
  onFlash: (message: string | null) => void;
  onLoadNote: (exerciseId: string) => Promise<string>;
  onSaveNote: (exerciseId: string, body: string) => Promise<void>;
  onResetOverride: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const base = !isPersonalExercise(exo.ownerId);
  const [note, setNote] = useState<NoteLoad>({ phase: 'loading' });
  const [noteAttempt, setNoteAttempt] = useState(0);
  const [draft, setDraft] = useState<string | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [guard, setGuard] = useState<null | 'reset' | 'delete'>(null);
  const [guardBusy, setGuardBusy] = useState(false);
  const [guardError, setGuardError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void onLoadNote(exo.id)
      .then((body) => active && setNote({ phase: 'ready', body }))
      .catch((err: unknown) => active && setNote({ phase: 'error', message: errorMessage(err) }));
    return () => {
      active = false;
    };
  }, [exo.id, onLoadNote, noteAttempt]);

  const saved = note.phase === 'ready' ? note.body : '';
  // Note en cours d'écriture : aucun rechargement automatique ne la jette.
  const releaseNote = useReloadBlockWhile(NOTE_DRAFT_BLOCK, draft !== null && draft !== saved);

  async function saveNote() {
    if (draft === null) return;
    setNoteBusy(true);
    setNoteError(null);
    try {
      await onSaveNote(exo.id, draft);
      setNote({ phase: 'ready', body: draft.trim() });
      releaseNote();
      setDraft(null);
      onFlash(draft.trim() ? 'Note enregistrée.' : 'Note effacée.');
    } catch (err) {
      setNoteError(errorMessage(err));
    } finally {
      setNoteBusy(false);
    }
  }

  async function runGuard(action: () => Promise<void>) {
    setGuardBusy(true);
    setGuardError(null);
    try {
      await action();
      setGuard(null);
    } catch (err) {
      // Suppression refusée (exo encore utilisé, cf. deletion-guard) ou échec
      // réseau : la phrase reste sous la confirmation.
      setGuardError(errorMessage(err));
    } finally {
      setGuardBusy(false);
    }
  }

  // Ce que l'appareil sait déjà de son usage (copies de la Salle) ; le refus du
  // serveur reste le filet pour une séance jamais ouverte ici.
  const usedIn = guard === 'delete' ? seancesUsing(exo.id, localTemplates()) : [];

  const openGuard = (g: 'reset' | 'delete') => {
    setGuard(g);
    setGuardError(null);
    onFlash(null);
  };

  const origin = base
    ? overridden
      ? 'Ta version d’un exo de base'
      : 'Exo de base, catalogue commun'
    : 'Exo perso, visible de toi seul';

  return (
    <Page>
      <ScreenHeader
        title={exo.name}
        meta={origin}
        back={{ label: 'Exercices', onClick: onBack }}
        action={
          <SecondaryButton size="sm" onClick={onEdit}>
            {base ? (overridden ? 'Modifier ta version' : 'Personnaliser') : 'Modifier'}
          </SecondaryButton>
        }
      />

      {flash && <Flash>{flash}</Flash>}

      <div className="border-t border-line">
        <Line label="Muscles">{musclesOf(exo).map((m) => keepTogether(capitalize(m))).join(', ') || 'aucun'}</Line>
        <Line label="Mouvement" sub={exo.unilateral ? 'un côté à la fois, gauche et droite saisis à part' : undefined}>
          {exo.unilateral ? 'unilatéral' : 'bilatéral'}
        </Line>
      </div>

      <section>
        <div className="flex min-h-11 items-center justify-between gap-3 px-5 pb-1 pt-5">
          <h2 className="text-[17px] font-semibold text-ink">Note d’instructions</h2>
          {draft === null && note.phase === 'ready' && (
            <IconButton
              icon="edit"
              framed
              label={note.body ? 'Modifier la note' : 'Écrire une note'}
              onClick={() => {
                setDraft(note.body);
                setNoteError(null);
                onFlash(null);
              }}
            />
          )}
        </div>
        <div className="px-5">
          {note.phase === 'loading' ? (
            <p role="status" className="text-[15px] text-muted">
              Chargement de la note…
            </p>
          ) : note.phase === 'error' ? (
            <div>
              <Alert>Impossible de charger la note : {note.message}</Alert>
              <SecondaryButton className="mt-3" onClick={() => {
                setNote({ phase: 'loading' });
                setNoteAttempt((n) => n + 1);
              }}>
                Réessayer
              </SecondaryButton>
            </div>
          ) : draft !== null ? (
            <>
              <TextArea
                label="Note d’instructions"
                hideLabel
                value={draft}
                onChange={setDraft}
                placeholder="Réglages de la machine, placement, consignes"
              />
              <p className="mt-1.5 text-[14px] leading-[1.4] text-muted">
                Elle t’appartient : la modifier ne personnalise pas l’exo.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                <SecondaryButton onClick={() => void saveNote()} disabled={noteBusy}>
                  {noteBusy ? 'Enregistrement…' : 'Enregistrer la note'}
                </SecondaryButton>
                <TextLink
                  tone="muted"
                  onClick={
                    noteBusy
                      ? undefined
                      : () => {
                          releaseNote();
                          setDraft(null);
                          setNoteError(null);
                        }
                  }
                >
                  Annuler
                </TextLink>
              </div>
              {noteError && (
                <p role="alert" className="mt-2 break-words text-[15px] leading-[1.4] text-ink">
                  {noteError}
                </p>
              )}
            </>
          ) : note.body ? (
            <p className="max-w-[36ch] whitespace-pre-line text-[16px] leading-[1.5] text-ink">{note.body}</p>
          ) : (
            <p className="text-[15px] leading-[1.45] text-muted">Aucune. Elle se lit en salle, dans les notes de l’exo.</p>
          )}
        </div>
      </section>

      {(!base || overridden) && (
        <section className="pt-8">
          {guard === 'reset' ? (
            <Confirm
              destructive
              keepLabel="Garder ta version"
              confirmLabel="Revenir à l’exo de base"
              busy={guardBusy}
              error={guardError}
              onCancel={() => setGuard(null)}
              onConfirm={() => void runGuard(onResetOverride)}
            >
              <p className="font-medium">Revenir à la version de base ?</p>
              <p className="mt-1 text-muted">Ton nom, tes muscles et ton réglage du mouvement sont retirés. Ta note et ton historique restent.</p>
            </Confirm>
          ) : guard === 'delete' && usedIn.length > 0 ? (
            <div role="alert" className="mx-5 border-y border-line py-3">
              <p className="text-[15px] leading-[1.45] text-ink">
                Il figure dans {usedIn.join(', ')} : retire-le d’abord de {usedIn.length > 1 ? 'ces séances' : 'cette séance'}.
              </p>
              <div className="mt-3">
                <SecondaryButton onClick={() => setGuard(null)}>Compris</SecondaryButton>
              </div>
            </div>
          ) : guard === 'delete' ? (
            <Confirm
              destructive
              keepLabel="Garder"
              confirmLabel="Supprimer définitivement"
              busy={guardBusy}
              error={guardError}
              onCancel={() => setGuard(null)}
              onConfirm={() => void runGuard(onDelete)}
            >
              <p className="font-medium">Supprimer « {exo.name} » ?</p>
              <p className="mt-1 text-muted">
                Ce geste ne se défait pas.
              </p>
            </Confirm>
          ) : (
            <div className="px-5">
              <SecondaryButton onClick={() => openGuard(base ? 'reset' : 'delete')}>
                {base ? 'Revenir à l’exo de base' : 'Supprimer cet exo'}
              </SecondaryButton>
              <p className="mt-2 text-[14px] leading-[1.4] text-faint">
                {base
                  ? 'Ta version est retirée ; l’exo reprend son nom et ses muscles communs.'
                  : 'Seul un exo qui n’a jamais servi peut se supprimer.'}
              </p>
            </div>
          )}
        </section>
      )}
    </Page>
  );
}

// --- Pièces locales ---------------------------------------------------------

/** Une page de l'onglet : écran du kit, contenu centré (lisible sur PC aussi). */
function Page({ children, bottom }: { children: ReactNode; bottom?: ReactNode }) {
  return (
    <Screen bottom={bottom}>
      <div className="mx-auto w-full max-w-2xl pb-16">{children}</div>
    </Screen>
  );
}

/** Ligne de la fiche : libellé gris à gauche, valeur à droite. */
function Line({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-baseline justify-between gap-4 border-b border-line px-5 py-3">
      <span className="flex-none text-[16px] text-muted">{label}</span>
      <span className="min-w-0 text-right">
        <span className="block text-[16px] text-ink first-letter:uppercase">{children}</span>
        {sub && <span className="mt-0.5 block text-[14px] text-faint">{sub}</span>}
      </span>
    </div>
  );
}

/** Confirmation du dernier geste : entre deux filets, sans couleur. */
function Flash({ children }: { children: ReactNode }) {
  return (
    <Alert role="status" label={null} className="mx-5 mb-4">
      {children}
    </Alert>
  );
}

/** Un exo qui n'existe plus (supprimé entre-temps). */
function Missing({ onBack }: { onBack: () => void }) {
  return (
    <Page>
      <ScreenHeader title="Exercice introuvable" back={{ label: 'Exercices', onClick: onBack }} />
      <EmptyState title="Cet exercice n’existe plus." body="Il a peut-être été supprimé depuis un autre appareil." />
    </Page>
  );
}
