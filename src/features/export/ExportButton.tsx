// Bouton « Exporter mes données » (issue #8) : déclenche la collecte + le
// téléchargement du backup JSON. Encapsule l'effet de bord (download) et ses
// états (busy / erreur / succès) pour rester montable seul.
//
// Conventions DESIGN.md : action SECONDAIRE (le backup n'est pas l'action
// primaire de l'écran), donc neutre, pas d'accent violet. Tap-target >= 44px.
// Aucun tiret long (—) dans le texte affiché.
import { useEffect, useRef, useState } from 'react';
import { downloadUserData, exportFilename } from './data';

type Status =
  | { phase: 'idle' }
  | { phase: 'exporting' }
  | { phase: 'done'; filename: string }
  | { phase: 'error'; message: string };

export function ExportButton({
  // Injectable pour le test / le harness ; défaut = vrai téléchargement.
  onExport = downloadUserData,
}: {
  onExport?: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Status>({ phase: 'idle' });
  const busy = status.phase === 'exporting';

  // Auto-dismiss du message de succès après 4 s.
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status.phase === 'done') {
      dismissRef.current = setTimeout(() => setStatus({ phase: 'idle' }), 4000);
    }
    return () => {
      if (dismissRef.current != null) clearTimeout(dismissRef.current);
    };
  }, [status.phase]);

  async function run() {
    setStatus({ phase: 'exporting' });
    const filename = exportFilename();
    try {
      await onExport();
      setStatus({ phase: 'done', filename });
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
          <path d="M12 3v12M7 10l5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        {busy ? 'Export en cours…' : 'Exporter mes données'}
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
          {status.filename} téléchargé. Range-le en lieu sûr.
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
