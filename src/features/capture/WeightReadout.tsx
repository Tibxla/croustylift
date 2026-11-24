// Le poids de la série en cours, lu en grand au-dessus de la règle, et saisi au
// clavier sur demande.
//
// CENTRAGE (demande de l'utilisateur) : la VALEUR entière est centrée sur
// l'aiguille de la règle, avec ou sans virgule (80 comme 82,5 ou 126,25) ;
// « kg » s'accroche à sa droite, sur sa ligne de base, sans compter dans le
// centrage. Une valeur longue réduit sa taille juste ce qu'il faut pour ne
// toucher ni le bord ni « kg » (mesurée par ResizeObserver sur une copie
// invisible à 72 px). Le saut entre 80 et 82,5 est voulu.
//
// SAISIE PRÉCISE : toucher la valeur ouvre le clavier numérique (inputmode
// decimal, virgule acceptée, 72 px donc pas de zoom iOS) pour une valeur hors du
// pas de la règle. La valeur suit la frappe, bornée (`parseTypedValue`), et la
// règle se recale dessus : toucher « Logger » sans fermer le clavier logge bien
// la valeur tapée. Entrée ou toucher ailleurs garde la valeur, Échap ou un champ
// vide rend celle d'avant. Le clavier reste facultatif : la règle est le geste
// principal.
import { useLayoutEffect, useRef, useState } from 'react';
import { formatWeight } from './format';
import { parseTypedValue, WEIGHT_MAX_KG } from './stepper-utils';

const BIG = 'text-[72px] font-[650] leading-none tracking-[-0.045em]';
const SIZE = 72;
/** Marge d'écran de chaque côté, et place de « kg » (écart compris) à droite :
 *  le nombre centré tient si sa largeur ne dépasse pas la largeur moins 2 × (marge + kg). */
const GUTTER = 20;
const KG_ROOM = 34;

export function WeightReadout({ value, onChange }: { value: number; onChange: (kg: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // La valeur d'avant la saisie, rendue par Échap ou un champ vide.
  const before = useRef(value);
  const shown = formatWeight(value);
  const box = useRef<HTMLButtonElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(SIZE);
  useLayoutEffect(() => {
    const b = box.current;
    const p = probe.current;
    if (!b || !p || typeof ResizeObserver === 'undefined') return;
    const fit = () => {
      const room = b.clientWidth - 2 * (GUTTER + KG_ROOM);
      const natural = p.getBoundingClientRect().width;
      setSize(natural > room ? Math.max(32, Math.floor((SIZE * room) / natural)) : SIZE);
    };
    // La copie change de taille avec le texte, la boîte avec l'écran.
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    ro.observe(p);
    return () => ro.disconnect();
  }, [editing]);

  const start = () => {
    before.current = value;
    setDraft(shown);
    setEditing(true);
  };
  const type = (raw: string) => {
    const clean = raw.replace(/[^\d.,]/g, '');
    setDraft(clean);
    // Rien d'exploitable (vide, « , ») : on garde la valeur d'avant pour l'instant.
    if (/\d/.test(clean)) onChange(parseTypedValue(clean, 0, WEIGHT_MAX_KG, before.current, true));
  };
  const close = (raw: string) => {
    setEditing(false);
    if (!/\d/.test(raw)) onChange(before.current);
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
          onChange={(e) => type(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setDraft('');
              onChange(before.current);
              setEditing(false);
            }
          }}
          onBlur={(e) => close(e.currentTarget.value)}
          className={`focus-own tnum w-full min-w-0 border-b-2 border-ink bg-transparent text-center text-ink outline-none ${BIG}`}
        />
        <span className="pointer-events-none absolute bottom-1 right-5 text-[22px] font-medium text-muted">kg</span>
      </div>
    );
  }

  return (
    <button
      ref={box}
      type="button"
      onClick={start}
      aria-label={`Poids : ${shown} kg. Toucher pour saisir une valeur précise`}
      className="relative flex h-[72px] w-full items-center justify-center overflow-hidden text-ink active:opacity-70"
    >
      <span aria-hidden className="inline-flex items-baseline">
        <span className="tnum font-[650] leading-none tracking-[-0.045em]" style={{ fontSize: size }}>
          {shown}
        </span>
        {/* Largeur nulle : « kg » suit le nombre sans décaler son centrage. */}
        <span className="w-0 overflow-visible whitespace-nowrap">
          <span className="ml-1.5 text-[22px] font-medium text-muted">kg</span>
        </span>
      </span>
      <span ref={probe} aria-hidden className={`tnum pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap ${BIG}`}>
        {shown}
      </span>
    </button>
  );
}
