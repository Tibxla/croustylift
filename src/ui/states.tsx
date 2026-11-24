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

/** « 24 nov., 17 h 12 » : quand date une copie locale. */
function copyStamp(at: number): string {
  const d = new Date(at);
  const day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return `${day}, ${d.getHours()}\u00a0h\u00a0${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Hors ligne sans copie sur l'appareil : une phrase, pas une erreur (la salle
 *  sans réseau est le cas normal). Rien n'a été lu ; le retour du réseau relit. */
export function OfflineState({ surface }: { surface: string }) {
  return (
    <p role="status" className="px-5 py-6 text-[15px] leading-[1.45] text-muted">
      {surface} se consulte avec le réseau. La Salle marche sans.
    </p>
  );
}

/** La valeur montrée est une copie locale : de quand elle date, et pourquoi. */
export function CopyNote({ at, online }: { at: number; online: boolean }) {
  return (
    <p role="status" className="px-5 pb-3 text-[14px] leading-[1.45] text-muted">
      <span className="font-medium text-ink">{online ? 'Pas de réponse du réseau' : 'Hors ligne'}</span> · copie du {copyStamp(at)}
    </p>
  );
}
