// Bouton « Exporter mes données » (issue #8) : déclenche la collecte + le
// téléchargement du backup JSON. Encapsule l'effet de bord (download) et ses
// états (busy / erreur / succès) pour rester montable seul.
//
// Conventions DESIGN.md : action SECONDAIRE (le backup n'est pas l'action
// primaire de l'écran), donc neutre, pas d'accent violet. Tap-target >= 44px.
// Aucun tiret long (—) dans le texte affiché.
import { useState } from 'react';
import { downloadUserData } from './data';

type Status =
  | { phase: 'idle' }
  | { phase: 'exporting' }
  | { phase: 'done' }
  | { phase: 'error'; message: string };

export function ExportButton({
  // Injectable pour le test / le harness ; défaut = vrai téléchargement.
  onExport = downloadUserData,
}: {
  onExport?: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Status>({ phase: 'idle' });
  const busy = status.phase === 'exporting';

  async function run() {
    setStatus({ phase: 'exporting' });
    try {
      await onExport();
      setStatus({ phase: 'done' });
    } catch (err) {
      setStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-medium text-ink transition active:scale-[0.98] active:bg-surface-2 disabled:opacity-50 disabled:active:scale-100"
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
          <path d="M12 3v12M7 10l5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        {busy ? 'Export en cours…' : 'Exporter mes données'}
      </button>

      {status.phase === 'done' && (
        <p className="mt-2 text-xs text-ink-muted" role="status">
          Backup téléchargé. Range le fichier en lieu sûr.
        </p>
      )}
      {status.phase === 'error' && (
        <p className="readout mt-2 break-words text-xs text-warn" role="alert">
          {status.message}
        </p>
      )}
    </div>
  );
}
