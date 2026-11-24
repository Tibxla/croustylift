// Kit E · état de chargement et échec de chargement d'un écran. Une phrase, pas
// de toupie : le texte dit ce qui se charge, l'échec dit quoi et propose de
// réessayer.
import type { ReactNode } from 'react';
import { SecondaryButton } from './buttons';

/** Chargement en cours : une ligne grise annoncée aux lecteurs d'écran. */
export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="px-5 py-6 text-[15px] text-muted">
      {label}
    </p>
  );
}

/** Message d'alerte ou d'état, entre deux filets (jamais de bande latérale ni de
 *  couleur d'alerte). `label` en demi-gras en tête (« Erreur », par défaut) ;
 *  `null` pour un simple compte rendu (`role="status"`). */
export function Alert({
  children,
  label = 'Erreur',
  role = 'alert',
  id,
  className = '',
}: {
  children: ReactNode;
  label?: string | null;
  role?: 'alert' | 'status';
  id?: string;
  className?: string;
}) {
  return (
    <p id={id} role={role} className={`break-words border-y border-line py-3 text-[15px] leading-[1.45] text-ink ${className}`}>
      {label && <span className="font-semibold">{label} : </span>}
      {children}
    </p>
  );
}

/** Échec d'un chargement : « Erreur : » puis la phrase, entre deux filets, puis « Réessayer ». */
export function LoadError({ intro, message, onRetry }: { intro: string; message: string; onRetry?: () => void }) {
  return (
    <div className="px-5 pt-4">
      <Alert>
        {intro} {message}
      </Alert>
      {onRetry && (
        <div className="mt-4">
          <SecondaryButton onClick={onRetry}>Réessayer</SecondaryButton>
        </div>
      )}
    </div>
  );
}
