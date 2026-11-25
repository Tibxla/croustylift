// Bande des séries de l'exo affiché (variante A4 de la Salle, 25/11) : une case
// par série prévue, une par CÔTÉ en unilatéral (« 2 G », « 2 D »), modèle pur
// dans set-band.ts. Sous le numéro et son statut (▲ record, ▲ battue, ▬ égalée),
// UNE ligne : « 171×8 R1 », poids tronqué à l'entier, reps, et le RIR en gris.
// La valeur exacte est dans le nom lu et dans la feuille de correction. En
// unilatéral, l'en-tête « 6 G » ne garde que le signe du statut (le mot ne tient
// pas à 375 px) : le mot est dans le nom lu, comme dans l'ancienne bande.
//
// Quatre cases entières dès 360 px d'écran, trois en dessous : jamais de case
// coupée au repos. Au-delà, la bande défile, se cale sur une case entière et
// garde la série en cours en vue, deux cases faites avant elle (en unilatéral,
// la série d'avant entière : « 2 G » et « 2 D » restent ensemble). Recadrage
// instantané (aucune animation : il suit chaque log).
//
// Case en cours : le brouillon en gris, dans une pastille arrondie (fond de
// groupe, `rounded-cell` ; la sélection du traitement « Doux » retenue le 25/11)
// et soulignée d'un trait épais. La pastille déborde de 8 px à gauche, sans
// rien pousser : la bande garde sa hauteur. Une case
// loggée se touche : elle ouvre la feuille de correction de CETTE ligne
// (SetEditSheet), visée par son id. Sa valeur est soulignée d'un filet gris
// (« ça se touche ») ; une case à faire ne se touche pas, une série sans id (cache
// d'ancien format) non plus. Pressée, la case prend le fond des filets, sans
// enfoncement. Annuler la dernière série reste dans le pied.
import { useLayoutEffect, useRef } from 'react';
import type { PerformedSet } from '../../domain/types';
import { Sign, TONE } from '../../ui';
import { badgeStatus, type SetBadge } from './set-badges';
import { bandCellName, bandFirstShown, bandParts, type BandCell } from './set-band';

type Draft = Pick<PerformedSet, 'weightKg' | 'reps' | 'rir'>;

export function SetBand({
  cells,
  badges,
  draft,
  unilateral,
  onEdit,
}: {
  cells: BandCell[];
  /** Badges alignés sur les séries (`BandCell.index`). */
  badges: readonly SetBadge[];
  draft: Draft;
  unilateral: boolean;
  /** Ouvre la correction de la ligne d'id `setId`. */
  onEdit: (setId: string) => void;
}) {
  const band = useRef<HTMLOListElement>(null);
  const current = cells.findIndex((c) => c.state === 'current');
  useLayoutEffect(() => {
    const el = band.current;
    // Calée sur une case entière (`bandFirstShown`) : deux cases avant la série
    // en cours, les paires G et D ensemble en unilatéral.
    const first = el?.children[bandFirstShown(current, unilateral)] as HTMLElement | undefined;
    if (!el || !first) return;
    el.scrollLeft = first.offsetLeft - 20;
  }, [current, cells.length, unilateral]);

  return (
    <ol
      ref={band}
      className="relative flex overflow-x-auto px-5"
      style={{ scrollbarWidth: 'none', scrollSnapType: 'x mandatory', scrollPaddingLeft: 20 }}
      aria-label={unilateral ? 'Séries de cet exo, gauche et droite' : 'Séries de cet exo'}
    >
      {cells.map((c) => {
        const st = c.state === 'logged' ? badgeStatus(badges[c.index] ?? null) : null;
        const name = bandCellName(c, badges, draft);
        const values = c.set ?? (c.state === 'current' ? draft : null);
        const parts = values ? bandParts(values) : null;
        const body = (
          <>
            <span aria-hidden className="flex h-[18px] items-center gap-1 overflow-hidden whitespace-nowrap text-[13px] leading-[18px]">
              <span className={`tnum ${c.state === 'current' ? 'font-semibold text-ink' : 'text-faint'}`}>{c.label}</span>
              {st && (
                <span className={`inline-flex items-center gap-0.5 ${TONE[st.v]}`}>
                  <Sign v={st.v} size={9} />
                  {!unilateral && st.short}
                </span>
              )}
            </span>
            <span
              aria-hidden
              className={`tnum mt-0.5 block whitespace-nowrap text-[14px] font-medium leading-5 tracking-[-0.01em] [@media(max-width:359px)]:text-[15px] ${
                c.state === 'logged' ? 'text-ink' : c.state === 'current' ? 'text-muted' : 'text-faint'
              }`}
            >
              {parts ? (
                <span className={c.id ? 'underline decoration-dim decoration-1 underline-offset-[4px]' : ''}>
                  {parts.load}
                  <span className={`font-normal ${c.state === 'logged' ? 'text-muted' : ''}`}>{'\u2009'}{parts.rir}</span>
                </span>
              ) : (
                '·'
              )}
            </span>
          </>
        );
        return (
          <li
            key={c.key}
            aria-label={c.id ? undefined : name}
            className="relative min-w-0 flex-none basis-1/4 [@media(max-width:359px)]:basis-1/3"
            style={{ scrollSnapAlign: 'start' }}
          >
            {c.id ? (
              <button
                type="button"
                aria-label={`Corriger la s${name.slice(1)}`}
                onClick={() => c.id && onEdit(c.id)}
                className="block w-full rounded-cell pb-1.5 pr-1.5 text-left active:bg-line"
              >
                {body}
              </button>
            ) : (
              <div className={`rounded-cell pb-1.5 pr-1.5 ${c.state === 'current' ? '-ml-2 bg-surface pl-2' : ''}`}>{body}</div>
            )}
            <span
              aria-hidden
              className={`pointer-events-none absolute bottom-0 left-0 right-2 rounded-[2px] ${
                c.state === 'current' ? 'h-[3px] bg-ink' : c.state === 'logged' ? 'h-px bg-muted' : 'h-px bg-line'
              }`}
            />
          </li>
        );
      })}
    </ol>
  );
}
