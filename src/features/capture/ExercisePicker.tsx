// Sommaire de la séance : « je touche l'exo que j'attaque » (ordre libre).
//
// Une ligne par exo : son nom (en entier, sur deux lignes au besoin), sa marque
// d'état avec son mot, le plan, le compte de séries ; la toucher ouvre l'exo.
// À droite, selon l'état de l'exo :
//   - pas commencé : ⋯ « Remplacer » ou « Passer » (un trou assumé) ;
//   - en cours : ⋯ « Remplacer » seul. Ses séries lui restent, le remplaçant
//     s'insère juste après lui, marqué « remplacé » (`replaceExercise`) ;
//   - fait : rien (remplacer un exo fini serait un ajout) ;
//   - passé : le lien « Remettre » (`restoreSkippedExercise`).
// On peut aussi AJOUTER un exo hors plan. La séance courante évolue, le template
// versionné reste intact.
//
// En bas, « Terminer la séance » dès qu'une série est loggée. Quitter la séance
// sans la ranger (`leaveSession`) se dit « Changer de séance » tant que rien
// n'est saisi (sans confirmation : rien à perdre), « Annuler la séance » sinon,
// confirmé : l'option sûre est le bouton (« Garder la séance »), la perte un
// lien, sous une phrase qui dit ce qui part. Un exo ajouté ou remplacé compte
// comme saisi.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExerciseRow } from './data';
import type { Session, SessionExercise } from './fixtures';
import type { CaptureState } from './state';
import { getProgress } from './state';
import { deriveExerciseDeviations } from './session-edit';
import { formatRange } from './format';
import { foldAccents } from '../../domain/text';
import { isBlankNote } from '../../domain/notes';
import { errorMessage } from '../../lib/error-message';
import {
  Alert,
  BottomBar,
  EmptyState,
  Icon,
  IconButton,
  List,
  PrimaryButton,
  Row,
  ScreenHeader,
  SecondaryButton,
  Sheet,
  StateMark,
  Status,
  TextLink,
  type ExoState,
} from '../../ui';
import type { Side } from '../../domain/types';
import { buildSessionRecap } from './session-recap';
import { EXO_STATE_WORD, exoState, logicalSetsDone } from './salle-progress';

interface ExercisePickerProps {
  session: Session;
  /** Ids des exos du template d'origine (réf. du diff de déviations, figée). */
  templateExerciseIds: string[];
  state: CaptureState;
  /** Exos faits (un exo passé n'en fait pas partie). */
  done: number;
  /** Exos passés, dits à part. */
  skipped: number;
  /** Séance d'un jour passé restée ouverte (« hier »), ou null. */
  staleSince: string | null;
  /** Au moins une série loggée : la séance peut se terminer. */
  canFinish: boolean;
  onPick: (exerciseId: string) => void;
  /** Passe un exo (un trou assumé, jamais un oubli). */
  onSkip: (exerciseId: string) => void;
  /** Ouvre la fin de séance. */
  onFinish: () => void;
  /** Charge le catalogue (base + perso) à l'ouverture du sélecteur d'ajout. */
  loadCatalog: () => Promise<ExerciseRow[]>;
  /** Charge un exo du catalogue prêt à entrer dans la séance (réf. + records). */
  loadCatalogExercise: (row: Pick<ExerciseRow, 'id' | 'name'>) => Promise<SessionExercise>;
  /** Ajoute l'exo choisi à la séance courante. */
  onAddExercise: (exercise: SessionExercise) => void;
  /** Remplace `targetExerciseId` par l'exo choisi. */
  onSwapExercise: (targetExerciseId: string, replacement: SessionExercise) => void;
  /** Remet un exo passé dans la séance. */
  onRestore: (exerciseId: string) => void;
  /** 'change' : rien n'est saisi (« Changer de séance »). 'cancel' : « Annuler la séance », confirmé. */
  leaveKind: 'change' | 'cancel';
  /**
   * Quitte la séance sans la ranger et revient à l'écran de lancement (ADR
   * 0011). `confirmed` : l'utilisateur a confirmé l'annulation. Rend `false`
   * sans rien faire si le geste demande une confirmation qu'il n'a pas reçue.
   */
  onLeaveSession: (confirmed: boolean) => boolean;
}

/** Cible de l'ouverture du catalogue : ajout libre, ou remplacement d'un exo. */
type CatalogTarget = { mode: 'add' } | { mode: 'swap'; exerciseId: string; name: string };

export function ExercisePicker({
  session,
  templateExerciseIds,
  state,
  done,
  skipped,
  staleSince,
  canFinish,
  onPick,
  onSkip,
  onFinish,
  loadCatalog,
  loadCatalogExercise,
  onAddExercise,
  onSwapExercise,
  onRestore,
  leaveKind,
  onLeaveSession,
}: ExercisePickerProps) {
  const total = session.exercises.length;

  // Déviations d'exo (ajout / swap) dérivées par diff : par exerciseId.
  const deviationByExercise = useMemo(() => {
    const map = new Map<string, 'added' | 'swapped'>();
    for (const dev of deriveExerciseDeviations(templateExerciseIds, session)) map.set(dev.exerciseId, dev.kind);
    return map;
  }, [templateExerciseIds, session]);

  // Séries battues et côté resté seul, par exo : le même calcul que la fin de séance.
  const recapById = useMemo(
    () => new Map(buildSessionRecap(session, state).exercises.map((e) => [e.exerciseId, e] as const)),
    [session, state],
  );

  const [catalog, setCatalog] = useState<CatalogTarget | null>(null);
  // Les options d'un exo pas fait : `done` = séries déjà faites (« Passer » disparaît).
  const [options, setOptions] = useState<{ exerciseId: string; name: string; done: number } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Fermetures stables : une feuille refocalise son titre quand `onClose`
  // change ; un rendu du Sommaire (envoi acquitté) volerait sinon le focus du
  // champ de recherche du catalogue.
  const closeOptions = useCallback(() => setOptions(null), [setOptions]);
  const closeConfirm = useCallback(() => setConfirmCancel(false), [setConfirmCancel]);
  const closeCatalog = useCallback(() => setCatalog(null), [setCatalog]);

  const leave = () => {
    // « Changer » part sans confirmation, sauf si une saisie est arrivée
    // d'ailleurs entre-temps : le geste la demande alors.
    if (leaveKind === 'cancel' || !onLeaveSession(false)) setConfirmCancel(true);
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1">
        <ScreenHeader
          title={session.name}
          meta={`${done} sur ${total} faits${skipped > 0 ? ` · ${skipped} passé${skipped > 1 ? 's' : ''}` : ''}${done + skipped === total && total > 0 ? ' · tous les exos sont réglés' : ''}`}
        />

        {/* Séance d'un jour passé restée ouverte : on le dit, avec ses sorties. */}
        {staleSince && (
          // Un avis dans un bloc levé arrondi, sans trait latéral (plancher :
          // aucune barre sur un seul côté d'un bloc), au-dessus de la liste.
          <div role="status" className="mx-4 mb-4 rounded-note bg-surface px-4 pb-4 pt-3">
            <p className="text-[15px] leading-[1.45] text-ink">Cette séance date d’{staleSince} et n’a pas été terminée.</p>
            <p className="mt-1 text-[14px] leading-[1.45] text-muted">
              {canFinish
                ? 'Termine-la pour la ranger (sa durée ne sera pas comptée si elle n’est plus mesurable), ou annule-la.'
                : 'Annule-la pour en démarrer une autre.'}
            </p>
            {canFinish && (
              <SecondaryButton size="sm" className="mt-3" onClick={onFinish}>
                Terminer cette séance
              </SecondaryButton>
            )}
          </div>
        )}

        {total === 0 ? (
          <EmptyState title="Aucun exercice dans cette séance." />
        ) : (
          <List label="Exercices de la séance">
            {session.exercises.map((ex, i) => {
              const progress = getProgress(state, ex.exerciseId);
              const st = exoState(progress, ex.prescription.sets.min);
              const count = logicalSetsDone(progress);
              const deviation = deviationByExercise.get(ex.exerciseId) ?? null;
              // Lignes loggées (un côté seul compte) : un exo entamé ne se passe plus.
              const started = progress.sets.length;
              const plan = `${formatRange(ex.prescription.sets)} × ${formatRange(ex.prescription.reps)} · RIR ${formatRange(ex.prescription.rir)}`;
              return (
                <Row
                  key={ex.exerciseId}
                  lead={i + 1}
                  title={ex.name}
                  muted={st === 'skipped'}
                  ariaLabel={`Ouvrir ${ex.name}`}
                  onClick={() => onPick(ex.exerciseId)}
                  meta={
                    <SommaireMeta
                      state={st}
                      count={count}
                      min={ex.prescription.sets.min}
                      plan={plan}
                      origin={deviation === 'added' ? 'ajouté' : deviation === 'swapped' ? 'remplacé' : null}
                      openSide={recapById.get(ex.exerciseId)?.openSide ?? null}
                      beaten={recapById.get(ex.exerciseId)?.beaten ?? 0}
                    />
                  }
                  trailing={
                    st === 'skipped' ? (
                      // « Remettre », pas « Reprendre » : « Reprendre » est le retour à l'instrument.
                      <TextLink tone="muted" className="-mr-1 px-1 text-[15px]" ariaLabel={`Remettre ${ex.name} dans la séance`} onClick={() => onRestore(ex.exerciseId)}>
                        Remettre
                      </TextLink>
                    ) : st === 'done' ? undefined : (
                      <IconButton
                        icon="more"
                        tone="muted"
                        className="-mr-2.5"
                        label={started === 0 ? `Remplacer ou passer ${ex.name}` : `Remplacer ${ex.name}`}
                        onClick={() => setOptions({ exerciseId: ex.exerciseId, name: ex.name, done: started })}
                      />
                    )
                  }
                />
              );
            })}
          </List>
        )}

        {/* Ajouter un exo hors plan (issue #36). */}
        <div className="px-5 pt-4">
          <SecondaryButton onClick={() => setCatalog({ mode: 'add' })} ariaLabel="Ajouter un exercice" className="w-full">
            Ajouter un exercice
          </SecondaryButton>
        </div>
        <div className="px-5 pt-2">
          <TextLink tone="muted" onClick={leave}>
            {leaveKind === 'change' ? 'Changer de séance' : 'Annuler la séance'}
          </TextLink>
        </div>
      </div>

      {canFinish && (
        <BottomBar>
          <PrimaryButton onClick={onFinish}>Terminer la séance</PrimaryButton>
        </BottomBar>
      )}

      <Sheet open={options !== null} title={options?.name ?? ''} onClose={closeOptions}>
        {options && (
          <div className="flex flex-col gap-2 px-5 pb-2">
            {options.done > 0 && (
              <p className="max-w-[36ch] pb-1 text-[15px] leading-[1.45] text-muted">
                {options.done > 1 ? `Les ${options.done} séries faites restent` : 'La série faite reste'} sur {options.name}. Le remplaçant se place juste après.
              </p>
            )}
            <SecondaryButton
              ariaLabel={`Remplacer ${options.name}`}
              onClick={() => {
                setCatalog({ mode: 'swap', exerciseId: options.exerciseId, name: options.name });
                setOptions(null);
              }}
            >
              Remplacer
            </SecondaryButton>
            {options.done === 0 && (
              <SecondaryButton
                ariaLabel={`Passer ${options.name}`}
                onClick={() => {
                  onSkip(options.exerciseId);
                  setOptions(null);
                }}
              >
                Passer
              </SecondaryButton>
            )}
            {options.done === 0 && (
              <p className="pt-1 text-[14px] leading-[1.45] text-muted">
                Passé, l’exo compte comme un trou assumé dans le bilan, pas comme un oubli.
              </p>
            )}
          </div>
        )}
      </Sheet>

      <Sheet
        open={confirmCancel}
        title="Annuler la séance ?"
        onClose={closeConfirm}
      >
        {/* Comme la confirmation d'une série : la phrase, puis sur une rangée
            l'option sûre en bouton et la perte en lien. */}
        <div className="px-5 pb-2 pt-1">
          <p className="max-w-[36ch] text-[16px] leading-[1.45] text-ink">{lossText(session, state)}</p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <SecondaryButton onClick={closeConfirm}>Garder la séance</SecondaryButton>
            <TextLink
              tone="muted"
              ariaLabel="Confirmer l’annulation de la séance"
              onClick={() => {
                setConfirmCancel(false);
                onLeaveSession(true);
              }}
            >
              Annuler la séance
            </TextLink>
          </div>
        </div>
      </Sheet>

      <CatalogSheet
        target={catalog}
        existingExerciseIds={session.exercises.map((e) => e.exerciseId)}
        loadCatalog={loadCatalog}
        loadCatalogExercise={loadCatalogExercise}
        onClose={closeCatalog}
        onChosen={(exercise) => {
          if (catalog?.mode === 'swap') onSwapExercise(catalog.exerciseId, exercise);
          else onAddExercise(exercise);
          setCatalog(null);
        }}
      />
    </div>
  );
}

/** Méta d'une ligne du Sommaire, UNE ligne : la prescription tant que l'exo est
 *  à faire, sinon sa marque d'état, son mot et son bilan (« en cours · 1 série
 *  sur 3 », « fait · 3 séries », le côté resté seul en unilatéral) ; la
 *  déviation (« ajouté », « remplacé ») en fin de cette même ligne ; les séries
 *  battues en signal. La prescription se relit dans l'instrument. */
function SommaireMeta({
  state,
  count,
  min,
  plan,
  origin,
  openSide,
  beaten,
}: {
  state: ExoState;
  count: number;
  min: number;
  plan: string;
  origin: string | null;
  openSide: Side | null;
  beaten: number;
}) {
  const series = (n: number) => `${n} série${n > 1 ? 's' : ''}`;
  const side = openSide ? `${openSide === 'left' ? 'gauche' : 'droite'} faite` : null;
  const tail = origin && <span className="font-normal text-muted"> · {origin}</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      {state === 'todo' ? (
        <span className="text-muted">
          {plan}
          {tail}
        </span>
      ) : (
        <StateMark state={state} size={14} className={state === 'skipped' ? 'text-muted' : 'font-medium text-ink'}>
          {state === 'skipped' && EXO_STATE_WORD.skipped}
          {state === 'partial' && ['en cours', count > 0 ? `${series(count)} sur ${min}` : null, side].filter(Boolean).join(' · ')}
          {state === 'done' && ['fait', series(count), side].filter(Boolean).join(' · ')}
          {tail}
        </StateMark>
      )}
      {beaten > 0 && <Status v="up" word={`${beaten} battue${beaten > 1 ? 's' : ''}`} />}
    </span>
  );
}

/** Ce qu'« Annuler la séance » fait perdre, en une phrase : les séries (ou les
 *  côtés saisis sans série complète) et les notes du jour, effacées ici et en
 *  base, puis les exos ajoutés et les remplacements, qui n'existent qu'ici. */
function lossText(session: Session, state: CaptureState): string {
  let sets = 0;
  let lines = 0;
  for (const ex of session.exercises) {
    const progress = getProgress(state, ex.exerciseId);
    sets += logicalSetsDone(progress);
    lines += progress.sets.length;
  }
  const plural = (n: number, one: string) => `${n} ${one}${n > 1 ? 's' : ''}`;
  const added = (state.layout ?? []).filter((e) => e.kind === 'added').length;
  const swapped = (state.layout ?? []).length - added;
  const parts = [
    sets > 0 ? plural(sets, 'série') : lines > 0 ? `${plural(lines, 'côté')} saisi${lines > 1 ? 's' : ''}` : null,
    Object.values(state.datedNotes).some((n) => !isBlankNote(n.body)) ? 'tes notes du jour' : null,
    added > 0 ? `${plural(added, 'exo')} ajouté${added > 1 ? 's' : ''}` : null,
    swapped > 0 ? plural(swapped, 'remplacement') : null,
  ].filter((p): p is string => p !== null);
  const what = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}` : (parts[0] ?? 'rien de saisi');
  return `Ce qui part : ${what}. Rien n’entre au journal.`;
}

// --- Feuille de sélection dans le catalogue ---------------------------------

/**
 * Choisir un exo du catalogue (base + perso) pour l'ajout ou le remplacement.
 * Charge le catalogue à l'ouverture, filtre par recherche, exclut les exos déjà
 * dans la séance (un remplacement garde sa cible exclue : on ne se remplace pas
 * par soi-même).
 */
function CatalogSheet({
  target,
  existingExerciseIds,
  loadCatalog,
  loadCatalogExercise,
  onClose,
  onChosen,
}: {
  target: CatalogTarget | null;
  existingExerciseIds: string[];
  loadCatalog: () => Promise<ExerciseRow[]>;
  loadCatalogExercise: (row: Pick<ExerciseRow, 'id' | 'name'>) => Promise<SessionExercise>;
  onClose: () => void;
  onChosen: (exercise: SessionExercise) => void;
}) {
  const title = target?.mode === 'swap' ? `Remplacer ${target.name}` : 'Ajouter un exercice';
  return (
    <Sheet open={target !== null} title={title} onClose={onClose}>
      {target && (
        <CatalogList
          mode={target.mode}
          existingExerciseIds={existingExerciseIds}
          loadCatalog={loadCatalog}
          loadCatalogExercise={loadCatalogExercise}
          onChosen={onChosen}
        />
      )}
    </Sheet>
  );
}

function CatalogList({
  mode,
  existingExerciseIds,
  loadCatalog,
  loadCatalogExercise,
  onChosen,
}: {
  /** Ajout ou remplacement : le toucher ajoute l'exo, ou remplace celui visé. */
  mode: CatalogTarget['mode'];
  existingExerciseIds: string[];
  loadCatalog: () => Promise<ExerciseRow[]>;
  loadCatalogExercise: (row: Pick<ExerciseRow, 'id' | 'name'>) => Promise<SessionExercise>;
  onChosen: (exercise: SessionExercise) => void;
}) {
  const [rows, setRows] = useState<ExerciseRow[] | null>(null);
  // Deux échecs distincts : le CHARGEMENT du catalogue (rien à lister, on propose
  // de réessayer) et le CHOIX d'un exo (la liste reste, on peut retaper).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  // Id de l'exo en cours de chargement (réf. + records) après un tap.
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await loadCatalog();
        if (!alive) return;
        setRows(data);
        setLoadError(null);
      } catch (err) {
        if (alive) setLoadError(errorMessage(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadCatalog, attempt]);

  const excluded = useMemo(() => new Set(existingExerciseIds), [existingExerciseIds]);
  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = foldAccents(query.trim());
    return rows
      .filter((r) => !excluded.has(r.id))
      .filter((r) => (q === '' ? true : foldAccents(r.name).includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [rows, excluded, query]);

  const handlePick = async (row: ExerciseRow) => {
    setPicking(row.id);
    setPickError(null);
    try {
      onChosen(await loadCatalogExercise({ id: row.id, name: row.name }));
    } catch (err) {
      setPickError(errorMessage(err));
      setPicking(null);
    }
  };

  return (
    <div className="pb-2">
      <div className="px-5 pb-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Chercher un exercice"
          aria-label="Chercher un exercice"
          className="field h-11 w-full rounded-block px-3 text-[16px]"
        />
      </div>
      {pickError && (
        <Alert className="mx-4 mb-3">{pickError}</Alert>
      )}
      {loadError ? (
        <div role="alert" className="px-4 py-4">
          <p className="break-words rounded-note bg-surface px-4 py-3 text-[15px] leading-[1.45] text-ink">
            <span className="font-semibold">Erreur : </span>
            {loadError}
          </p>
          <SecondaryButton
            className="mt-3"
            onClick={() => {
              setLoadError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Réessayer
          </SecondaryButton>
        </div>
      ) : rows === null ? (
        <p role="status" className="px-5 py-4 text-[15px] text-muted">
          Chargement du catalogue…
        </p>
      ) : filtered.length === 0 ? (
        <p className="px-5 py-4 text-[15px] text-muted">
          {query.trim() === '' ? 'Aucun exercice disponible.' : 'Aucun exercice ne correspond.'}
        </p>
      ) : (
        <List label="Catalogue">
          {filtered.map((row) => (
            <Row
              key={row.id}
              title={row.name}
              meta={row.unilateral ? 'unilatéral' : undefined}
              value={picking === row.id ? <span className="text-[14px] font-normal text-muted">chargement…</span> : undefined}
              // Le toucher ne mène nulle part, il choisit : pas de chevron
              // « ouvrir ». En ajout, un « + » à sa place, comme dans Séances.
              chevron={false}
              mark={mode === 'add' ? <Icon name="plus" /> : undefined}
              ariaLabel={`${mode === 'add' ? `Ajouter ${row.name} à la séance` : `Remplacer par ${row.name}`}${row.unilateral ? ', unilatéral' : ''}`}
              onClick={picking === null ? () => void handlePick(row) : undefined}
            />
          ))}
        </List>
      )}
    </div>
  );
}
