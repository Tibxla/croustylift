// Bande des séries de l'exo affiché (variante A4 de la Salle, 25/11) : une case
// par série prévue, une par CÔTÉ en unilatéral (« 2 G », « 2 D »), modèle pur
// dans set-band.ts. Sous le numéro et son statut (▲ record, ▲ battue, ▬ égalée),
// UNE ligne : « 171,2×8 R1 », poids en quatre chiffres au plus (décimales
// tronquées au-delà, set-band.ts), reps, et le RIR en gris, en 13 px dès 360 px
// d'écran, 14 px en dessous (trois cases plus larges).
// La valeur exacte est dans le nom lu et dans la feuille de correction. En
// unilatéral, l'en-tête « 6 G » ne garde que le signe du statut (le mot ne tient
// pas à 375 px) : le mot est dans le nom lu, comme dans l'ancienne bande.
//
// Quatre cases entières dès 360 px d'écran, trois en dessous : jamais de case
// coupée au repos. La bande a 20 px de retrait à gauche (le premier numéro
// s'aligne sur les titres), et à droite dès 380 px d'écran (la case suivante
// dépasse alors dans ce retrait : on voit que la bande glisse). Sous 380 px,
// aucun retrait à droite : la quatrième case finit au bord de l'écran, ses
// 5 px de plus par case logent la pastille de la case en cours (cf. plus bas).
// Au-delà, la bande défile, se cale sur une case entière et
// garde la série en cours en vue, deux cases faites avant elle (en unilatéral,
// la série d'avant entière : « 2 G » et « 2 D » restent ensemble ; à trois cases,
// sa seule paire si la série d'avant la pousserait hors de l'écran). Recadrage
// instantané (aucune animation : il suit chaque log).
//
// Une valeur plus large que sa case (reps à trois chiffres, RIR de 10 ou plus)
// se rogne en « … » dans la case au lieu de déborder sur la voisine ; la valeur
// exacte reste dans le nom lu. Tout texte s'arrête 7 px avant la fin de sa case
// (`TEXT_END`) : le jeu de la pastille (4 px) plus l'écart minimal (3 px).
// Place utile mesurée le 25/11 : 78 px à 360 px d'écran (« 171,2×12 R4 » y
// fait 75,6 px à 13 px), 81,75 à 375, 78 à 380, 81,25 à 393, 93 à 320 (14 px,
// 86,5). Avec le retrait droit de 20 px sous 380 px, il en restait 73 à 360. La
// boîte rognée descend de 2 px (compensés, la bande garde sa hauteur) pour ne
// pas couper le filet souligné.
//
// Case en cours : le brouillon en gris, dans une pastille arrondie (fond de
// groupe, `rounded-cell` ; la sélection du traitement « Doux » retenue le 25/11)
// et soulignée d'un trait épais sous son texte. La pastille ÉPOUSE son contenu
// (numéro, côté, valeur) avec le même jeu de 4 px à gauche et à droite : elle
// déborde de 4 px à gauche de la case, sans rien pousser, et s'arrête au plus
// 3 px avant la fin de la case. Il reste donc au moins 3 px entre elle et le
// texte de chaque voisine, valeur rognée comprise. Avant le 25/11 au soir, elle
// remplissait la case jusqu'au bord droit et touchait la case suivante. Une case
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

/** Fin du texte d'une case : 7 px avant son bord droit, le jeu de la pastille
 *  (4 px) et l'écart minimal avec elle (3 px). */
const TEXT_END = 'pr-[7px]';

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
    // Cases entières à l'écran : quatre dès 360 px, trois en dessous.
    const cell = el?.children[0] as HTMLElement | undefined;
    if (!el || !cell) return;
    const columns = Math.max(1, Math.round((el.clientWidth - 20) / cell.offsetWidth));
    const first = el.children[bandFirstShown(current, unilateral, columns)] as HTMLElement | undefined;
    if (!first) return;
    el.scrollLeft = first.offsetLeft - 20;
  }, [current, cells.length, unilateral]);

  return (
    <ol
      ref={band}
      className="relative flex overflow-x-auto pl-5 min-[380px]:pr-5"
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
              className={`tnum -mb-0.5 mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap pb-0.5 text-[13px] font-medium leading-5 tracking-[-0.01em] [@media(max-width:359px)]:text-[14px] ${
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
                className={`block w-full rounded-cell pb-1.5 text-left active:bg-line ${TEXT_END}`}
              >
                {body}
              </button>
            ) : c.state === 'current' ? (
              // Jeu de 4 px de chaque côté ; largeur plafonnée à la case + 1 px,
              // soit un bord droit 3 px avant la fin de la case.
              <div className="relative -ml-1 w-fit max-w-[calc(100%+1px)] rounded-cell bg-surface px-1 pb-1.5">
                {body}
                <span aria-hidden className="pointer-events-none absolute inset-x-1 bottom-0 h-[3px] rounded-[2px] bg-ink" />
              </div>
            ) : (
              <div className={`pb-1.5 ${TEXT_END}`}>{body}</div>
            )}
            {c.state !== 'current' && (
              <span
                aria-hidden
                className={`pointer-events-none absolute bottom-0 left-0 right-2 h-px rounded-[2px] ${
                  c.state === 'logged' ? 'bg-muted' : 'bg-line'
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
