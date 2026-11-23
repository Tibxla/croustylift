// PROTOTYPE JETABLE · socle E, surface Séances (édition du plan, au calme).
//
// Trois niveaux, une page chacun :
//   index    les routines : la courante en tête (trait blanc cassé + le mot),
//            les autres, les archivées repliées ; « Créer une routine » est
//            l'action principale (bloc plein en bas).
//   routine  une routine : ses séances dans l'ordre (Réordonner = Monter /
//            Descendre en mots), créer une séance vierge ou copiée d'une autre
//            (ADR 0015), séances archivées repliées, actions de la routine
//            (renommer, définir courante, archiver ou supprimer, désarchiver).
//   seance   l'éditeur (seances-editeur.tsx) : prescriptions aux steppers,
//            notes d'instructions, catalogue, décompte par muscle, Enregistrer
//            actif seulement si le plan diffère de la version enregistrée.
//
// Pas de duplication de ROUTINE : l'ADR 0015 l'écarte (elle casserait la
// Référence et la courbe de chaque séance copiée). On duplique une séance.
// Aucun usage du signal ici : rien n'y est « mieux que la dernière fois ».
// État : fixtures-seances.ts (store au niveau module, copie des fixtures).
import { useState } from 'react';
import { nameError, plan, routineMeta, usePlan } from './fixtures-seances';
import { EmptyState, List, PrimaryButton, Row, Rule, Screen, ScreenHeader, SectionTitle, Switch } from './kit';
import { Disclosure, NameSheet } from './seances-ui';
import { SeanceEditor } from './seances-editeur';
import { RoutinePage } from './seances-routine';
import { Pages, useNav } from './shell';

export function Seances() {
  return (
    <Pages
      pages={{
        index: () => <Routines />,
        routine: (p) => <RoutinePage id={p.id ?? ''} />,
        seance: (p) => <SeanceEditor seanceId={p.id ?? ''} />,
      }}
    />
  );
}

function Routines() {
  const nav = useNav();
  const s = usePlan();
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const current = s.routines.find((r) => r.current && !r.archived);
  const others = s.routines.filter((r) => !r.current && !r.archived);
  const archived = s.routines.filter((r) => r.archived);
  const open = (id: string) => nav.push('routine', { id });
  const taken = s.routines.map((r) => ({ id: r.id, name: r.name, archived: r.archived }));

  return (
    <Screen bottom={<PrimaryButton onClick={() => setCreating(true)}>Créer une routine</PrimaryButton>}>
      <ScreenHeader title="Routines" />
      {s.routines.length === 0 ? (
        <EmptyState title="Aucune routine" />
      ) : (
        <>
          {current && (
            <List label="Routine courante">
              <Row
                current
                title={current.name}
                meta={
                  <>
                    <span className="font-medium text-(--ink)">courante</span> · {routineMeta(current)}
                  </>
                }
                onClick={() => open(current.id)}
                ariaLabel={`${current.name}, routine courante`}
              />
            </List>
          )}
          {others.length > 0 && (
            <>
              <SectionTitle>Autres routines</SectionTitle>
              <List label="Autres routines">
                {others.map((r) => (
                  <Row key={r.id} title={r.name} meta={routineMeta(r)} onClick={() => open(r.id)} />
                ))}
              </List>
            </>
          )}
          {archived.length > 0 && (
            <Disclosure label="Routines archivées" count={archived.length} open={showArchived} onToggle={() => setShowArchived((v) => !v)}>
              <p className="px-5 pb-3 text-[14px] leading-[1.45] text-(--muted)">
                Hors du plan. Leurs courbes et leurs blocs restent dans l'analyse.
              </p>
              <List label="Routines archivées">
                {archived.map((r) => (
                  <Row key={r.id} muted title={r.name} meta={`archivée · ${routineMeta(r)}`} onClick={() => open(r.id)} />
                ))}
              </List>
            </Disclosure>
          )}
        </>
      )}

      <PrototypeSection />

      <NameSheet
        open={creating}
        title="Nouvelle routine"
        label="Nom de la routine"
        submitLabel="Créer la routine"
        intro={s.routines.length === 0 ? 'Ta première routine devient la routine courante.' : undefined}
        validate={(n) => nameError(n, taken, 'routine')}
        onClose={() => setCreating(false)}
        onSubmit={(n) => {
          const id = plan.createRoutine(n);
          setCreating(false);
          open(id);
        }}
      />
    </Screen>
  );
}

/** Commandes du prototype (absentes de l'app réelle), même motif que Réglages. */
function PrototypeSection() {
  const s = usePlan();
  return (
    <section className="mt-10">
      <Rule strong />
      <SectionTitle aside="absent de l'app">Commandes du prototype</SectionTitle>
      <div className="border-t border-(--line)">
        <Switch
          label="Simuler un compte vide"
          meta="aucune routine, pour voir l'état vide"
          checked={s.simulateEmpty}
          onChange={plan.setSimulateEmpty}
        />
      </div>
    </section>
  );
}
