// PROTOTYPE JETABLE · socle E, surface Exercices : formulaire d'un exo.
// Trois usages, un seul formulaire (comme ExerciseForm.tsx de l'app) :
//   - créer un exo perso (pré-rempli par la recherche si elle n'a rien trouvé) ;
//   - modifier un exo perso ;
//   - personnaliser un exo de base pour soi (override, ADR 0007) : seuls les
//     champs qui diffèrent de la base sont écrits, l'original reste lisible
//     sous chaque champ modifié.
// La note d'instructions n'est pas ici : elle se modifie sur la fiche, et
// l'écrire ne crée jamais d'override.
//
// Validation de l'app réelle (exercise-input.ts) : un nom, au moins un muscle
// principal. Les messages s'affichent sous le champ fautif après un essai.
import { useState } from 'react';
import { CheckBox, FieldError, ImplicitSubmit, TextField } from './exercices-champs';
import { canonical, catalogue, MUSCLES, useCatalogue, type Muscle } from './fixtures-exercices';
import { Choice, PrimaryButton, Screen, ScreenHeader, SectionTitle } from './kit';
import { useNav } from './shell';

export function ExoForm({ id, prefill }: { id?: string; prefill?: string }) {
  const nav = useNav();
  const all = useCatalogue();
  const exo = id ? all.find((e) => e.id === id) : undefined;
  const isBase = exo?.kind === 'base';
  const [name, setName] = useState(exo?.shownName ?? prefill ?? '');
  const [muscles, setMuscles] = useState<Muscle[]>(exo?.shownMuscles ?? []);
  const [unilateral, setUnilateral] = useState(exo?.shownUnilateral ?? false);
  const [tried, setTried] = useState(false);

  const trimmed = name.trim().replace(/\s+/g, ' ');
  const nameErr = tried && !trimmed ? 'Donne un nom à l’exercice.' : null;
  const muscleErr = tried && muscles.length === 0 ? 'Choisis au moins un muscle principal.' : null;

  const submit = () => {
    setTried(true);
    if (!trimmed || muscles.length === 0) return;
    const v = { name: trimmed, muscles: canonical(muscles), unilateral };
    if (!exo) {
      const newId = catalogue.create(v);
      nav.back();
      nav.push('fiche', { id: newId });
    } else {
      catalogue.save(exo.id, v);
      nav.back();
    }
  };

  const toggle = (m: Muscle) => setMuscles((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const title = !exo ? 'Nouvel exo perso' : isBase ? (exo.overridden ? 'Ta version' : 'Personnaliser') : 'Modifier l’exo';
  const meta = !exo
    ? 'Visible de toi seul.'
    : isBase
      ? 'Pour toi seul. Le catalogue commun ne change pas, ta note et ton historique non plus.'
      : 'Exo perso, visible de toi seul.';

  const original = (changed: boolean, text: string) => (isBase && changed ? `original : ${text}` : undefined);

  return (
    <form
      className="flex flex-1 flex-col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <ImplicitSubmit />
      <Screen bottom={<PrimaryButton onClick={submit}>{exo ? 'Enregistrer' : 'Créer l’exercice'}</PrimaryButton>}>
        <ScreenHeader title={title} meta={meta} back={{ label: exo ? exo.shownName : 'Exercices', onClick: nav.back }} />

        <TextField
          label="Nom"
          value={name}
          onChange={setName}
          error={nameErr}
          placeholder="Presse inclinée salle 2"
          enterKeyHint="done"
          autoFocus={!exo}
          hint={exo && isBase ? original(trimmed !== exo.name, exo.name) : undefined}
        />

        <div className="mt-2 flex min-h-14 items-center justify-between gap-3 border-b border-(--line) py-1.5 pl-5 pr-2.5">
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold text-(--ink)">Mouvement</span>
            <span className="block text-[14px] text-(--muted)">
              {original(!!exo && unilateral !== exo.unilateral, exo?.unilateral ? 'unilatéral' : 'bilatéral') ??
                (unilateral ? 'un côté à la fois, gauche et droite saisis à part' : 'les deux côtés ensemble')}
            </span>
          </span>
          <Choice
            label="Mouvement"
            value={unilateral ? 'uni' : 'bi'}
            onChange={(v) => setUnilateral(v === 'uni')}
            options={[
              { value: 'bi', label: 'Bilatéral' },
              { value: 'uni', label: 'Unilatéral' },
            ]}
            wrap={false}
          />
        </div>

        <SectionTitle aside={muscles.length === 0 ? 'aucun' : `${muscles.length} choisi${muscles.length > 1 ? 's' : ''}`}>
          Muscles principaux
        </SectionTitle>
        <p className="px-5 text-[14px] leading-[1.45] text-(--muted)">
          {exo && isBase && !sameSet(muscles, exo.muscles)
            ? `original : ${exo.muscles.join(', ')}`
            : 'Ceux que l’exo cible en priorité. Pas de muscle secondaire : il compte ou il ne compte pas.'}
        </p>
        {muscleErr && (
          <div className="px-5">
            <FieldError>{muscleErr}</FieldError>
          </div>
        )}
        <div role="group" aria-label="Muscles principaux" className="mt-2 grid grid-cols-2 border-t border-(--line)">
          {MUSCLES.map((m, i) => {
            const on = muscles.includes(m);
            return (
              <button
                key={m}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(m)}
                className={`flex min-h-12 items-center gap-3 border-b border-(--line) py-2 text-left active:bg-(--line) ${i % 2 === 0 ? 'pl-5 pr-2' : 'pl-3 pr-5'}`}
              >
                <CheckBox checked={on} />
                <span className={`min-w-0 text-[16px] ${on ? 'font-semibold text-(--ink)' : 'text-(--muted)'}`}>{m}</span>
              </button>
            );
          })}
          {MUSCLES.length % 2 === 1 && <span aria-hidden className="border-b border-(--line)" />}
        </div>
      </Screen>
    </form>
  );
}

function sameSet(a: Muscle[], b: Muscle[]) {
  return a.length === b.length && a.every((m) => b.includes(m));
}
