// PROTOTYPE JETABLE · surface Séances, éditeur d'une séance (au calme).
//
// Le plan s'édite en brouillon (gardé dans le store, il survit à un détour par
// une autre surface). « Enregistrer » n'est actif que si le brouillon diffère
// de la version enregistrée : bornes effectives, exos, ordre. + puis − le
// rééteint, basculer Fixe / Fourchette sans changer les bornes aussi. Un
// enregistrement crée une version (ADR 0001) et, dans la routine courante,
// ferme le bloc en cours : on le dit au-dessus du bouton, pas après.
//
// Un exo déplié à la fois (trois champs en fourchette font six steppers). Les
// chiffres se règlent aux steppers, jamais au clavier. La note d'instructions
// appartient à l'exo, hors version : elle s'enregistre à part et n'allume pas
// « Enregistrer ». Doublons d'exos permis (lourd puis léger) : clé = ligne.
// Retour avec un brouillon modifié : feuille qui liste les changements.
import { useEffect, useState } from 'react';
import { foldAccents } from '../../../domain/text';
import { catalog, MUSCLES, type Muscle } from './fixtures-e';
import {
  diffLines,
  exoName,
  FIELD_CEIL,
  FIELD_FLOOR,
  findSeance,
  fmtCountRange,
  fmtDate,
  itemSummary,
  lastDoneText,
  nameError,
  plan,
  plannedCount,
  samePlan,
  seanceExecuted,
  usePlan,
  type Field,
  type FieldKey,
  type PlanItem,
} from './fixtures-seances';
import { Choice, EmptyState, List, PrimaryButton, Row, Screen, ScreenHeader, SecondaryButton, SectionTitle, Sheet, Stepper, TextLink } from './kit';
import { CreateSeanceSheet } from './seances-routine';
import { ActionRow, Confirm, NameSheet, ReorderRow, TextArea, TextField } from './seances-ui';
import { useNav } from './shell';

const LABEL: Record<FieldKey, string> = { sets: 'Séries', reps: 'Reps', rir: 'RIR' };
const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function SeanceEditor({ seanceId }: { seanceId: string }) {
  const nav = useNav();
  const st = usePlan();
  const found = findSeance(st, seanceId);
  const [open, setOpen] = useState<string | null>(null);
  const [reorder, setReorder] = useState(false);
  const [moved, setMoved] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [changes, setChanges] = useState<null | 'guard' | 'review'>(null);
  const [savedV, setSavedV] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [pending, setPending] = useState<null | 'archive' | 'delete'>(null);
  const [scrollTo, setScrollTo] = useState<string | null>(null);

  useEffect(() => {
    if (!scrollTo) return;
    document.getElementById(`exo-${scrollTo}`)?.scrollIntoView({ block: 'start' });
    setScrollTo(null);
  }, [scrollTo]);

  if (!found) {
    return (
      <Screen>
        <ScreenHeader title="Séance introuvable" back={{ label: 'Routine', onClick: nav.back }} />
      </Screen>
    );
  }
  const { routine, seance } = found;
  const saved = seance.items;
  const items = st.drafts[seance.id] ?? saved;
  const dirty = !samePlan(items, saved);
  const lines = dirty ? diffLines(saved, items) : [];
  const empty = items.length === 0;

  const setItems = (next: PlanItem[]) => {
    setSavedV(null);
    plan.setDraft(seance.id, next);
  };
  const update = (rowId: string, k: FieldKey, f: Field) => setItems(items.map((it) => (it.rowId === rowId ? { ...it, [k]: f } : it)));
  const save = () => {
    plan.save(seance.id);
    setSavedV(seance.version + 1);
  };
  const discard = () => {
    plan.discard(seance.id);
    setSavedV(null);
  };
  const tryBack = () => (dirty ? setChanges('guard') : nav.back());
  const nextV = seance.version + 1;

  const bottom = (
    <>
      {dirty && (
        <div className="flex min-h-11 items-center justify-between gap-3">
          <TextLink tone="muted" onClick={discard}>
            Annuler les modifications
          </TextLink>
          <TextLink tone="muted" onClick={() => setChanges('review')} ariaLabel={`Voir les ${plural(lines.length, 'changement')}`}>
            {plural(lines.length, 'changement')}
          </TextLink>
        </div>
      )}
      <div className="flex">
        {empty ? (
          <PrimaryButton disabled>Ajoute au moins un exercice</PrimaryButton>
        ) : dirty ? (
          <PrimaryButton
            onClick={save}
            over={routine.current ? `Version ${nextV} · le bloc en cours se ferme` : `Version ${nextV}`}
            ariaLabel={`Enregistrer, version ${nextV}${routine.current ? ', le bloc en cours se ferme' : ''}`}
          >
            Enregistrer
          </PrimaryButton>
        ) : (
          <PrimaryButton disabled>{savedV ? `Version ${savedV} enregistrée` : 'Aucune modification'}</PrimaryButton>
        )}
      </div>
    </>
  );

  const versionText = seance.version === 0 ? 'aucune version enregistrée' : `version ${seance.version} du ${fmtDate(seance.versionDate)}`;

  return (
    <Screen bottom={bottom}>
      <ScreenHeader
        title={seance.name}
        meta={`${versionText} · ${lastDoneText(seance)}`}
        back={{ label: routine.name, onClick: tryBack }}
        action={
          items.length > 1 ? (
            <TextLink
              tone={reorder ? 'ink' : 'muted'}
              className={`px-1 ${reorder ? 'font-semibold' : ''}`}
              onClick={() => {
                setReorder((v) => !v);
                setMoved(null);
                setOpen(null);
              }}
            >
              {reorder ? 'Terminé' : 'Réordonner'}
            </TextLink>
          ) : undefined
        }
      />
      {savedV !== null && (
        <p role="status" className="sr-only">
          Version {savedV} enregistrée
        </p>
      )}

      {empty ? (
        <EmptyState
          title="Séance vide"
          body="Ajoute un premier exercice. La séance s'enregistre dès qu'elle en compte un."
          action={<SecondaryButton onClick={() => setAdding(true)}>Ajouter un exercice</SecondaryButton>}
        />
      ) : (
        <>
          <ul aria-label="Exercices de la séance" className="border-t border-(--line)">
            {items.map((it, i) => {
              const before = saved.find((x) => x.rowId === it.rowId);
              const state = !before ? 'ajouté' : itemSummary(before) !== itemSummary(it) ? 'modifié' : null;
              const name = exoName(it.exerciseId);
              if (reorder) {
                return (
                  <ReorderRow
                    key={it.rowId}
                    rank={i + 1}
                    title={name}
                    meta={itemSummary(it)}
                    first={i === 0}
                    last={i === items.length - 1}
                    moved={moved === it.rowId}
                    onMove={(d) => {
                      setItems(move(items, i, d));
                      setMoved(it.rowId);
                    }}
                  />
                );
              }
              return (
                <ItemBlock
                  key={it.rowId}
                  item={it}
                  rank={i + 1}
                  name={name}
                  state={state}
                  note={st.notes[it.exerciseId] ?? ''}
                  open={open === it.rowId}
                  onToggle={() => setOpen(open === it.rowId ? null : it.rowId)}
                  onField={(k, f) => update(it.rowId, k, f)}
                  onNote={() => setNoteFor(it.exerciseId)}
                  onRemove={() => {
                    setItems(items.filter((x) => x.rowId !== it.rowId));
                    setOpen(null);
                  }}
                />
              );
            })}
          </ul>
          {!reorder && (
            <div className="px-5 pt-4">
              <SecondaryButton onClick={() => setAdding(true)} className="w-full">
                Ajouter un exercice
              </SecondaryButton>
            </div>
          )}
          {!reorder && <CountSection items={items} saved={saved} dirty={dirty} />}
        </>
      )}

      {!reorder && (
        <section className="mt-6">
          <SectionTitle>Séance</SectionTitle>
          {pending === 'archive' ? (
            <Confirm
              confirmLabel="Archiver la séance"
              onCancel={() => setPending(null)}
              onConfirm={() => {
                plan.archiveSeance(seance.id);
                nav.back();
              }}
            >
              <p className="font-medium">Archiver {seance.name} ?</p>
              <p className="mt-1 text-(--muted)">
                Elle ne se choisit plus en salle. Son historique reste dans l'analyse.
                {routine.current && ' Le plan de la routine courante change : le bloc en cours se ferme.'}
                {dirty && ' Tes modifications non enregistrées sont abandonnées.'} Tu pourras la désarchiver.
              </p>
            </Confirm>
          ) : pending === 'delete' ? (
            <Confirm
              confirmLabel="Supprimer la séance"
              onCancel={() => setPending(null)}
              onConfirm={() => {
                plan.deleteSeance(seance.id);
                nav.back();
              }}
            >
              <p className="font-medium">Supprimer {seance.name} ?</p>
              <p className="mt-1 text-(--muted)">Jamais faite, elle n'a aucun historique. C'est définitif.</p>
            </Confirm>
          ) : (
            <ul className="border-t border-(--line)">
              <ActionRow label="Renommer" onClick={() => setRenaming(true)} />
              {seance.version > 0 && (
                <ActionRow
                  label="Dupliquer"
                  meta={`Copie indépendante de la version enregistrée, dans ${routine.name}, sans historique.`}
                  onClick={() => setDuplicating(true)}
                />
              )}
              {seanceExecuted(seance) ? (
                <ActionRow label="Archiver" meta="Déjà faite : elle s'archive, son historique reste entier." onClick={() => setPending('archive')} />
              ) : (
                <ActionRow label="Supprimer" meta="Jamais faite : rien à garder, elle se supprime." onClick={() => setPending('delete')} />
              )}
            </ul>
          )}
        </section>
      )}

      <CatalogSheet
        open={adding}
        items={items}
        onClose={() => setAdding(false)}
        onPick={(exerciseId) => {
          const it = plan.newItem(exerciseId);
          setItems([...items, it]);
          setAdding(false);
          setReorder(false);
          setOpen(it.rowId);
          setScrollTo(it.rowId);
        }}
      />
      {noteFor && <NoteSheet exerciseId={noteFor} note={st.notes[noteFor] ?? ''} onClose={() => setNoteFor(null)} />}
      <Sheet
        open={changes !== null}
        title={changes === 'guard' ? 'Modifications non enregistrées' : 'Changements non enregistrés'}
        onClose={() => setChanges(null)}
        footer={
          changes === 'guard' ? (
            <>
              <PrimaryButton
                disabled={empty}
                onClick={() => {
                  plan.save(seance.id);
                  nav.back();
                }}
              >
                {empty ? 'Ajoute au moins un exercice' : 'Enregistrer et revenir'}
              </PrimaryButton>
              <SecondaryButton
                onClick={() => {
                  plan.discard(seance.id);
                  nav.back();
                }}
              >
                Abandonner les modifications
              </SecondaryButton>
            </>
          ) : undefined
        }
      >
        <p className="px-5 pb-3 text-[15px] leading-[1.45] text-(--muted)">
          {plural(lines.length, 'changement')} depuis la version {seance.version || 'de départ'}
          {routine.current ? ". Les enregistrer ferme le bloc en cours." : '.'}
        </p>
        <ul className="border-t border-(--line)">
          {lines.map((l) => (
            <li key={l} className="border-b border-(--line) px-5 py-3 text-[16px] leading-[1.4] text-(--ink)">
              {l}
            </li>
          ))}
        </ul>
      </Sheet>
      <NameSheet
        open={renaming}
        title="Renommer la séance"
        label="Nom de la séance"
        initial={seance.name}
        submitLabel="Renommer"
        requireChange
        validate={(n) =>
          nameError(
            n,
            routine.seances.map((x) => ({ id: x.id, name: x.name, archived: x.archived })),
            'seance',
            seance.id,
          )
        }
        onClose={() => setRenaming(false)}
        onSubmit={(n) => {
          plan.renameSeance(seance.id, n);
          setRenaming(false);
        }}
      />
      <CreateSeanceSheet
        open={duplicating}
        routineId={routine.id}
        initial={{ step: 'name', sourceId: seance.id }}
        onClose={() => setDuplicating(false)}
        onCreated={(sid) => {
          setDuplicating(false);
          nav.back();
          nav.push('seance', { id: sid });
        }}
      />
    </Screen>
  );
}

/* ------------------------------------------------------------------------ */
/* Un exo de la séance                                                        */
/* ------------------------------------------------------------------------ */

function ItemBlock({
  item,
  rank,
  name,
  state,
  note,
  open,
  onToggle,
  onField,
  onNote,
  onRemove,
}: {
  item: PlanItem;
  rank: number;
  name: string;
  state: 'ajouté' | 'modifié' | null;
  note: string;
  open: boolean;
  onToggle: () => void;
  onField: (k: FieldKey, f: Field) => void;
  onNote: () => void;
  onRemove: () => void;
}) {
  return (
    <li id={`exo-${item.rowId}`} className="relative scroll-mt-2 border-b border-(--line)">
      {open && <span aria-hidden className="absolute left-0 top-3 h-10 w-[3px] bg-(--ink)" />}
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-16 w-full items-start gap-3 px-5 py-3 text-left active:opacity-70"
      >
        <span className="w-6 flex-none pt-px text-[15px] text-(--faint)">{rank}</span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[17px] leading-[1.25] text-(--ink) ${open ? 'font-semibold' : 'font-medium'}`}>{name}</span>
          <span className="mt-1 flex flex-wrap gap-x-1.5 text-[14px] text-(--muted)">
            <span className="text-(--ink)">{itemSummary(item)}</span>
            {note && <span>· note</span>}
            {state && <span className="font-medium text-(--ink)">· {state}</span>}
          </span>
        </span>
        <span className="flex-none pt-0.5 text-[15px] text-(--muted)">{open ? 'Replier' : 'Régler'}</span>
      </button>
      {open && (
        <div className="pb-2">
          <div className="border-t border-(--line)">
            {(['sets', 'reps', 'rir'] as const).map((k) => (
              <FieldEditor key={k} k={k} value={item[k]} onChange={(f) => onField(k, f)} />
            ))}
          </div>
          <div className="px-5 pt-4">
            <p className="text-[15px] font-semibold text-(--ink)">Note d'instructions</p>
            {note ? (
              <p className="mt-1 max-w-[40ch] text-[15px] leading-[1.45] text-(--muted)">{note}</p>
            ) : (
              <p className="mt-1 text-[15px] text-(--faint)">Aucune note pour cet exo.</p>
            )}
            <TextLink onClick={onNote} ariaLabel={`${note ? 'Modifier' : 'Ajouter'} la note de ${name}`}>
              {note ? 'Modifier la note' : 'Ajouter une note'}
            </TextLink>
          </div>
          <div className="mt-1 border-t border-(--line) px-5 pt-1">
            <TextLink tone="muted" onClick={onRemove} ariaLabel={`Retirer ${name} de la séance`}>
              Retirer de la séance
            </TextLink>
          </div>
        </div>
      )}
    </li>
  );
}

/** Un champ de prescription : Fixe ou Fourchette, puis un ou deux steppers. */
function FieldEditor({ k, value, onChange }: { k: FieldKey; value: Field; onChange: (f: Field) => void }) {
  const label = LABEL[k];
  const floor = FIELD_FLOOR[k];
  const ceil = FIELD_CEIL[k];
  const mode = (
    <Choice
      label={`${label}, type de prescription`}
      className="-ml-2.5 mt-0.5"
      value={value.mode}
      onChange={(m) =>
        onChange(
          m === 'fixe'
            ? { mode: 'fixe', min: value.min, max: value.min }
            : { mode: 'fourchette', min: Math.min(value.min, ceil - 1), max: Math.max(value.min + 1, Math.min(value.max, ceil)) },
        )
      }
      options={[
        { value: 'fixe' as const, label: 'Fixe' },
        { value: 'fourchette' as const, label: 'Fourchette' },
      ]}
    />
  );
  if (value.mode === 'fixe') {
    return <Stepper label={label} meta={mode} value={value.min} min={floor} max={ceil} onChange={(n) => onChange({ mode: 'fixe', min: n, max: n })} />;
  }
  return (
    <>
      <Stepper label={`${label} min`} meta={mode} value={value.min} min={floor} max={value.max} onChange={(n) => onChange({ ...value, min: n })} />
      <Stepper label={`${label} max`} value={value.max} min={value.min} max={ceil} onChange={(n) => onChange({ ...value, max: n })} />
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Décompte des séries prévues                                                */
/* ------------------------------------------------------------------------ */

function CountSection({ items, saved, dirty }: { items: PlanItem[]; saved: PlanItem[]; dirty: boolean }) {
  const now = plannedCount(items);
  const before = plannedCount(saved);
  const muscles = (MUSCLES as readonly string[]).filter((m) => now.byMuscle.some((x) => x.muscle === m) || (dirty && before.byMuscle.some((x) => x.muscle === m)));
  const zero = { min: 0, max: 0 };
  const total = fmtCountRange(now.total);
  const totalBefore = fmtCountRange(before.total);
  return (
    <section aria-label="Décompte des séries prévues">
      <SectionTitle aside={dirty && total !== totalBefore ? `${total} au total · avant ${totalBefore}` : `${total} au total`}>Séries prévues</SectionTitle>
      <dl className="grid grid-cols-2 border-t border-(--line)">
        {muscles.map((m, i) => {
          const v = fmtCountRange(now.byMuscle.find((x) => x.muscle === m)?.range ?? zero);
          const b = fmtCountRange(before.byMuscle.find((x) => x.muscle === m)?.range ?? zero);
          const changed = dirty && v !== b;
          return (
            <div key={m} className={`border-b border-(--line) py-2.5 ${i % 2 === 0 ? 'border-r pl-5 pr-3' : 'pl-4 pr-5'}`}>
              <dt className="text-[14px] text-(--muted)">{m}</dt>
              <dd className="mt-0.5 flex items-baseline gap-2">
                <span className={`text-[20px] leading-tight tracking-[-0.01em] text-(--ink) ${changed ? 'font-semibold' : 'font-medium'}`}>{v}</span>
                {changed && <span className="text-[13px] text-(--faint)">avant {b}</span>}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="px-5 pt-2.5 text-[14px] leading-[1.45] text-(--faint)">
        Une série compte pleine à 5 reps ou plus, en partie en deçà ; un exo unilatéral compte double au total.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Catalogue : recherche + filtre par muscle                                  */
/* ------------------------------------------------------------------------ */

function CatalogSheet({ open, items, onClose, onPick }: { open: boolean; items: PlanItem[]; onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState<Muscle | 'tous'>('tous');
  const used = MUSCLES.filter((m) => catalog.some((c) => c.muscles.includes(m)));
  const fq = foldAccents(q.trim());
  const shown = catalog
    .filter((c) => muscle === 'tous' || c.muscles.includes(muscle))
    .filter((c) => !fq || foldAccents(c.name).includes(fq))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const close = () => {
    setQ('');
    setMuscle('tous');
    onClose();
  };
  return (
    <Sheet open={open} title="Ajouter un exercice" onClose={close}>
      <div className="px-5 pb-1">
        <TextField type="search" label="Rechercher un exercice" hideLabel placeholder="Rechercher un exercice" value={q} onChange={setQ} />
      </div>
      <div className="overflow-x-auto px-3" style={{ scrollbarWidth: 'none' }}>
        <Choice
          label="Muscle"
          wrap={false}
          value={muscle}
          onChange={setMuscle}
          options={[{ value: 'tous' as const, label: 'Tous' }, ...used.map((m) => ({ value: m, label: m[0]!.toUpperCase() + m.slice(1) }))]}
        />
      </div>
      {shown.length === 0 ? (
        <p className="border-t border-(--line) px-5 py-6 text-[15px] text-(--muted)">
          Aucun exercice ne correspond{q.trim() ? ` à « ${q.trim()} »` : ''}{muscle !== 'tous' ? ` dans ${muscle}` : ''}.
        </p>
      ) : (
        <List label="Catalogue">
          {shown.map((c) => {
            const n = items.filter((it) => it.exerciseId === c.id).length;
            return (
              <Row
                key={c.id}
                title={c.name}
                meta={
                  <>
                    {c.muscles.join(' · ')}
                    {n > 0 && <span className="block font-medium text-(--ink)">déjà dans la séance{n > 1 ? `, ${n} fois` : ''}</span>}
                  </>
                }
                value={c.kind === 'perso' ? <span className="text-[14px] font-normal text-(--muted)">perso</span> : undefined}
                onClick={() => {
                  setQ('');
                  setMuscle('tous');
                  onPick(c.id);
                }}
              />
            );
          })}
        </List>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------------ */
/* Note d'instructions (hors version)                                         */
/* ------------------------------------------------------------------------ */

function NoteSheet({ exerciseId, note, onClose }: { exerciseId: string; note: string; onClose: () => void }) {
  const [draft, setDraft] = useState(note);
  const changed = draft.trim() !== note.trim();
  const clearing = changed && draft.trim() === '';
  return (
    <Sheet
      open
      title={`Note · ${exoName(exerciseId)}`}
      onClose={onClose}
      footer={
        <PrimaryButton
          disabled={!changed}
          onClick={() => {
            plan.setNote(exerciseId, draft);
            onClose();
          }}
        >
          {!changed ? 'Aucune modification' : clearing ? 'Effacer la note' : 'Enregistrer la note'}
        </PrimaryButton>
      }
    >
      <div className="px-5 pt-1">
        <TextArea
          label="Note d'instructions"
          value={draft}
          onChange={setDraft}
          placeholder="Prise, réglage de la machine, tempo…"
          hint="Vaut pour cet exo dans toutes tes séances et s'affiche en salle. Elle s'enregistre à part, sans créer de version."
        />
      </div>
    </Sheet>
  );
}
