// Bande des séries de l'exo affiché : une case par série prévue (borne haute du
// plan, plus la série en cours si on la dépasse). Case loggée : rang, statut
// face à la Référence ou au record (signe + mot), poids, puis « ×reps · RIR » :
// les reps ne sont jamais coupées, même avec un poids à décimales à 360 px. Case en cours :
// le brouillon en gris, soulignée d'un trait épais. Au-delà de 4 cases, la bande
// défile et garde la série en cours en vue.
//
// Une case loggée se touche : elle ouvre la feuille de correction de CETTE
// série (SetEditSheet), visée par son id. Son poids est souligné d'un filet
// gris (« ça se touche ») ; une case à faire ne se touche pas, une série sans id
// (cache d'ancien format) non plus. Le bouton prend les marges de la case : la
// hauteur de la bande ne bouge pas d'un pixel (la rangée RIR reste au-dessus de
// la barre du pouce à 360×780). Pressée, la case prend le fond des filets, sans
// enfoncement. Annuler la dernière série reste dans la barre du bas.
import { useLayoutEffect, useRef, type MouseEvent } from 'react';
import type { PerformedSet, Side } from '../../domain/types';
import { pairSidesByOrder, targetSlotForSide } from '../../domain/unilateral';
import { Sign, Status, TONE } from '../../ui';
import { formatWeight } from './format';
import { badgeStatus, type SetBadge } from './set-badges';

interface Draft {
  weightKg: number;
  reps: number;
  rir: number;
}


const cell = (n: number) => `${formatWeight(n)}`;

// En-tête d'une case : le rang, puis le statut (« ▲ record », « ▬ égalée ») ou
// « en cours ». Entre deux cases, les mots ne doivent pas se lire d'un seul
// tenant (« record 2 ▲ battue 3 ») : 12 px au moins avant la case suivante.
// Requêtes sur la largeur de la bande (`@container`, sa boîte de contenu) :
//   - assez large (430 px d'écran) : une ligne ;
//   - 390 px : une ligne, écarts resserrés ; « en cours » n'y tient pas et
//     s'efface (la case en cours garde son rang en gras, son trait épais, et le
//     bloc « Logger la série n » ; le nom lu le dit toujours) ;
//   - 360 px et moins : le mot passe sous le rang, sur une seconde ligne
//     TOUJOURS réservée (rien ne bouge quand un statut apparaît). La rangée RIR
//     garde sa marge au-dessus de la barre du pouce (32 px mesurés en
//     unilatéral avant ces 18 px).
const HEAD =
  'flex h-[18px] items-center gap-x-1.5 pr-1 text-[13px] leading-[18px] @max-[340px]:h-9 @max-[340px]:flex-col @max-[340px]:items-start';
/** « en cours » : effacé là où il ne tient pas sur une ligne (cf. `HEAD`). */
const NOW_WORD = 'text-muted @min-[340px]:@max-[380px]:hidden';

/** Une case loggée qui se touche : le bouton porte les marges de la case. */
const CELL_BTN = 'block w-full min-w-0 pb-2 pr-2 text-left active:bg-line [@media(max-height:700px)]:pb-1';
/** Le poids d'une série loggée : souligné d'un filet gris, il se touche. */
const EDITABLE = 'underline decoration-dim decoration-1 underline-offset-[5px]';

/** La bande défile au-delà de 4 cases ; la série en cours reste en vue. */
function useKeepInView(current: number, slots: number) {
  const band = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    const el = band.current;
    const first = el?.children[Math.max(0, current - 3)] as HTMLElement | undefined;
    if (!el || !first) return;
    el.scrollLeft += first.getBoundingClientRect().left - el.getBoundingClientRect().left - 20;
  }, [current, slots]);
  return band;
}

function Underline({ state }: { state: 'current' | 'logged' | 'empty' }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute bottom-0 left-0 right-2 ${
        state === 'current' ? 'h-[3px] bg-ink' : state === 'logged' ? 'h-px bg-muted' : 'h-px bg-line'
      }`}
    />
  );
}

export function SetBand({
  sets,
  setIds,
  badges,
  draft,
  plannedMax,
  onEdit,
}: {
  sets: PerformedSet[];
  /** Ids des lignes, alignés sur `sets` (`null` : cache d'ancien format). */
  setIds: (string | null)[];
  badges: SetBadge[];
  draft: Draft;
  plannedMax: number;
  /** Ouvre la correction de la série d'id `setId`. */
  onEdit: (setId: string) => void;
}) {
  const slots = Math.max(plannedMax, sets.length + 1);
  const scroll = slots > 4;
  const band = useKeepInView(sets.length, slots);
  return (
    <ol ref={band} className={`@container flex px-5 ${scroll ? 'overflow-x-auto' : ''}`} style={{ scrollbarWidth: 'none' }} aria-label="Séries de cet exo">
      {Array.from({ length: slots }, (_, i) => {
        const rank = i + 1;
        const s = sets[i];
        const isCurrent = i === sets.length;
        const st = s ? badgeStatus(badges[i] ?? null) : null;
        const label = s
          ? `Série ${rank}, ${formatWeight(s.weightKg)} × ${s.reps} · RIR ${s.rir}${st ? `, ${st.word}` : ''}`
          : isCurrent
            ? `Série ${rank} en cours, ${formatWeight(draft.weightKg)} × ${draft.reps} · RIR ${draft.rir}`
            : `Série ${rank}, à faire`;
        const id = s ? (setIds[i] ?? null) : null;
        const body = (
          <>
            <span aria-hidden className={HEAD}>
              <span className={`tnum ${isCurrent ? 'font-semibold text-ink' : 'text-faint'}`}>{rank}</span>
              {st && <Status v={st.v} word={st.word} size={10} />}
              {!s && isCurrent && <span className={NOW_WORD}>en cours</span>}
              {!s && !isCurrent && i >= plannedMax && <span className="text-faint">en plus</span>}
            </span>
            <span
              aria-hidden
              className={`tnum mt-1 block whitespace-nowrap text-[16px] font-medium tracking-[-0.01em] ${s ? 'text-ink' : isCurrent ? 'text-muted' : 'text-faint'}`}
            >
              <span className={id ? EDITABLE : ''}>{s ? cell(s.weightKg) : isCurrent ? cell(draft.weightKg) : '·'}</span>
            </span>
            <span aria-hidden className={`tnum block whitespace-nowrap text-[13px] ${s ? 'text-muted' : 'text-faint'}`}>
              {s ? `×${s.reps} · RIR ${s.rir}` : isCurrent ? `×${draft.reps} · RIR ${draft.rir}` : ' '}
            </span>
          </>
        );
        return (
          <li key={rank} aria-label={id ? undefined : label} className={`relative min-w-0 ${id ? '' : 'pb-2 pr-2 [@media(max-height:700px)]:pb-1'}`} style={{ flex: scroll ? '0 0 25%' : '1 1 0' }}>
            {id ? (
              <button type="button" aria-label={`Corriger la série ${label.slice('Série '.length)}`} className={CELL_BTN} onClick={() => onEdit(id)}>
                {body}
              </button>
            ) : (
              body
            )}
            <Underline state={isCurrent ? 'current' : s ? 'logged' : 'empty'} />
          </li>
        );
      })}
    </ol>
  );
}

const SIDES: { side: Side; letter: string }[] = [
  { side: 'left', letter: 'G' },
  { side: 'right', letter: 'D' },
];

/** Bande d'un exo unilatéral : chaque série tient sur deux demi-lignes, G puis
 *  D, valeurs et signe PAR CÔTÉ. Une série n'est complète qu'avec ses deux côtés.
 *  Une case loggée (complète ou à un côté) se touche en entier, 44 px au moins ;
 *  le côté corrigé est la demi-ligne touchée (au clavier : le premier côté
 *  saisi de la série). */
export function UniSetBand({
  sets,
  setIds,
  badges,
  draft,
  side,
  plannedMax,
  onEdit,
}: {
  sets: PerformedSet[];
  /** Ids des lignes, alignés sur `sets` (`null` : cache d'ancien format). */
  setIds: (string | null)[];
  badges: SetBadge[];
  draft: Draft;
  side: Side;
  plannedMax: number;
  /** Ouvre la correction du côté de la ligne d'id `setId`. */
  onEdit: (setId: string) => void;
}) {
  // Une case par série présente, rangées par rang (même incomplètes : trois
  // gauches de suite font trois séries), et la case en cours est celle que vise
  // le côté choisi (`targetSlotForSide`). Compter les seules séries complètes
  // cachait la 3ᵉ gauche d'un exo prévu à deux séries.
  const pairs = pairSidesByOrder(sets);
  const current = targetSlotForSide(sets, side);
  const slots = Math.max(plannedMax, pairs.length, current + 1);
  const scroll = slots > 4;
  const band = useKeepInView(current, slots);
  const badgeOf = (s: PerformedSet | null) => (s ? badgeStatus(badges[sets.indexOf(s)] ?? null) : null);
  const idOf = (s: PerformedSet | null) => (s ? (setIds[sets.indexOf(s)] ?? null) : null);
  return (
    <ol ref={band} className={`@container flex px-5 ${scroll ? 'overflow-x-auto' : ''}`} style={{ scrollbarWidth: 'none' }} aria-label="Séries de cet exo, gauche et droite">
      {Array.from({ length: slots }, (_, i) => {
        const rank = i + 1;
        const p = pairs[i];
        const isCurrent = i === current;
        const parts = SIDES.map(({ side: sd, letter }) => {
          const s = p ? (sd === 'left' ? p.left : p.right) : null;
          return { sd, letter, s, st: badgeOf(s), live: isCurrent && !s && sd === side };
        });
        const label = `Série ${rank}${isCurrent ? ' en cours' : ''}, ${parts
          .map(({ sd, s, st }) => `${sd === 'left' ? 'gauche' : 'droite'} ${s ? `${formatWeight(s.weightKg)} × ${s.reps}${st ? `, ${st.word}` : ''}` : 'à faire'}`)
          .join(', ')}`;
        // Les côtés loggés de la série qui portent un id : eux seuls se corrigent.
        const editable = parts.flatMap(({ sd, s }) => {
          const id = idOf(s);
          return id && s ? [{ sd, id, set: s }] : [];
        });
        // Au clavier (aucun point touché) : le premier côté saisi de la série.
        const firstId = idOf(sets.find((x) => editable.some((e) => e.set === x)) ?? null);
        const pick = (e: MouseEvent<HTMLButtonElement>) => {
          let id = firstId;
          if (e.detail > 0) {
            // La demi-ligne la plus proche du doigt, parmi les côtés loggés.
            let best = Infinity;
            for (const row of e.currentTarget.querySelectorAll<HTMLElement>('[data-side]')) {
              const hit = editable.find((x) => x.sd === row.dataset.side);
              if (!hit) continue;
              const r = row.getBoundingClientRect();
              const d = Math.abs(e.clientY - (r.top + r.bottom) / 2);
              if (d < best) {
                best = d;
                id = hit.id;
              }
            }
          }
          if (id) onEdit(id);
        };
        const body = (
          <>
            {/* Unilatéral : les statuts sont par côté, plus bas ; l'en-tête n'a
                que le rang et « en cours », effacé sous 380 px de bande plutôt
                que de grandir (la bande a déjà deux lignes de côtés). */}
            <span aria-hidden className="flex h-[18px] items-center gap-x-1.5 pr-1 text-[13px]">
              <span className={`tnum ${isCurrent ? 'font-semibold text-ink' : 'text-faint'}`}>{rank}</span>
              {isCurrent && <span className="text-muted @max-[380px]:hidden">en cours</span>}
              {!isCurrent && !p && i >= plannedMax && <span className="text-faint">en plus</span>}
            </span>
            {parts.map(({ sd, letter, s, st, live }) => (
              <span key={sd} data-side={sd} aria-hidden className="mt-0.5 flex h-[19px] min-w-0 items-center gap-1 whitespace-nowrap">
                <span className={`w-2.5 flex-none text-[13px] ${live ? 'font-semibold text-ink' : 'text-faint'}`}>{letter}</span>
                {/* Jamais tronquée : un poids long (« 22,75×12 ») descend à 13 px. */}
                <span
                  className={`tnum whitespace-nowrap font-medium tracking-[-0.02em] ${s ? 'text-ink' : live ? 'text-muted' : 'text-faint'} ${
                    (s ?? (live ? draft : null)) && `${cell((s ?? draft).weightKg)}×${(s ?? draft).reps}`.length > 7 ? 'text-[13px]' : 'text-[14px]'
                  }`}
                >
                  <span className={idOf(s) ? EDITABLE : ''}>{s ? `${cell(s.weightKg)}×${s.reps}` : live ? `${cell(draft.weightKg)}×${draft.reps}` : '·'}</span>
                </span>
                {st && (
                  <span className={TONE[st.v]}>
                    <Sign v={st.v} size={10} />
                  </span>
                )}
              </span>
            ))}
          </>
        );
        return (
          <li key={rank} aria-label={firstId ? undefined : label} className={`relative min-w-0 ${firstId ? '' : 'pb-2 pr-2 [@media(max-height:700px)]:pb-1'}`} style={{ flex: scroll ? '0 0 25%' : '1 1 0' }}>
            {firstId ? (
              <button type="button" aria-label={`Corriger la série ${label.slice('Série '.length)}`} className={CELL_BTN} onClick={pick}>
                {body}
              </button>
            ) : (
              body
            )}
            <Underline state={isCurrent ? 'current' : p ? 'logged' : 'empty'} />
          </li>
        );
      })}
    </ol>
  );
}
