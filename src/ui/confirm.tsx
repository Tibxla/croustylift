// Kit E · confirmation en ligne, section repliable, rangée d'action d'objet.
import { useId, type ReactNode } from 'react';
import { SecondaryButton, TextLink } from './buttons';

/** Confirmation en ligne, posée là où l'action a été demandée (jamais de
 *  `window.confirm`). Le texte dit toujours ce qui sera perdu. `destructive`
 *  (une perte qui ne se défait pas) : l'option SÛRE est le bouton (`keepLabel`)
 *  et la perte un lien souligné discret. Sinon (archivage, qui se défait),
 *  l'action est le bouton et « Annuler » le lien. `busy` : l'action est en vol,
 *  les deux choix sont éteints. */
export function Confirm({
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = false,
  keepLabel = 'Garder',
  busy = false,
  error,
  className = 'mx-5 my-3',
}: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  keepLabel?: string;
  busy?: boolean;
  /** Échec de l'action : la phrase, sous les choix. */
  error?: string | null;
  className?: string;
}) {
  return (
    <div role="alert" className={`border-y border-line py-3 ${className}`}>
      <div className="text-[15px] leading-[1.45] text-ink">{children}</div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {destructive ? (
          <>
            <SecondaryButton onClick={onCancel} disabled={busy}>
              {keepLabel}
            </SecondaryButton>
            <TextLink tone="muted" onClick={busy ? undefined : onConfirm}>
              {busy ? 'Un instant…' : confirmLabel}
            </TextLink>
          </>
        ) : (
          <>
            <SecondaryButton onClick={onConfirm} disabled={busy}>
              {busy ? 'Un instant…' : confirmLabel}
            </SecondaryButton>
            <TextLink tone="muted" onClick={busy ? undefined : onCancel}>
              Annuler
            </TextLink>
          </>
        )}
      </div>
      {error && <p className="mt-2 text-[15px] leading-[1.4] text-ink">{error}</p>}
    </div>
  );
}

/** En-tête d'une section repliée (archivées). Le compte se lit sans ouvrir. */
export function Disclosure({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="mt-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex min-h-12 w-full items-baseline justify-between gap-3 px-5 py-2 text-left"
      >
        <span className="text-[17px] font-semibold text-ink">
          {label} <span className="font-normal text-muted">· {count}</span>
        </span>
        <span className="text-[15px] text-muted underline decoration-1 underline-offset-4">{open ? 'Masquer' : 'Afficher'}</span>
      </button>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** Action d'objet (renommer, archiver…) : un bouton secondaire pleine largeur,
 *  l'explication dessous. Plusieurs se suivent dans un `<ul>` sans filet. */
export function ActionRow({
  label,
  meta,
  onClick,
  disabled,
}: {
  label: string;
  meta?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <li className="px-5 py-2">
      <SecondaryButton onClick={onClick} disabled={disabled} className="w-full">
        {label}
      </SecondaryButton>
      {meta && <p className="mt-1.5 text-[14px] leading-[1.4] text-muted">{meta}</p>}
    </li>
  );
}

/** Ligne non actionnable d'une liste d'actions : dit pourquoi une action manque. */
export function ActionNote({ children }: { children: ReactNode }) {
  return <li className="px-5 py-2.5 text-[15px] leading-[1.45] text-muted">{children}</li>;
}
