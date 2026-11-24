// Formulaire de saisie d'un exo perso, PARTAGÉ entre la création (sélecteur
// d'ajout d'une séance, SeanceEditor) et la création/édition de l'onglet
// « Exercices » (issue #49), qui s'en sert aussi pour personnaliser un exo de
// base (override, ADR 0007). Un seul endroit pour : nom (texte), LISTE de
// muscles principaux (au moins un, cases à cocher) et mouvement (Bilatéral ou
// Unilatéral, choix en mots).
//
// Deux mises en page, une seule logique :
//   - `frame` fourni : un écran entier (en-tête nommé, retour, action principale
//     dans la barre collée du bas) ; l'onglet « Exercices » ;
//   - sans `frame` : un bloc posé dans le flux d'un autre écran, l'action en
//     bouton secondaire et « Annuler » en lien (l'écran hôte garde son bouton
//     principal) ; l'éditeur de séance. Le bloc porte lui-même la marge d'écran
//     (px-5) et ses filets vont bord à bord : l'hôte le pose sans marge.
//
// Kit E (DESIGN.md) : aucun signal ; une case cochée est un carré blanc cassé
// plein ET un nom en demi-gras, jamais la couleur seule ; cibles de 48 px ;
// aucun tiret long affiché. Les erreurs s'affichent sous le champ fautif après
// un premier essai, au lieu d'un bouton éteint sans explication.
//
// Validation mutualisée avec la couche data via validatePersonalExercise
// (exercise-input.ts) : une seule source de vérité pour le message.
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  MUSCLE_GROUPS,
  toggleMuscle,
  validatePersonalExercise,
} from '../authoring/exercise-input';
import { NoteField } from '../notes/NoteField';
import { useReloadBlockWhile } from '../../pwa/useReloadBlockWhile';
import { errorMessage } from '../../lib/error-message';
import {
  CheckBox,
  Choice,
  FieldError,
  ImplicitSubmit,
  PrimaryButton,
  Screen,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  TextField,
  TextLink,
} from '../../ui';

/** Raison du blocage de rechargement tenu par un formulaire d'exo modifié et non enregistré. */
const EXERCISE_DRAFT_BLOCK = 'brouillon-exercice';

/** Saisie d'un exo perso : nom, muscles principaux (canoniques), unilatéral. */
export interface ExerciseFormValue {
  name: string;
  primaryMuscles: string[];
  unilateral: boolean;
}

export interface ExerciseFormProps {
  /** Valeurs de départ (édition). Absent = formulaire de création vide. */
  initial?: ExerciseFormValue;
  /** Libellé du bouton primaire (ex. « Créer et ajouter », « Enregistrer »). */
  submitLabel: string;
  /** Libellé pendant l'enregistrement (ex. « Création… », « Enregistrement… »). */
  submitBusyLabel: string;
  /**
   * Note d'instructions de l'exo (exercise_notes #26), éditée DANS le formulaire
   * d'édition. `undefined` = pas de champ note (flux de création : l'exo n'existe
   * pas encore, la note se pose ensuite par « Modifier »). `''` = note vide éditable.
   */
  initialNote?: string;
  /**
   * Soumission validée. Reçoit la note SEULEMENT quand `initialNote` est fourni
   * (sinon `undefined`). Résolu = enregistré (le parent ferme alors le form).
   */
  onSubmit: (value: ExerciseFormValue, note?: string) => Promise<void>;
  /** Retour sans enregistrer. */
  onCancel: () => void;
  /** Donne le focus au champ nom au montage (création surtout). Défaut true. */
  autoFocusName?: boolean;
  /**
   * Écran entier : titre, ligne sous le titre et libellé du retour (qui vaut
   * « Annuler »). Absent : bloc dans le flux de l'écran hôte.
   */
  frame?: { title: string; meta?: ReactNode; backLabel: string };
  /** Nom de départ d'une création (la recherche qui n'a rien trouvé). */
  prefillName?: string;
}

export function ExerciseForm({
  initial,
  submitLabel,
  submitBusyLabel,
  initialNote,
  onSubmit,
  onCancel,
  autoFocusName = true,
  frame,
  prefillName,
}: ExerciseFormProps) {
  const startName = initial?.name ?? prefillName ?? '';
  const [name, setName] = useState(startName);
  const [muscles, setMuscles] = useState<string[]>(initial?.primaryMuscles ?? []);
  const [unilateral, setUnilateral] = useState(initial?.unilateral ?? false);
  const [note, setNote] = useState(initialNote ?? '');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasNote = initialNote !== undefined;

  // Saisie en cours (création ou édition) : aucun rechargement automatique tant
  // qu'elle ne vit qu'en mémoire. Levé au démontage (le parent ferme le
  // formulaire) ; `releaseDraft` le lève tout de suite à l'enregistrement réussi
  // et à l'annulation (cf. pwa/useReloadBlockWhile). Un nom pré-rempli par la
  // recherche ne compte pas comme une saisie.
  const dirty =
    name !== startName ||
    muscles.join('\n') !== (initial?.primaryMuscles ?? []).join('\n') ||
    unilateral !== (initial?.unilateral ?? false) ||
    note !== (initialNote ?? '');
  const releaseDraft = useReloadBlockWhile(EXERCISE_DRAFT_BLOCK, dirty);

  const trimmed = name.trim();
  // Chaque message sous son champ, tirés de la même validation que la couche
  // data : le nom seul (muscles supposés bons), puis les muscles seuls.
  const nameError = tried ? validatePersonalExercise({ name: trimmed, primaryMuscles: [MUSCLE_GROUPS[0]] }) : null;
  const muscleError = tried ? validatePersonalExercise({ name: 'x', primaryMuscles: muscles }) : null;

  async function submit() {
    if (busy) return;
    setTried(true);
    // validatePersonalExercise renvoie null quand la saisie est valide.
    if (validatePersonalExercise({ name: trimmed, primaryMuscles: muscles }) !== null) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(
        { name: trimmed, primaryMuscles: muscles, unilateral },
        hasNote ? note : undefined,
      );
      // Succès : le parent ferme le formulaire, pas de reset nécessaire ici.
      releaseDraft();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const cancel = () => {
    releaseDraft();
    onCancel();
  };

  const fields = (
    <>
      <TextField
        label="Nom"
        value={name}
        onChange={setName}
        error={nameError}
        autoFocus={autoFocusName}
        enterKeyHint="done"
        maxLength={80}
        className="px-5"
      />

      <div
        className="mt-2 flex min-h-14 flex-wrap items-center justify-between gap-x-3 border-b border-line py-1.5 pl-5 pr-2.5"
      >
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold text-ink">Mouvement</span>
          <span className="block text-[14px] text-muted">
            {unilateral ? 'un côté à la fois, gauche et droite saisis à part' : 'les deux côtés ensemble'}
          </span>
        </span>
        <Choice
          label="Mouvement"
          value={unilateral ? 'uni' : 'bi'}
          onChange={(v) => setUnilateral(v === 'uni')}
          options={[
            { value: 'bi', label: 'Bilatéral' },
            { value: 'uni', label: 'Unilatéral' },
          ]}
          wrap={false}
          className="-ml-2.5"
        />
      </div>

      <div>
        <SectionTitle
          id="exercise-form-muscles"
          aside={muscles.length === 0 ? 'aucun' : `${muscles.length} choisi${muscles.length > 1 ? 's' : ''}`}
        >
          Muscles principaux
        </SectionTitle>
        <p className="px-5 text-[14px] leading-[1.45] text-muted">
          Ceux que l’exo cible en priorité. Pas de muscle secondaire : il compte ou il ne compte pas.
        </p>
        {muscleError && (
          <div className="px-5">
            <FieldError>{muscleError}</FieldError>
          </div>
        )}
        <div role="group" aria-labelledby="exercise-form-muscles" className="mt-2 grid grid-cols-2 border-t border-line">
          {MUSCLE_GROUPS.map((m, i) => {
            const on = muscles.includes(m);
            return (
              <button
                key={m}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => setMuscles((prev) => toggleMuscle(prev, m))}
                className={`flex min-h-12 items-center gap-3 border-b border-line py-2 text-left active:bg-line ${
                  i % 2 === 0 ? 'pl-5 pr-2' : 'pl-3 pr-5'
                }`}
              >
                <CheckBox checked={on} />
                <span className={`min-w-0 text-[16px] first-letter:uppercase ${on ? 'font-semibold text-ink' : 'text-muted'}`}>{m}</span>
              </button>
            );
          })}
          {MUSCLE_GROUPS.length % 2 === 1 && <span aria-hidden className="border-b border-line" />}
        </div>
      </div>

      {hasNote && (
        <div className="px-5 pt-5">
          <NoteField
            id="exercise-form-note"
            label="Note de l'exercice"
            hint="Tes repères techniques. Visibles en référence pendant la séance."
            placeholder="Prise serrée, coudes rentrés…"
            value={note}
            onChange={setNote}
          />
        </div>
      )}
    </>
  );

  const errorLine = error && (
    <p role="alert" className="break-words border-l-[3px] border-ink pl-3 text-[15px] leading-[1.45] text-ink">
      {error}
    </p>
  );

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  if (frame) {
    return (
      <form className="flex flex-1 flex-col" noValidate onSubmit={onFormSubmit}>
        <ImplicitSubmit />
        <Screen
          bottom={
            <>
              {errorLine}
              <PrimaryButton onClick={() => void submit()} disabled={busy}>
                {busy ? submitBusyLabel : submitLabel}
              </PrimaryButton>
            </>
          }
        >
          <ScreenHeader title={frame.title} meta={frame.meta} back={{ label: frame.backLabel, onClick: cancel }} />
          {fields}
        </Screen>
      </form>
    );
  }

  return (
    <form noValidate onSubmit={onFormSubmit}>
      <ImplicitSubmit />
      {fields}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 px-5">
        <SecondaryButton onClick={() => void submit()} disabled={busy}>
          {busy ? submitBusyLabel : submitLabel}
        </SecondaryButton>
        <TextLink tone="muted" onClick={busy ? undefined : cancel}>
          Annuler
        </TextLink>
      </div>
      {error && <div className="mt-3 px-5">{errorLine}</div>}
    </form>
  );
}
