// Une métrique de séance OPTIONNELLE, repliée tant qu'elle n'est pas saisie.
//
// Matérialise l'« optionnel » sans <input>/clavier OS (DESIGN.md) : non saisi =
// ligne repliée avec un bouton « + Ajouter… » ; ouverte, elle révèle son contrôle
// (un Stepper passé en `children`) et un bouton « Retirer » pour revenir à « non
// saisi ». Partagée par la fin de séance (SessionEnd) et l'édition d'une séance
// passée (PastSessionEditor) — même grammaire pour le BPM moyen des deux côtés.

/** Une métrique optionnelle : repliée (« + Ajouter… ») ou ouverte (contrôle + retrait). */
export function MetricRow({
  title,
  addLabel,
  hint,
  on,
  onAdd,
  onRemove,
  children,
}: {
  title: string;
  /** Libellé de l'action « ajouter » (grammaire FR explicite, pas de bricolage le/la). */
  addLabel: string;
  hint: string;
  on: boolean;
  onAdd: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  if (!on) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="flex min-h-[3.25rem] w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left transition active:scale-[0.99] active:bg-surface-2"
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-ink-muted"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-ink">{addLabel}</span>
          <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span>
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-2xl bg-surface px-4 py-3.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-base font-semibold text-ink">{title}</span>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex h-9 items-center rounded-lg px-2.5 text-xs font-medium text-ink-muted transition active:text-ink"
        >
          Retirer
        </button>
      </div>
      {children}
    </div>
  );
}
