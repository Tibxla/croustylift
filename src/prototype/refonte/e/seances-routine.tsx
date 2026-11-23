// PROTOTYPE JETABLE · surface Séances, page d'une routine. Ses séances dans
// l'ordre de rotation, la création d'une séance (vierge ou copiée, ADR 0015),
// les séances archivées repliées, puis les actions de la routine.
import { useState } from 'react';
import { nextFreeName } from '../../../domain/unique-name';
import {
  fmtCountRange,
  isDirty,
  lastDoneText,
  nameError,
  plan,
  plannedCount,
  routineExecuted,
  routineMeta,
  usePlan,
  type PlanSeance,
} from './fixtures-seances';
import { EmptyState, List, PrimaryButton, Row, Screen, ScreenHeader, SecondaryButton, SectionTitle, Sheet, TextLink } from './kit';
import { ActionNote, ActionRow, Confirm, Disclosure, NameSheet, ReorderRow } from './seances-ui';
import { IconButton } from './icons';
import { useNav } from './shell';

const exos = (n: number) => `${n} exo${n > 1 ? 's' : ''}`;

export function seanceMeta(s: PlanSeance): string {
  if (s.items.length === 0) return 'vide';
  return `${exos(s.items.length)} · ${fmtCountRange(plannedCount(s.items).total)} séries prévues`;
}

type Pending = null | 'archive' | 'delete';

export function RoutinePage({ id }: { id: string }) {
  const nav = useNav();
  const st = usePlan();
  const routine = st.routines.find((r) => r.id === id);
  const [reorder, setReorder] = useState(false);
  const [moved, setMoved] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  if (!routine) {
    return (
      <Screen>
        <ScreenHeader title="Routine introuvable" back={{ label: 'Routines', onClick: nav.back }} />
      </Screen>
    );
  }

  const active = routine.seances.filter((s) => !s.archived);
  const archived = routine.seances.filter((s) => s.archived);
  const executed = routineExecuted(routine);
  const taken = st.routines.map((r) => ({ id: r.id, name: r.name, archived: r.archived }));
  const openSeance = (sid: string) => nav.push('seance', { id: sid });

  const status = routine.archived ? 'Archivée' : routine.current ? 'Routine courante' : null;

  return (
    <Screen
      bottom={
        !routine.archived && !reorder ? <PrimaryButton onClick={() => setCreating(true)}>Créer une séance</PrimaryButton> : undefined
      }
    >
      <ScreenHeader
        title={routine.name}
        meta={
          <>
            {status && <span className={routine.current ? 'font-medium text-(--ink)' : ''}>{status} · </span>}
            {routineMeta(routine)}
          </>
        }
        back={{ label: 'Routines', onClick: nav.back }}
        action={
          !routine.archived && active.length > 1 ? (
            reorder ? (
              <SecondaryButton
                size="sm"
                onClick={() => {
                setReorder((v) => !v);
                setMoved(null);
                }}
              >
                Terminé
              </SecondaryButton>
            ) : (
              <IconButton
                icon="reorder"
                framed
                label="Réordonner"
                onClick={() => {
                setReorder((v) => !v);
                setMoved(null);
                }}
              />
            )
          ) : undefined
        }
      />

      {active.length === 0 ? (
        routine.archived ? (
          <EmptyState title="Aucune séance active" />
        ) : (
          <EmptyState title="Aucune séance dans cette routine" />
        )
      ) : (
        <>
          <SectionTitle aside={reorder ? 'ordre de rotation' : undefined}>Séances</SectionTitle>
          <List label={`Séances de ${routine.name}`}>
            {active.map((s, i) =>
              reorder ? (
                <ReorderRow
                  key={s.id}
                  rank={i + 1}
                  title={s.name}
                  first={i === 0}
                  last={i === active.length - 1}
                  moved={moved === s.id}
                  onMove={(d) => {
                    plan.moveSeance(routine.id, s.id, d);
                    setMoved(s.id);
                  }}
                />
              ) : (
                <Row
                  key={s.id}
                  lead={i + 1}
                  title={s.name}
                  meta={
                    <>
                      <span className="block">{seanceMeta(s)}</span>
                      {isDirty(st, s) ? (
                        <span className="mt-0.5 block font-medium text-(--ink)">modifications non enregistrées</span>
                      ) : (
                        <span className="mt-0.5 block">{lastDoneText(s)}</span>
                      )}
                    </>
                  }
                  onClick={routine.archived ? undefined : () => openSeance(s.id)}
                  muted={routine.archived}
                />
              ),
            )}
          </List>
        </>
      )}

      {archived.length > 0 && !reorder && (
        <Disclosure label="Séances archivées" count={archived.length} open={showArchived} onToggle={() => setShowArchived((v) => !v)}>
          <p className="px-5 pb-3 text-[14px] leading-[1.45] text-(--muted)">
            Elles ne se choisissent plus en salle. Leur historique reste dans l'analyse.
          </p>
          <List label="Séances archivées">
            {archived.map((s) => (
              <Row
                key={s.id}
                muted
                title={s.name}
                meta={`${seanceMeta(s)} · ${lastDoneText(s)}`}
                trailing={
                  routine.archived ? undefined : (
                    <TextLink tone="muted" onClick={() => plan.unarchiveSeance(s.id)} className="-mr-1 px-1 text-[15px]" ariaLabel={`Désarchiver ${s.name}`}>
                      Désarchiver
                    </TextLink>
                  )
                }
              />
            ))}
          </List>
        </Disclosure>
      )}

      {!reorder && (
        <section className="mt-6">
          <SectionTitle>Routine</SectionTitle>
          {pending === 'archive' ? (
            <Confirm
              confirmLabel="Archiver la routine"
              onCancel={() => setPending(null)}
              onConfirm={() => {
                plan.archiveRoutine(routine.id);
                setPending(null);
              }}
            >
              <p className="font-medium">Archiver {routine.name} ?</p>
              <p className="mt-1 text-(--muted)">Elle quitte ta liste. Ses séances, ses courbes et ses blocs restent dans l'analyse. Tu pourras la désarchiver.</p>
            </Confirm>
          ) : pending === 'delete' ? (
            <Confirm
              destructive
              keepLabel="Garder la routine"
              confirmLabel="Supprimer la routine"
              onCancel={() => setPending(null)}
              onConfirm={() => {
                plan.deleteRoutine(routine.id);
                nav.back();
              }}
            >
              <p className="font-medium">Supprimer {routine.name} ?</p>
              <p className="mt-1 text-(--muted)">
                Jamais faite, elle n'a aucun historique : elle disparaît avec ses {active.length + archived.length} séances. C'est définitif.
              </p>
            </Confirm>
          ) : (
            <ul aria-label="Actions" className="pt-1">
              <ActionRow label="Renommer" onClick={() => setRenaming(true)} />
              {!routine.current && !routine.archived && (
                <ActionRow
                  label="Définir comme routine courante"
                  meta={`Ses séances remplacent celles de ${st.routines.find((r) => r.current)?.name ?? 'la routine actuelle'} en salle. Un nouveau bloc commence.`}
                  onClick={() => plan.setCurrent(routine.id)}
                />
              )}
              {routine.archived ? (
                <ActionRow label="Désarchiver" meta="Elle revient dans ta liste. Sa Référence et ses courbes reprennent où elles s'étaient arrêtées." onClick={() => plan.unarchiveRoutine(routine.id)} />
              ) : routine.current ? (
                <ActionNote>La routine courante ne s'archive pas. Définis d'abord une autre routine comme courante.</ActionNote>
              ) : executed ? (
                <ActionRow label="Archiver" meta="Déjà faite : elle s'archive, son historique reste entier." onClick={() => setPending('archive')} />
              ) : (
                <ActionRow label="Supprimer" meta="Jamais faite : rien à garder, elle se supprime." onClick={() => setPending('delete')} />
              )}
            </ul>
          )}
        </section>
      )}

      {(routine.archived || reorder) && <div className="h-(--pad-bottom)" />}

      <NameSheet
        open={renaming}
        title="Renommer la routine"
        label="Nom de la routine"
        initial={routine.name}
        submitLabel="Renommer"
        requireChange
        validate={(n) => nameError(n, taken, 'routine', routine.id)}
        onClose={() => setRenaming(false)}
        onSubmit={(n) => {
          plan.renameRoutine(routine.id, n);
          setRenaming(false);
        }}
      />
      <CreateSeanceSheet
        open={creating}
        routineId={routine.id}
        onClose={() => setCreating(false)}
        onCreated={(sid) => {
          setCreating(false);
          openSeance(sid);
        }}
      />
    </Screen>
  );
}

/* ------------------------------------------------------------------------ */
/* Création d'une séance : vierge, ou copiée d'une existante (ADR 0015)        */
/* ------------------------------------------------------------------------ */

type Step = { step: 'choice' } | { step: 'pick' } | { step: 'name'; sourceId: string | null };

export function CreateSeanceSheet({
  open,
  routineId,
  onClose,
  onCreated,
  initial,
}: {
  open: boolean;
  routineId: string;
  onClose: () => void;
  onCreated: (seanceId: string) => void;
  /** Ouvre directement sur une étape (« Dupliquer » depuis l'éditeur). */
  initial?: Step;
}) {
  const st = usePlan();
  const [step, setStep] = useState<Step>(initial ?? { step: 'choice' });
  const routine = st.routines.find((r) => r.id === routineId);
  if (!routine) return null;
  const taken = routine.seances.map((s) => ({ id: s.id, name: s.name, archived: s.archived }));
  const close = () => {
    setStep(initial ?? { step: 'choice' });
    onClose();
  };

  if (step.step === 'name') {
    const src = step.sourceId ? st.routines.flatMap((r) => r.seances.map((s) => ({ r, s }))).find((x) => x.s.id === step.sourceId) : null;
    return (
      <NameSheet
        open={open}
        title={src ? `Copier ${src.s.name}` : 'Séance vierge'}
        label="Nom de la séance"
        initial={src ? nextFreeName(src.s.name, taken.map((t) => t.name)) : ''}
        intro={
          src ? (
            <>
              Copie de {src.s.name} · {src.r.name}, dans {routine.name}. Les deux séances seront indépendantes. La copie part sans Référence ni courbe
              tant qu'elle n'a pas été faite ; tes records restent affichés.
            </>
          ) : (
            `Dans ${routine.name}. Tu ajoutes les exos ensuite.`
          )
        }
        submitLabel={src ? 'Créer la copie' : 'Créer la séance'}
        validate={(n) => nameError(n, taken, 'seance')}
        onClose={close}
        onSubmit={(n) => {
          const sid = src ? plan.duplicateSeance(src.s.id, routine.id, n) : plan.createSeance(routine.id, n);
          setStep(initial ?? { step: 'choice' });
          onCreated(sid);
        }}
      />
    );
  }

  // Source : toutes les séances, la routine courante en tête, archivées comprises.
  const groups = [...st.routines].sort((a, b) => Number(b.current) - Number(a.current) || Number(a.archived) - Number(b.archived));

  return (
    <Sheet open={open} title={step.step === 'choice' ? 'Nouvelle séance' : 'Copier quelle séance ?'} onClose={close}>
      {step.step === 'choice' ? (
        <List label="Point de départ">
          <Row title="Séance vierge" meta="tu ajoutes les exos un par un" onClick={() => setStep({ step: 'name', sourceId: null })} />
          <Row
            title="Partir d'une séance existante"
            meta="copie ses exos et ses prescriptions, puis tu ajustes"
            onClick={() => setStep({ step: 'pick' })}
          />
        </List>
      ) : (
        <>
          <div className="px-5">
            <TextLink tone="muted" onClick={() => setStep({ step: 'choice' })}>
              Revenir au choix
            </TextLink>
          </div>
          {groups.map((r) =>
            r.seances.length === 0 ? null : (
              <section key={r.id}>
                <SectionTitle aside={r.current ? 'courante' : r.archived ? 'archivée' : undefined}>{r.name}</SectionTitle>
                <List label={r.name}>
                  {r.seances.map((s) => (
                    <Row
                      key={s.id}
                      title={s.name}
                      meta={`${s.items.length === 0 ? 'aucun exo' : exos(s.items.length)}${s.archived ? ' · archivée' : ''}`}
                      muted={s.archived}
                      onClick={() => setStep({ step: 'name', sourceId: s.id })}
                    />
                  ))}
                </List>
              </section>
            ),
          )}
        </>
      )}
    </Sheet>
  );
}

