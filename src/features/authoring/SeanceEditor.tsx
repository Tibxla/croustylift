// Éditeur de prescriptions d'une séance — PLACEHOLDER de cette étape.
//
// La navigation y mène déjà (bouton « Éditer » d'une séance, cf. SeancesScreen),
// mais le vrai éditeur (saisie des exos prescrits, fourchettes sets/reps/RIR,
// versionnage via saveSeanceVersion) arrivera dans une étape ultérieure. Pour
// l'instant : un cadre propre qui nomme la séance et offre un retour.
//
// Présentation pure : il prend juste le nom de la séance + un onBack, donc il se
// monte tel quel dans le harness de screenshot, sans Supabase.

interface SeanceEditorProps {
  /** Nom de la séance en cours d'édition (affiché en titre). */
  seanceName: string;
  /** Retour à la liste des séances de la routine. */
  onBack: () => void;
}

export function SeanceEditor({ seanceName, onBack }: SeanceEditorProps) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-md flex-col px-4 pb-8 pt-3">
      <BackButton label="Retour aux séances" onClick={onBack} />

      <h2 className="mt-1 text-2xl font-bold leading-tight tracking-tight text-ink">
        {seanceName}
      </h2>

      <div className="mt-6 flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-ink-muted"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
        </span>
        <p className="text-sm text-ink-muted">Éditeur de prescriptions (bientôt).</p>
      </div>
    </div>
  );
}

/** Bouton retour : chevron + libellé, même grammaire visuelle que la capture. */
function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 inline-flex items-center gap-1.5 self-start rounded-lg py-2 pr-3 text-sm font-medium text-ink-muted transition active:text-ink"
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
        <path d="M15 6l-6 6 6 6" />
      </svg>
      {label}
    </button>
  );
}
