// Feuille d'édition de la note d'instructions d'un exo (issue #26), hors Salle.
//
// La même partout où la note s'écrit au calme (éditeur de séance, fiche d'Exos) :
// le texte, « Enregistrer la note » (ou « Effacer la note » quand il est vidé),
// « Remettre la note enregistrée » en lien tant qu'il diffère. La Salle garde
// son enregistrement automatique (useAutosavedNote) : entre deux séries, pas de
// bouton à chercher.
//
// Le texte en cours (`draft`) appartient à l'APPELANT, pas à la feuille : la
// fermer ne le perd pas, et l'appelant le voit (garde de sortie de l'éditeur,
// blocage de rechargement, ligne « non enregistrée »). Vider puis enregistrer
// efface la note.
import { useState } from 'react';
import { isBlankNote } from '../../domain/notes';
import { errorMessage } from '../../lib/error-message';
import { FieldError, PrimaryButton, Sheet, TextArea, TextLink } from '../../ui';

/** Ce que fait la note, sous le champ : le même texte partout où elle s'écrit. */
export const NOTE_HINT =
  'Vaut pour cet exo dans toutes tes séances et s’affiche en salle. Elle s’enregistre tout de suite, à part des réglages de la séance.';

export function NoteSheet({
  exerciseName,
  note,
  draft,
  hint,
  onDraft,
  onSave,
  onClose,
}: {
  exerciseName: string;
  /** La note enregistrée ('' si aucune). */
  note: string;
  /** Le texte affiché (la note enregistrée tant que rien n'est touché). */
  draft: string;
  /** Ce que la note fait, sous le champ (`NOTE_HINT`). */
  hint: string;
  onDraft: (body: string) => void;
  /** Résolu = enregistrée : la feuille se ferme. */
  onSave: (body: string) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = draft !== note;
  const clearing = changed && isBlankNote(draft);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      title={`Note · ${exerciseName}`}
      onClose={onClose}
      footer={
        <>
          {error && <FieldError className="mt-0">{error}</FieldError>}
          {changed && !busy && (
            <TextLink tone="muted" className="self-start" onClick={() => onDraft(note)}>
              {isBlankNote(note) ? 'Effacer la saisie' : 'Remettre la note enregistrée'}
            </TextLink>
          )}
          <PrimaryButton disabled={!changed || busy} onClick={() => void submit()}>
            {busy ? 'Enregistrement…' : !changed ? 'Aucune modification' : clearing ? 'Effacer la note' : 'Enregistrer la note'}
          </PrimaryButton>
        </>
      }
    >
      <div className="px-5 pt-1">
        <TextArea label="Note d’instructions" value={draft} onChange={onDraft} rows={4} placeholder="Prise, réglage de la machine, tempo…" hint={hint} />
      </div>
    </Sheet>
  );
}
