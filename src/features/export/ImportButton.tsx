// Bouton « Importer mes données » (issue #35) : ouvre un sélecteur de fichier
// JSON et déclenche la restauration. Pendant du ExportButton.
//
// Conventions DESIGN.md :
//   - action SECONDAIRE, neutre (pas d'accent violet).
//   - tap-target >= 44px.
//   - aucun tiret long (—) dans le texte affiché.
//   - le statut de l'opération est communiqué par texte + couleur, jamais par
//     couleur seule.
import { useRef, useState } from 'react';
import { restoreFromFile } from './data-import';

type Status =
  | { phase: 'idle' }
  | { phase: 'importing' }
  | { phase: 'done' }
  | { phase: 'error'; message: string };

export function ImportButton({
  // Injectable pour le test / le harness ; défaut = vrai import.
  onImport = restoreFromFile,
}: {
  onImport?: (file: File) => Promise<void>;
}) {
  const [status, setStatus] = useState<Status>({ phase: 'idle' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = status.phase === 'importing';

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Réinitialise la valeur pour que le même fichier puisse être resélectionné.
    e.target.value = '';

    setStatus({ phase: 'importing' });
    try {
      await onImport(file);
      setStatus({ phase: 'done' });
    } catch (err) {
      setStatus({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div>
      {/* Input caché : déclenché par le bouton visible ci-dessous. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={(e) => void handleFile(e)}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-medium text-ink transition active:scale-[0.98] active:bg-surface-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 21V9M7 14l5-5 5 5" />
          <path d="M5 21h14" />
        </svg>
        {busy ? 'Import en cours…' : 'Importer mes données'}
      </button>

      {status.phase === 'done' && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-good" role="status">
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 12l5 5L20 6" />
          </svg>
          Donnees importees. Recharge l'app pour voir les changements.
        </p>
      )}
      {status.phase === 'error' && (
        <p className="mt-2 break-words text-xs text-warn" role="alert">
          {status.message}
        </p>
      )}
    </div>
  );
}
