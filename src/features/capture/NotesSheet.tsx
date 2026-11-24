// Notes d'un exo, dans une feuille ouverte par l'icône Notes de l'instrument :
// la note du jour (prose, le clavier y est permis), le repère « Tu notais »
// (lecture seule, toujours daté, cf. GLOSSARY.md « Note datée ») et les
// instructions de l'exo, en lecture, modifiables sur un geste explicite
// (registre U27 : plus de champ toujours armé dans la zone de saisie).
//
// Les deux notes s'enregistrent toutes seules (`useAutosavedNote` : délai de
// frappe, sortie du champ, fermeture de la feuille) ; la persistance reste au
// parent (file d'écriture).
import { useState } from 'react';
import { isBlankNote } from '../../domain/notes';
import { IconButton, SecondaryButton, Sheet } from '../../ui';
import { NoteField } from '../notes/NoteField';
import { useAutosavedNote } from '../notes/useAutosavedNote';
import type { PreviousDatedNote } from './fixtures';
import { formatRelativeDay } from './format';
import { todayIso } from './state';

function Saved({ on, children }: { on: boolean; children: string }) {
  return (
    <p className="mt-1.5 min-h-5 text-[14px] text-muted" aria-live="polite">
      {on ? children : ''}
    </p>
  );
}

function DatedNote({ value, onSave }: { value: string; onSave: (body: string) => void }) {
  const { draft, saved, handleChange, flush } = useAutosavedNote(value, onSave, { adoptIncoming: true });
  return (
    <>
      <NoteField
        id="note-du-jour"
        label="Note du jour"
        labelHidden
        value={draft}
        placeholder="Sensations, douleur, machine prise"
        rows={3}
        onChange={handleChange}
        onBlur={flush}
      />
      <Saved on={saved}>Note enregistrée.</Saved>
    </>
  );
}

function Instructions({ value, onSave }: { value: string; onSave: (body: string) => void }) {
  const [editing, setEditing] = useState(false);
  const { draft, saved, handleChange, flush } = useAutosavedNote(value, onSave);
  const has = !isBlankNote(draft);
  return (
    <>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <span className="text-[15px] font-semibold text-ink">Instructions</span>
        {!editing && (
          <IconButton
            icon="edit"
            tone="muted"
            className="-mr-2.5"
            label={has ? 'Modifier les instructions' : 'Écrire les instructions'}
            onClick={() => setEditing(true)}
          />
        )}
      </div>
      {editing ? (
        <>
          <NoteField
            id="instructions"
            label="Instructions"
            labelHidden
            value={draft}
            placeholder="Réglages de la machine, placement"
            rows={3}
            onChange={handleChange}
            onBlur={flush}
          />
          <div className="mt-3">
            <SecondaryButton
              size="sm"
              onClick={() => {
                flush();
                setEditing(false);
              }}
            >
              Terminé
            </SecondaryButton>
          </div>
        </>
      ) : has ? (
        <p className="max-w-[40ch] whitespace-pre-line text-[16px] leading-[1.45] text-ink">{draft}</p>
      ) : (
        <p className="text-[15px] text-muted">Aucune.</p>
      )}
      <Saved on={saved}>Instructions enregistrées.</Saved>
    </>
  );
}

export function NotesSheet({
  open,
  onClose,
  name,
  datedNote,
  previous,
  instructions,
  onSaveDatedNote,
  onSaveInstructions,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  datedNote: string;
  previous: PreviousDatedNote | null;
  instructions: string;
  onSaveDatedNote: (body: string) => void;
  onSaveInstructions: (body: string) => void;
}) {
  return (
    <Sheet open={open} title={name} onClose={onClose}>
      <div className="px-5 pb-4">
        <div className="flex items-baseline justify-between gap-3 pb-1.5">
          <span className="text-[15px] font-semibold text-ink">Note du jour</span>
          <span className="text-[14px] text-muted">aujourd’hui</span>
        </div>
        <DatedNote value={datedNote} onSave={onSaveDatedNote} />
        {previous && !isBlankNote(previous.body) && (
          <div className="mt-3">
            <p className="text-[15px] font-semibold text-ink">
              Tu notais <span className="font-normal text-muted">{formatRelativeDay(previous.performedOn, todayIso())}</span>
            </p>
            <p className="mt-1 max-w-[40ch] whitespace-pre-line text-[16px] leading-[1.45] text-muted">{previous.body}</p>
          </div>
        )}
        <div className="mt-4 border-t border-line pt-1">
          <Instructions value={instructions} onSave={onSaveInstructions} />
        </div>
      </div>
    </Sheet>
  );
}
