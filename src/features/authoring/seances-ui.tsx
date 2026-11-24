// Pièces propres à l'édition du plan (Séances), en plus du kit : feuille « un
// nom » (créer, renommer, copier), ligne de réordonnancement, feuilles du ⋯
// d'une séance et d'une routine, ligne d'état après un geste. Aucun signal,
// aucun fond coloré, des mots plutôt que des icônes (DESIGN.md).
import { useState, type ReactNode } from 'react';
import { errorMessage } from '../../lib/error-message';
import { ActionNote, ActionRow, Confirm, FieldError, PrimaryButton, Sheet, TextField, TextLink } from '../../ui';
import type { MenuItem, RoutineMenu, SeanceActionKey } from './object-actions';

/** Un nom tel qu'il sera enregistré : espaces de bord retirés, espaces internes réduits. */
function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Feuille « un nom » : créer, renommer, copier. Le bouton reste éteint tant
 *  que le nom est vide (ou inchangé, pour un renommage). L'écriture est
 *  attendue : un refus (nom déjà pris, réseau) s'affiche sous le champ, en
 *  français (`errorMessage`), et la feuille reste ouverte. */
export function NameSheet({
  open,
  title,
  label,
  initial = '',
  intro,
  submitLabel,
  busyLabel = 'Enregistrement…',
  onSubmit,
  onClose,
  requireChange = false,
}: {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  intro?: ReactNode;
  submitLabel: string;
  busyLabel?: string;
  /** Résolu = enregistré : le parent ferme la feuille (ou navigue). */
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
  /** Renommer : le nom actuel ne compte pas comme une réponse. */
  requireChange?: boolean;
}) {
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      {open && (
        <NameForm
          key={initial}
          label={label}
          initial={initial}
          intro={intro}
          submitLabel={submitLabel}
          busyLabel={busyLabel}
          onSubmit={onSubmit}
          requireChange={requireChange}
        />
      )}
    </Sheet>
  );
}

function NameForm({
  label,
  initial,
  intro,
  submitLabel,
  busyLabel,
  onSubmit,
  requireChange,
}: {
  label: string;
  initial: string;
  intro?: ReactNode;
  submitLabel: string;
  busyLabel: string;
  onSubmit: (name: string) => Promise<void>;
  requireChange: boolean;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = cleanName(name);
  const ok = clean !== '' && !(requireChange && clean === cleanName(initial)) && !busy;

  async function submit() {
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(clean);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form
      className="px-5 pb-2 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {intro && <p className="mb-4 text-[15px] leading-[1.45] text-muted">{intro}</p>}
      <TextField label={label} value={name} onChange={setName} autoFocus enterKeyHint="done" />
      {error && <FieldError>{error}</FieldError>}
      <div className="mt-4 flex">
        <PrimaryButton type="submit" disabled={!ok}>
          {busy ? busyLabel : submitLabel}
        </PrimaryButton>
      </div>
    </form>
  );
}

/** Ligne en mode « Réordonner » : rang, nom (sur deux lignes au besoin), Monter
 *  et Descendre en mots. La dernière ligne déplacée garde son titre en demi-gras
 *  (pas de bande latérale, comme la ligne courante du kit). */
export function ReorderRow({
  rank,
  title,
  meta,
  first,
  last,
  moved,
  disabled = false,
  onMove,
}: {
  rank: number;
  title: string;
  meta?: ReactNode;
  first: boolean;
  last: boolean;
  moved: boolean;
  /** Un déplacement est en vol (écriture en base) : les deux boutons attendent. */
  disabled?: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const btn =
    'ui-press h-11 flex-none rounded-block border-[1.5px] border-ink bg-raise px-3 text-[15px] font-semibold text-ink active:bg-line disabled:border-line disabled:bg-transparent disabled:text-faint';
  return (
    <li className="relative flex min-h-16 items-center gap-3 border-b border-line px-5 py-2">
      <span className="tnum w-6 flex-none text-[15px] text-faint">{rank}</span>
      <span className="min-w-0 flex-1">
        <span className={`block break-words text-[17px] leading-[1.25] text-ink ${moved ? 'font-semibold' : 'font-medium'}`}>{title}</span>
        {meta && <span className="mt-0.5 block text-[14px] text-muted">{meta}</span>}
      </span>
      <button type="button" className={btn} disabled={first || disabled} aria-label={`Monter ${title}`} onClick={() => onMove(-1)}>
        Monter
      </button>
      <button type="button" className={btn} disabled={last || disabled} aria-label={`Descendre ${title}`} onClick={() => onMove(1)}>
        Descendre
      </button>
    </li>
  );
}

// =====================================================================
// ⋯ d'une séance, d'une routine : une seule porte d'actions par objet
// =====================================================================
//
// Même feuille depuis la ligne de l'objet dans sa liste et depuis l'en-tête de
// sa page : titre au nom de l'objet, une action par bouton secondaire avec sa
// phrase dessous (motif du ⋯ du Sommaire de la Salle). Ce qui demande
// confirmation (object-actions.ts) la montre DANS la feuille, à la place de la
// liste. Renommer et copier passent à la feuille « un nom ». Un geste sans
// confirmation garde la feuille ouverte et occupée jusqu'à la réponse : un refus
// s'y lit ; le succès revient au parent, qui ferme et pose la ligne d'état.
//
// Montées seulement quand elles sont ouvertes (`{cible && <… />}`) : chaque
// ouverture repart de la liste, et le parent les ferme d'un coup (garde de
// sortie de l'éditeur).

/** Une écriture attendue, avec son état « en vol » et son refus en français. */
function useWrite() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(write: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await write();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      // Au succès, le parent a déjà fermé la feuille ou changé la phrase (même
      // passe de rendu) : la ligne d'état, elle, reste montée et doit se rallumer.
      setBusy(false);
    }
  }
  return { busy, error, run, clear: () => setError(null) };
}

type SeanceStep = 'menu' | 'archive' | 'delete' | 'rename' | 'duplicate';

export function SeanceActionsSheet({
  seanceName,
  routineName,
  copyName,
  items,
  inCurrentRoutine,
  unsaved = false,
  onClose,
  onRename,
  onDuplicate,
  onArchive,
  onDelete,
}: {
  seanceName: string;
  routineName: string;
  /** Nom proposé pour la copie (libre dans la routine). */
  copyName: string;
  /** Ce que la feuille propose (`seanceMenu`). */
  items: MenuItem<SeanceActionKey>[];
  inCurrentRoutine: boolean;
  /** Depuis l'éditeur : une saisie n'est pas enregistrée (la copie ne l'a pas). */
  unsaved?: boolean;
  onClose: () => void;
  /** Résolus = faits : le parent ferme la feuille (ou navigue). */
  onRename: (name: string) => Promise<void>;
  onDuplicate: (name: string) => Promise<void>;
  onArchive: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [step, setStep] = useState<SeanceStep>('menu');
  const write = useWrite();
  const has = (key: SeanceActionKey) => items.find((i) => i.key === key);
  const archive = has('archive');

  if (step === 'rename') {
    return (
      <NameSheet
        open
        title="Renommer la séance"
        label="Nom de la séance"
        initial={seanceName}
        submitLabel="Renommer"
        requireChange
        onClose={onClose}
        onSubmit={onRename}
      />
    );
  }
  if (step === 'duplicate') {
    return (
      <NameSheet
        open
        title={`Copier ${seanceName}`}
        label="Nom de la copie"
        initial={copyName}
        intro={`Copie de la version enregistrée, dans ${routineName}. Les deux séances seront indépendantes ; la copie part sans Référence ni courbe tant qu’elle n’a pas été faite.${
          unsaved ? ' Tes modifications en cours n’y sont pas.' : ''
        }`}
        submitLabel="Créer la copie"
        busyLabel="Création…"
        onClose={onClose}
        onSubmit={onDuplicate}
      />
    );
  }

  const back = () => {
    write.clear();
    setStep('menu');
  };

  return (
    <Sheet open title={seanceName} onClose={write.busy ? () => {} : onClose}>
      {step === 'archive' && archive ? (
        <Confirm
          destructive={archive.confirm === 'destructive'}
          keepLabel="Garder et continuer"
          confirmLabel={archive.confirm === 'destructive' ? 'Archiver sans les modifications' : 'Archiver la séance'}
          busy={write.busy}
          error={write.error}
          className="mx-5 mb-2 mt-1"
          onCancel={back}
          onConfirm={() => void write.run(onArchive)}
        >
          <p className="font-medium">Archiver {seanceName} ?</p>
          <p className="mt-1 text-muted">
            Elle ne se choisit plus en salle. Son historique reste dans l’analyse.
            {inCurrentRoutine && ' Le plan de la routine courante change : un nouveau bloc commence.'}
            {unsaved && ' Tes modifications non enregistrées sont abandonnées.'} Tu pourras la désarchiver.
          </p>
        </Confirm>
      ) : step === 'delete' ? (
        <Confirm
          destructive
          keepLabel="Garder la séance"
          confirmLabel="Supprimer la séance"
          busy={write.busy}
          error={write.error}
          className="mx-5 mb-2 mt-1"
          onCancel={back}
          onConfirm={() => void write.run(onDelete)}
        >
          <p className="font-medium">Supprimer {seanceName} ?</p>
          <p className="mt-1 text-muted">Jamais faite, elle n’a aucun historique. C’est définitif.</p>
        </Confirm>
      ) : (
        <>
          <ul aria-label={`Actions de ${seanceName}`}>
            <ActionRow label="Renommer" disabled={write.busy} onClick={() => setStep('rename')} />
            {has('duplicate') && (
              <ActionRow
                label="Dupliquer"
                disabled={write.busy}
                meta={`Copie indépendante de la version enregistrée, dans ${routineName}, sans historique.`}
                onClick={() => setStep('duplicate')}
              />
            )}
            {archive && (
              <ActionRow
                label={write.busy ? 'Un instant…' : 'Archiver'}
                disabled={write.busy}
                meta="Déjà faite : elle s’archive, son historique reste entier. Tu pourras la désarchiver."
                onClick={() => (archive.confirm === 'none' ? void write.run(onArchive) : setStep('archive'))}
              />
            )}
            {has('delete') && (
              <ActionRow
                label="Supprimer"
                disabled={write.busy}
                meta="Jamais faite : rien à garder, elle se supprime."
                onClick={() => setStep('delete')}
              />
            )}
          </ul>
          {write.error && <FieldError className="mx-5">{write.error}</FieldError>}
        </>
      )}
    </Sheet>
  );
}

type RoutineStep = 'menu' | 'set-current' | 'delete' | 'rename';

export function RoutineActionsSheet({
  routineName,
  currentRoutineName,
  menu,
  seanceTotal,
  onClose,
  onRename,
  onSetCurrent,
  onArchive,
  onDelete,
}: {
  routineName: string;
  /** Nom de la routine courante, pour dire ce que « Définir courante » remplace. */
  currentRoutineName: string | null;
  menu: RoutineMenu;
  /** Séances de la routine, archivées comprises (ce que la suppression emporte). */
  seanceTotal: number;
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
  onSetCurrent: () => Promise<void>;
  onArchive: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [step, setStep] = useState<RoutineStep>('menu');
  const write = useWrite();
  const has = (key: string) => menu.items.some((i) => i.key === key);
  const replaces = `Ses séances remplacent ${currentRoutineName ? `celles de ${currentRoutineName}` : 'les tiennes'} en salle. Un nouveau bloc commence.`;

  if (step === 'rename') {
    return (
      <NameSheet
        open
        title="Renommer la routine"
        label="Nom de la routine"
        initial={routineName}
        submitLabel="Renommer"
        requireChange
        onClose={onClose}
        onSubmit={onRename}
      />
    );
  }

  const back = () => {
    write.clear();
    setStep('menu');
  };

  return (
    <Sheet open title={routineName} onClose={write.busy ? () => {} : onClose}>
      {step === 'set-current' ? (
        <Confirm
          confirmLabel="Définir comme courante"
          busy={write.busy}
          error={write.error}
          className="mx-5 mb-2 mt-1"
          onCancel={back}
          onConfirm={() => void write.run(onSetCurrent)}
        >
          <p className="font-medium">Définir {routineName} comme routine courante ?</p>
          <p className="mt-1 text-muted">{replaces}</p>
        </Confirm>
      ) : step === 'delete' ? (
        <Confirm
          destructive
          keepLabel="Garder la routine"
          confirmLabel="Supprimer la routine"
          busy={write.busy}
          error={write.error}
          className="mx-5 mb-2 mt-1"
          onCancel={back}
          onConfirm={() => void write.run(onDelete)}
        >
          <p className="font-medium">Supprimer {routineName} ?</p>
          <p className="mt-1 text-muted">
            Jamais faite, elle n’a aucun historique : elle disparaît
            {seanceTotal === 1 ? ' avec sa séance' : seanceTotal > 1 ? ` avec ses ${seanceTotal} séances` : ''}. C’est définitif.
          </p>
        </Confirm>
      ) : (
        <>
          <ul aria-label={`Actions de ${routineName}`}>
            <ActionRow label="Renommer" disabled={write.busy} onClick={() => setStep('rename')} />
            {has('set-current') && (
              <ActionRow label="Définir comme routine courante" disabled={write.busy} meta={replaces} onClick={() => setStep('set-current')} />
            )}
            {has('archive') && (
              <ActionRow
                label={write.busy ? 'Un instant…' : 'Archiver'}
                disabled={write.busy}
                meta="Déjà faite : elle s’archive, son historique reste entier. Tu pourras la désarchiver."
                onClick={() => void write.run(onArchive)}
              />
            )}
            {has('delete') && (
              <ActionRow
                label="Supprimer"
                disabled={write.busy}
                meta="Jamais faite : rien à garder, elle se supprime."
                onClick={() => setStep('delete')}
              />
            )}
            {menu.currentNote && (
              <ActionNote>La routine courante ne s’archive pas. Définis d’abord une autre routine comme courante.</ActionNote>
            )}
          </ul>
          {write.error && <FieldError className="mx-5">{write.error}</FieldError>}
        </>
      )}
    </Sheet>
  );
}

/** Ce qu'un geste vient de faire, en une phrase, en tête de la page où il se lit
 *  (modèle de la `Flash` d'Exos) ; un archivage offre aussitôt « Désarchiver ».
 *  La phrase s'efface à la navigation suivante. */
export interface PlanFlash {
  text: string;
  /** L'objet archivé que « Désarchiver » rend au plan. */
  unarchive?: { kind: 'seance' | 'routine'; id: string; name: string };
}

/** La ligne d'état : la phrase entre deux filets, « Désarchiver » en lien à son
 *  bout. Le lien attend l'écriture ; un refus prend la place de la phrase. */
export function StatusLine({ flash, onUnarchive }: { flash: PlanFlash; onUnarchive?: () => Promise<void> }) {
  const write = useWrite();
  return (
    <div role="status" className="mx-5 mb-4 flex flex-wrap items-center justify-between gap-x-4 border-y border-line py-1.5">
      <p className="min-w-0 py-1.5 text-[15px] leading-[1.45] text-ink">{write.error ? `Erreur : ${write.error}` : flash.text}</p>
      {flash.unarchive && onUnarchive && (
        <TextLink
          tone="muted"
          className="flex-none text-[15px]"
          ariaLabel={`Désarchiver ${flash.unarchive.name}`}
          onClick={write.busy ? undefined : () => void write.run(onUnarchive)}
        >
          {write.busy ? 'Un instant…' : 'Désarchiver'}
        </TextLink>
      )}
    </div>
  );
}
