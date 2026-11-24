// Kit E · état de chargement et échec de chargement d'un écran. Une phrase, pas
// de toupie : le texte dit ce qui se charge, l'échec dit quoi et propose de
// réessayer.
import { SecondaryButton } from './buttons';

/** Chargement en cours : une ligne grise annoncée aux lecteurs d'écran. */
export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="px-5 py-6 text-[15px] text-muted">
      {label}
    </p>
  );
}

/** Échec d'un chargement : la phrase sur un trait blanc cassé, puis « Réessayer ». */
export function LoadError({ intro, message, onRetry }: { intro: string; message: string; onRetry?: () => void }) {
  return (
    <div className="px-5 pt-4">
      <p role="alert" className="break-words border-y border-line py-3 text-[15px] leading-[1.45] text-ink">
        <span className="font-semibold">Erreur : </span>{intro} {message}
      </p>
      {onRetry && (
        <div className="mt-4">
          <SecondaryButton onClick={onRetry}>Réessayer</SecondaryButton>
        </div>
      )}
    </div>
  );
}
