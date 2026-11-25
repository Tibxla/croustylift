// Écran de premier lancement.
//
// Affiché à un utilisateur SANS routine (cf. App.tsx). Remplace l'ancienne
// création silencieuse de « Ma routine » / « Upper A » : ici l'utilisateur NOMME
// sa 1ʳᵉ routine et sa 1ʳᵉ séance, et choisit de partir d'un modèle pré-rempli
// (renommable) ou d'une séance vierge. Lève la confusion « je n'ai pas pu nommer
// ma routine » (issue #3).
//
// Au kit E : en-tête d'écran, champs du kit (les noms sont du texte libre, le
// clavier y est légitime), choix du point de départ en options à rond, un seul
// bouton principal en bas, dans la barre collée. Aucun halo, aucun dégradé, aucun
// surtitre en majuscules (registre U2, U9, U39, U40).
import { useState } from 'react';
import { errorMessage } from '../../lib/error-message';
import { formatRange } from '../capture/format';
import { glossaryLine } from '../../lib/glossary-text';
import { FieldError, PrimaryButton, RadioMark, Screen, ScreenHeader, SectionTitle, TextField } from '../../ui';
import { firstNameProblem } from './template';
import {
  createFirstRoutine,
  DEFAULT_ROUTINE_NAME,
  FIRST_NAME_MAX_LENGTH,
  STARTER_TEMPLATE,
  type FirstRoutineResult,
} from './data';

/** Présentation pure (montable sans réseau) : la création est injectée. */
export interface FirstLaunchViewProps {
  /** Crée la 1ʳᵉ routine + séance. Rejette en cas d'échec (affiché inline). */
  onCreate: (input: {
    routineName: string;
    seanceName: string;
    withTemplate: boolean;
  }) => Promise<void>;
}

export function FirstLaunchView({ onCreate }: FirstLaunchViewProps) {
  const [routineName, setRoutineName] = useState(DEFAULT_ROUTINE_NAME);
  const [seanceName, setSeanceName] = useState(STARTER_TEMPLATE.seanceName);
  const [withTemplate, setWithTemplate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Les noms se vérifient au premier envoi, puis à chaque frappe : la phrase dit
  // ce qui manque sous le champ fautif, au lieu d'un bouton éteint sans raison.
  const [tried, setTried] = useState(false);
  const routineProblem = tried ? firstNameProblem('routine', routineName) : null;
  const seanceProblem = tried ? firstNameProblem('séance', seanceName) : null;

  async function submit() {
    if (busy) return;
    setTried(true);
    if (firstNameProblem('routine', routineName) || firstNameProblem('séance', seanceName)) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        routineName: routineName.trim(),
        seanceName: seanceName.trim(),
        withTemplate,
      });
      // En cas de succès, App recharge et démonte cet écran : pas de reset d'état.
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col">
      <form
        noValidate
        className="flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Screen
          bottom={
            <>
              {error && <FieldError className="break-words">{error}</FieldError>}
              <PrimaryButton type="submit" disabled={busy}>
                {busy ? 'Création…' : 'Créer ma routine'}
              </PrimaryButton>
            </>
          }
        >
          <div aria-hidden="true" className="h-12" />
          <ScreenHeader
            title="Ta première routine"
            meta="Une routine regroupe les séances que tu tournes. Tout se change ensuite dans Séances."
          />
          <TextField
            id="routine-name"
            label="Nom de la routine"
            value={routineName}
            onChange={setRoutineName}
            error={routineProblem}
            maxLength={FIRST_NAME_MAX_LENGTH}
            enterKeyHint="next"
            className="px-5"
          />
          <TextField
            id="seance-name"
            label="Première séance"
            value={seanceName}
            onChange={setSeanceName}
            error={seanceProblem}
            maxLength={FIRST_NAME_MAX_LENGTH}
            enterKeyHint="done"
            hint="C’est par ce nom que tu la choisis en arrivant à la salle."
            className="px-5 pt-4"
          />

          <SectionTitle id="depart-titre">Point de départ</SectionTitle>
          <div role="radiogroup" aria-labelledby="depart-titre" className="ui-list border-t border-line">
            <StartOption
              selected={withTemplate}
              title="Modèle de départ"
              meta={`${STARTER_TEMPLATE.exercises.length} exos de base déjà prescrits, jouable dès la première séance.`}
              onSelect={() => setWithTemplate(true)}
            />
            {withTemplate && (
              <div className="ui-row border-b border-line">
                <ol aria-label="Exercices du modèle" className="py-1.5 pl-[62px] pr-5">
                  {STARTER_TEMPLATE.exercises.map(({ name, prescription: p }) => (
                    <li key={name} className="flex items-baseline justify-between gap-3 py-1 text-[15px] leading-[1.3]">
                      <span className="min-w-0 text-ink">{name}</span>
                      <span className="flex-none whitespace-nowrap text-[14px] text-muted">
                        {formatRange(p.sets)} × {formatRange(p.reps)} · RIR {formatRange(p.rir)}
                      </span>
                    </li>
                  ))}
                </ol>
                {/* Première apparition du RIR : une phrase, sans plus. */}
                <p className="pb-2.5 pl-[62px] pr-5 text-[14px] leading-[1.4] text-muted">{glossaryLine('rir')}</p>
              </div>
            )}
            <StartOption
              selected={!withTemplate}
              title="Séance vierge"
              meta="Tu ajoutes les exos et leurs prescriptions dans Séances."
              onSelect={() => setWithTemplate(false)}
            />
          </div>
          <div className="h-4" />
        </Screen>
      </form>
    </div>
  );
}

/**
 * Conteneur : branche la présentation sur la création réelle (réseau). C'est ce
 * que monte App. `onCreated` est rappelé après succès pour recharger l'app et
 * basculer sur la capture.
 */
export function FirstLaunchScreen({
  onCreated,
}: {
  onCreated: (result: FirstRoutineResult) => void;
}) {
  return (
    <FirstLaunchView
      onCreate={async (input) => {
        const result = await createFirstRoutine(input);
        onCreated(result);
      }}
    />
  );
}

// --- Primitive locale ---------------------------------------------------------

/** Une option du point de départ : rond d'option, titre, explication, ligne
 *  pleine largeur. Le choix se lit à la marque ET à la graisse du titre. */
function StartOption({
  selected,
  title,
  meta,
  onSelect,
}: {
  selected: boolean;
  title: string;
  meta: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="ui-row ui-row-hit flex min-h-16 w-full items-start gap-4 border-b border-line px-5 py-3.5 text-left active:bg-line"
    >
      <span className="pt-0.5">
        <RadioMark checked={selected} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[17px] text-ink ${selected ? 'font-semibold' : 'font-medium'}`}>{title}</span>
        <span className="mt-0.5 block text-[14px] leading-[1.4] text-muted">{meta}</span>
      </span>
    </button>
  );
}
