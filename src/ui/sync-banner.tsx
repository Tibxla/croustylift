// Kit E · bandeau de synchro, une seule ligne (il ne doit pas pousser
// l'instrument). Le shell le pose sous la navigation ; il ne s'affiche que s'il
// y a quelque chose à dire (src/shell/sync-line.ts). Un mot en blanc cassé, le
// détail en gris, entre deux filets ; jamais de couleur d'alerte.
//
// `action` (saisies refusées) : toute la ligne devient un bouton qui ouvre
// l'écran des saisies refusées, son libellé souligné au bout (« 2 refusées ») :
// il reste lisible quand le détail est coupé. Quand la ligne dit déjà le nombre
// en titre, sans détail (« 2 saisies refusées »), le bout dit seulement « Voir ».
// La ligne garde sa hauteur ; la zone touchable déborde de 4 px en haut et en
// bas pour tenir 44 px sans rien pousser.
import type { ReactNode } from 'react';

export function SyncBanner({
  line,
  action,
}: {
  line: { title: string; detail: string } | null;
  action?: { label: string; onClick: () => void };
}) {
  if (!line) return null;
  const content: ReactNode = (
    <>
      <span className="flex-none font-semibold text-ink">{line.title}</span>
      {line.detail && <span className="min-w-0 truncate text-muted">{line.detail}</span>}
    </>
  );
  if (!action) {
    return (
      <div role="status" className="flex items-baseline gap-2 whitespace-nowrap border-y border-line px-5 py-2 text-[14px]">
        {content}
      </div>
    );
  }
  return (
    <div role="status" className="border-y border-line">
      <button
        type="button"
        onClick={action.onClick}
        aria-label={`${line.detail ? `${line.title}, ${line.detail}` : line.title}. Voir les saisies refusées`}
        className="relative flex w-full items-baseline gap-2 whitespace-nowrap px-5 py-2 text-left text-[14px] before:absolute before:inset-x-0 before:-bottom-1 before:-top-1 active:bg-line"
      >
        {content}
        <span className="ml-auto flex-none pl-2 text-ink underline decoration-1 underline-offset-4">{line.detail ? action.label : 'Voir'}</span>
      </button>
    </div>
  );
}
