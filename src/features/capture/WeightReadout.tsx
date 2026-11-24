// Le poids de la série en cours, lu en grand au-dessus de la règle, et saisi au
// clavier sur demande.
//
// CENTRAGE (demande du 23/11) : rien ne saute en passant de 80 à 82,5. La partie
// entière finit pile au centre (au-dessus de l'aiguille de la règle), les
// décimales commencent au centre, et « kg » tient une place fixe au bord droit.
// Avec des chiffres tabulaires, la partie entière ne bouge pas quand les
// décimales apparaissent ou disparaissent, ni « kg ».
//
// SAISIE PRÉCISE : toucher la valeur ouvre le clavier numérique (inputmode
// decimal, virgule acceptée, 72 px donc pas de zoom iOS) pour une valeur hors du
// pas de la règle. Entrée ou toucher ailleurs valide, Échap ou un champ vide
// annule ; la valeur est bornée (`parseTypedValue`) et la règle se recale dessus.
// Le clavier reste facultatif : la règle est le geste principal.
import { useRef, useState } from 'react';
import { formatWeight } from './format';
import { parseTypedValue, WEIGHT_MAX_KG } from './stepper-utils';

const BIG = 'text-[72px] font-[650] leading-none tracking-[-0.045em]';

export function WeightReadout({ value, onChange }: { value: number; onChange: (kg: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Échap pose ce drapeau : le `blur` qui suit ne doit pas valider.
  const cancelled = useRef(false);
  const shown = formatWeight(value);
  const [whole, decimals] = shown.split(',');

  const start = () => {
    cancelled.current = false;
    setDraft(shown);
    setEditing(true);
  };
  const commit = (raw: string) => {
    setEditing(false);
    if (cancelled.current) return;
    onChange(parseTypedValue(raw, 0, WEIGHT_MAX_KG, value, true));
  };

  if (editing) {
    return (
      <div className="relative flex h-[72px] items-center justify-center px-5">
        <input
          // Le champ ne vit que le temps de la saisie, ouverte par un toucher.
          autoFocus
          type="text"
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          aria-label="Poids en kg, valeur précise"
          value={draft}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d.,]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => commit(e.currentTarget.value)}
          className={`focus-own tnum w-full min-w-0 border-b-2 border-ink bg-transparent text-center text-ink outline-none ${BIG}`}
        />
        <span className="pointer-events-none absolute bottom-1 right-5 text-[22px] font-medium text-muted">kg</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      aria-label={`Poids : ${shown} kg. Toucher pour saisir une valeur précise`}
      className="relative flex h-[72px] w-full items-baseline text-ink active:opacity-70"
    >
      <span aria-hidden className={`tnum w-1/2 text-right ${BIG}`}>
        {whole}
      </span>
      <span aria-hidden className={`tnum w-1/2 text-left ${BIG}`}>
        {decimals !== undefined ? `,${decimals}` : ''}
      </span>
      <span aria-hidden className="absolute bottom-1 right-5 text-[22px] font-medium text-muted">
        kg
      </span>
    </button>
  );
}
