// Sommaire de la séance : « je touche l'exo que j'attaque » (ordre libre).
//
// Une ligne par exo : son nom (en entier, sur deux lignes au besoin), sa marque
// d'état avec son mot, le plan, le compte de séries ; la toucher ouvre l'exo.
// À droite, ⋯ ouvre ce qu'on peut faire de l'exo : le REMPLACER tant qu'il n'est
// pas commencé (issue #36), le PASSER (un trou assumé). On peut aussi AJOUTER un
// exo hors plan. La séance courante évolue, le template versionné reste intact.
//
// En bas, « Terminer la séance » dès qu'une série est loggée. « Annuler la
// séance » (ADR 0011) reste toujours possible, confirmé quand des séries
// seraient perdues : l'option sûre est le bouton (« Garder la séance »), la
// perte un lien qui la nomme.
import { useEffect, useMemo, useState } from 'react';
import type { ExerciseRow } from './data';
import type { Session, SessionExercise } from './fixtures';
import type { CaptureState } from './state';
import { getProgress } from './state';
import { deriveExerciseDeviations } from './session-edit';
import { formatRange } from './format';
import { foldAccents } from '../../domain/text';
import { errorMessage } from '../../lib/error-message';
import {
  BottomBar,
  EmptyState,
  IconButton,
  List,
  PrimaryButton,
  Row,
  ScreenHeader,
  SecondaryButton,
  Sheet,
  StateMark,
  TextLink,
} from '../../ui';
import { EXO_STATE_WORD, exoState, logicalSetsDone } from './salle-progress';

interface ExercisePickerProps {
  session: Session;
  /** Ids des exos du template d'origine (réf. du diff de déviations, figée). */
  templateExerciseIds: string[];
  state: CaptureState;
  /** Exos faits ou passés. */
  settled: number;
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
  /** Annule la séance : abandonne l'exécution et revient à l'écran de lancement (ADR 0011). */
  onCancelSession: () => void;
}

/** Cible de l'ouverture du catalogue : ajout libre, ou remplacement d'un exo. */
type CatalogTarget = { mode: 'add' } | { mode: 'swap'; exerciseId: string; name: string };

export function ExercisePicker({
  session,
  templateExerciseIds,
  state,
  settled,
  staleSince,
  canFinish,
  onPick,
  onSkip,
  onFinish,
  loadCatalog,
  loadCatalogExercise,
  onAddExercise,
  onSwapExercise,
  onCancelSession,
}: ExercisePickerProps) {
  const total = session.exercises.length;
  const loggedSets = session.exercises.reduce((n, ex) => n + getProgress(state, ex.exerciseId).sets.length, 0);

  // Déviations d'exo (ajout / swap) dérivées par diff : par exerciseId.
  const deviationByExercise = useMemo(() => {
    const map = new Map<string, 'added' | 'swapped'>();
    for (const dev of deriveExerciseDeviations(templateExerciseIds, session)) map.set(dev.exerciseId, dev.kind);
    return map;
  }, [templateExerciseIds, session]);

  const [catalog, setCatalog] = useState<CatalogTarget | null>(null);
  const [options, setOptions] = useState<{ exerciseId: string; name: string; canSwap: boolean; canSkip: boolean } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const cancel = () => {
    // Séance sans série : rien à perdre, l'annulation est immédiate.
    if (loggedSets === 0) onCancelSession();
    else setConfirmCancel(true);
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1">
        <ScreenHeader
          title={session.name}
          meta={`${settled} sur ${total} faits${settled === total && total > 0 ? ' · tous les exos sont réglés' : ''}`}
        />

        {/* Séance d'un jour passé restée ouverte : on le dit, avec ses sorties. */}
        {staleSince && (
          <div role="status" className="mx-5 mb-4 border-l-[3px] border-ink pl-3">
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
              // Remplacement autorisé tant que l'exo n'est pas entamé (aucune série,
              // pas passé) : la séance courante peut encore évoluer (issue #36).
              const canSwap = count === 0 && !progress.skipped;
              const canSkip = !progress.skipped;
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
                    <span className="flex flex-wrap items-center gap-x-2">
                      <StateMark state={st} size={14} className={st === 'todo' || st === 'skipped' ? '' : 'text-ink'}>
                        {EXO_STATE_WORD[st]}
                        {count > 0 && ` · ${count} sur ${formatRange(ex.prescription.sets)}`}
                      </StateMark>
                      <span>{plan}</span>
                      {deviation && <span>· {deviation === 'added' ? 'ajouté' : 'remplacé'}</span>}
                    </span>
                  }
                  trailing={
                    canSwap || canSkip ? (
                      <IconButton
                        icon="more"
                        tone="muted"
                        className="-mr-2.5"
                        label={`Options de ${ex.name}`}
                        onClick={() => setOptions({ exerciseId: ex.exerciseId, name: ex.name, canSwap, canSkip })}
                      />
                    ) : undefined
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
          <TextLink tone="muted" onClick={cancel}>
            Annuler la séance
          </TextLink>
        </div>
      </div>

      {canFinish && (
        <BottomBar>
          <PrimaryButton onClick={onFinish}>Terminer la séance</PrimaryButton>
        </BottomBar>
      )}

      <Sheet open={options !== null} title={options?.name ?? ''} onClose={() => setOptions(null)}>
        {options && (
          <div className="flex flex-col gap-2 px-5 pb-2">
            {options.canSwap && (
              <SecondaryButton
                ariaLabel={`Remplacer ${options.name}`}
                onClick={() => {
                  setCatalog({ mode: 'swap', exerciseId: options.exerciseId, name: options.name });
                  setOptions(null);
                }}
              >
                Remplacer
              </SecondaryButton>
            )}
            {options.canSkip && (
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
            <p className="pt-1 text-[14px] leading-[1.45] text-muted">
              Passé, l’exo compte comme un trou assumé dans le bilan, pas comme un oubli.
            </p>
          </div>
        )}
      </Sheet>

      <Sheet
        open={confirmCancel}
        title="Annuler la séance ?"
        onClose={() => setConfirmCancel(false)}
        footer={
          <>
            <SecondaryButton onClick={() => setConfirmCancel(false)}>Garder la séance</SecondaryButton>
            <TextLink
              tone="muted"
              className="self-center"
              ariaLabel="Confirmer l’annulation de la séance"
              onClick={() => {
                setConfirmCancel(false);
                onCancelSession();
              }}
            >
              Annuler et perdre {loggedSets} série{loggedSets > 1 ? 's' : ''}
            </TextLink>
          </>
        }
      >
        <p className="px-5 text-[16px] leading-[1.45] text-muted">
          {loggedSets} série{loggedSets > 1 ? 's' : ''} et les notes du jour de cette séance seront effacées, ici et en base.
        </p>
      </Sheet>

      <CatalogSheet
        target={catalog}
        existingExerciseIds={session.exercises.map((e) => e.exerciseId)}
        loadCatalog={loadCatalog}
        loadCatalogExercise={loadCatalogExercise}
        onClose={() => setCatalog(null)}
        onChosen={(exercise) => {
          if (catalog?.mode === 'swap') onSwapExercise(catalog.exerciseId, exercise);
          else onAddExercise(exercise);
          setCatalog(null);
        }}
      />
    </div>
  );
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
  existingExerciseIds,
  loadCatalog,
  loadCatalogExercise,
  onChosen,
}: {
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
        <p role="alert" className="mx-5 mb-3 border-l-[3px] border-ink pl-3 text-[15px] text-ink">
          {pickError}
        </p>
      )}
      {loadError ? (
        <div role="alert" className="px-5 py-4">
          <p className="border-l-[3px] border-ink pl-3 text-[15px] text-ink">{loadError}</p>
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
              onClick={picking === null ? () => void handlePick(row) : undefined}
            />
          ))}
        </List>
      )}
    </div>
  );
}
