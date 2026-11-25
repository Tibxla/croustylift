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
// BLOC (`kg="bloc"`, instrument de la Salle, variante A4 validée le 25/11) :
// « 140 kg » forme UN bloc, centré en entier sur l'aiguille ; « kg » suit le
// nombre sur sa ligne de base, à un peu plus du tiers de sa taille. Le nombre
// quitte l'aiguille, vers la gauche, de la moitié de « kg ». La correction et
// l'éditeur de séance passée gardent le nombre seul centré, « kg » accroché.
//
// SAISIE PRÉCISE : toucher la valeur ouvre le clavier numérique (inputmode
// decimal, virgule acceptée, 56 px au moins donc pas de zoom iOS) pour une valeur
// hors du
// pas de la règle. La valeur suit la frappe, bornée (`parseTypedValue`), et la
// règle se recale dessus : toucher « Logger » sans fermer le clavier logge bien
// la valeur tapée. Entrée ou toucher ailleurs garde la valeur, Échap ou un champ
// vide rend celle d'avant. Le clavier reste facultatif : la règle est le geste
// principal.
import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useCompact, useCompactTight } from '../../ui';
import { formatWeight } from './format';
import { parseTypedValue, WEIGHT_MAX_KG } from './stepper-utils';

const FACE = 'font-[650] leading-none tracking-[-0.045em]';
/** Marge d'écran de chaque côté, et place de « kg » (écart compris) à droite :
 *  le nombre centré tient si sa largeur ne dépasse pas la largeur moins 2 × (marge + kg). */
const GUTTER = 20;
const KG_ROOM = 34;

function Kg({ bloc, size }: { bloc: boolean; size: number }) {
  if (bloc) {
    // Dans le bloc : « kg » compte dans le centrage.
    return (
      <span aria-hidden className="ml-[0.2em] whitespace-nowrap font-medium text-muted" style={{ fontSize: Math.round(size * 0.36) }}>
        kg
      </span>
    );
  }
  // Largeur nulle : « kg » suit le nombre sur sa ligne de base sans décaler son centrage.
  return (
    <span aria-hidden className="w-0 overflow-visible whitespace-nowrap">
      <span className="ml-1.5 text-[22px] font-medium text-muted">kg</span>
    </span>
  );
}

export function WeightReadout({
  value,
  onChange,
  kg = 'accroche',
  size,
}: {
  value: number;
  onChange: (kg: number) => void;
  /** « accroche » (défaut) : le nombre seul centré, « kg » accroché à sa droite ;
   *  « bloc » : « nombre kg » centré en entier (cf. en-tête). */
  kg?: 'accroche' | 'bloc';
  /** Taille de base imposée par l'écran ; sinon 72, 56 sur écran bas, 48 très bas. */
  size?: number;
}) {
  // Écran bas (360×780) : 56 px au lieu de 72 ; très bas (375×667) : 48 px. La
  // rangée RIR reste au-dessus de la barre.
  const compact = useCompact();
  const tight = useCompactTight();
  const base = size ?? (tight ? 48 : compact ? 56 : 72);
  const bloc = kg === 'bloc';
  // Place de « kg » : de chaque côté quand il est accroché (le nombre reste au
  // centre), une seule fois dans le bloc.
  const kgRoom = bloc ? Math.round(base * 0.55) : 2 * KG_ROOM;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // La valeur d'avant la saisie, rendue par Échap ou un champ vide.
  const before = useRef(value);
  const shown = formatWeight(value);
  const text = editing ? draft || '0' : shown;

  // Taille ajustée : une copie invisible du texte, à la taille de base, dit sa
  // largeur ; au-delà de la place, la taille se réduit d'autant (affichage et saisie).
  const box = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [fit, setFit] = useState({ size: base, width: 0 });
  useLayoutEffect(() => {
    const b = box.current;
    const p = probe.current;
    if (!b || !p || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const room = b.clientWidth - 2 * GUTTER - kgRoom;
      const natural = p.getBoundingClientRect().width;
      const size = natural > room ? Math.max(32, Math.floor((base * room) / natural)) : base;
      setFit({ size, width: Math.ceil((natural * size) / base) + 4 });
    };
    // La copie change de taille avec le texte, la boîte avec l'écran.
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    ro.observe(p);
    return () => ro.disconnect();
  }, [base, kgRoom]);

  const start = () => {
    before.current = value;
    // iOS n'ouvre le clavier que si le focus est donné DANS le geste : le champ est
    // monté de façon synchrone, puis focalisé tout de suite.
    flushSync(() => {
      setDraft(shown);
      setEditing(true);
    });
    input.current?.focus();
    input.current?.select();
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

  return (
    <div ref={box} className="relative flex items-center justify-center overflow-hidden" style={{ height: base }}>
      {editing ? (
        <span className="inline-flex items-baseline">
          <input
            ref={input}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            aria-label="Poids en kg, valeur précise"
            value={draft}
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
            className={`focus-own tnum min-w-[0.6em] border-b-2 border-ink bg-transparent p-0 text-center text-ink outline-none ${FACE}`}
            // Hauteur = taille du texte, bordure comprise : sans elle le champ
            // dépassait la boîte (89 px pour 72, `overflow-hidden`) et son
            // soulignement, le seul signe « je tape ici », était rogné.
            style={{ fontSize: fit.size, height: fit.size, width: fit.width || undefined }}
          />
          <Kg bloc={bloc} size={fit.size} />
        </span>
      ) : (
        <button
          type="button"
          onClick={start}
          aria-label={`Poids : ${shown} kg. Toucher pour saisir une valeur précise`}
          className="flex h-full w-full items-center justify-center text-ink active:opacity-70"
        >
          <span aria-hidden className="inline-flex items-baseline">
            <span className={`tnum ${FACE}`} style={{ fontSize: fit.size }}>
              {shown}
            </span>
            <Kg bloc={bloc} size={fit.size} />
          </span>
        </button>
      )}
      <span ref={probe} aria-hidden className={`tnum pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap ${FACE}`} style={{ fontSize: base }}>
        {text}
      </span>
    </div>
  );
}
