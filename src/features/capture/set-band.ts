// La bande des séries de la Salle, en modèle pur (le rendu : SetBand.tsx).
//
// UNE LIGNE SOUS CHAQUE NUMÉRO (demande de l'utilisateur du 25/11 : « enlève ce
// qu'il y a après la virgule, pour pouvoir quand même mettre le RIR »). Sous le
// numéro, « 171×8 · R1 » : le poids SANS décimales, tronqué (171,25 donne 171,
// 82,5 donne 82, jamais arrondi vers le haut), puis « ×reps », puis « R » et le
// RIR. La valeur exacte reste dans le nom lu (« 171,25 kilos, 8 reps, RIR 1 ») et
// dans la feuille de correction, qui s'ouvre au toucher de la case.
//
// LES CASES. Bilatéral : une case par série prévue (borne haute du plan), plus la
// série en cours si on la dépasse. Unilatéral : une case par CÔTÉ (« 2 G »,
// « 2 D »), rangées par série puis gauche, droite (`pairSidesByOrder`), quel que
// soit l'ordre de saisie : trois gauches de suite ne poussent pas « 1 D » après
// « 3 G ». La case en cours est celle que vise le côté choisi
// (`targetSlotForSide`), comme le rang que dit « Logger ».
import type { PerformedSet, Side } from '../../domain/types';
import { pairSidesByOrder, targetSlotForSide } from '../../domain/unilateral';
import { formatWeight } from './format';
import { badgeStatus, type SetBadge } from './set-badges';

export interface BandCell {
  key: string;
  /** Rang de la série dans la bande (1, 2, …). */
  rank: number;
  side: Side | null;
  /** Ce qui s'écrit au-dessus de la valeur : « 2 », « 2 G ». */
  label: string;
  state: 'logged' | 'current' | 'todo';
  /** La série loggée de la case, `null` sinon. */
  set: PerformedSet | null;
  /** Son index dans `sets` (pour son badge), -1 sans série. */
  index: number;
  /** Son id de ligne, `null` sans série ou pour un cache d'ancien format. */
  id: string | null;
}

type Values = Pick<PerformedSet, 'weightKg' | 'reps' | 'rir'>;

/** « 171×8 · R1 » : poids tronqué à l'entier, reps, RIR. */
export function bandValue({ weightKg, reps, rir }: Values): string {
  return `${Math.trunc(weightKg)}×${reps} · R${rir}`;
}

/** La valeur exacte, pour le nom lu : « 171,25 kilos, 8 reps, RIR 1 ». */
export function bandName({ weightKg, reps, rir }: Values): string {
  return `${formatWeight(weightKg)} kilos, ${reps} reps, RIR ${rir}`;
}

const LETTER: Record<Side, string> = { left: 'G', right: 'D' };

export function bandCells({
  sets,
  setIds,
  plannedMax,
  unilateral,
  side,
}: {
  sets: PerformedSet[];
  /** Ids des lignes, alignés sur `sets` (`null` : cache d'ancien format). */
  setIds: (string | null)[];
  plannedMax: number;
  unilateral: boolean;
  /** Le côté choisi au sélecteur (unilatéral), `null` en bilatéral. */
  side: Side | null;
}): BandCell[] {
  const logged = (set: PerformedSet, rank: number, sd: Side | null): BandCell => {
    const index = sets.indexOf(set);
    return { key: `${rank}${sd ?? ''}:${index}`, rank, side: sd, label: sd ? `${rank} ${LETTER[sd]}` : `${rank}`, state: 'logged', set, index, id: setIds[index] ?? null };
  };
  const empty = (rank: number, sd: Side | null, state: 'current' | 'todo'): BandCell => ({
    key: `${rank}${sd ?? ''}`,
    rank,
    side: sd,
    label: sd ? `${rank} ${LETTER[sd]}` : `${rank}`,
    state,
    set: null,
    index: -1,
    id: null,
  });

  if (!unilateral || !side) {
    const slots = Math.max(plannedMax, sets.length + 1);
    return Array.from({ length: slots }, (_, i) => {
      const set = sets[i];
      if (set) return logged(set, i + 1, null);
      return empty(i + 1, null, i === sets.length ? 'current' : 'todo');
    });
  }

  const pairs = pairSidesByOrder(sets);
  const current = targetSlotForSide(sets, side);
  const slots = Math.max(plannedMax, pairs.length, current + 1);
  const cells: BandCell[] = [];
  for (let i = 0; i < slots; i++) {
    for (const sd of ['left', 'right'] as const) {
      const set = pairs[i]?.[sd] ?? null;
      cells.push(set ? logged(set, i + 1, sd) : empty(i + 1, sd, i === current && sd === side ? 'current' : 'todo'));
    }
  }
  return cells;
}

const sideWord = (c: BandCell) => (c.side === 'left' ? ', gauche' : c.side === 'right' ? ', droite' : '');

/** Le nom lu d'une case : rang, côté, valeurs EXACTES, statut ; ou « à faire ». */
export function bandCellName(c: BandCell, badges: readonly SetBadge[], draft: Values): string {
  if (c.state === 'logged' && c.set) {
    const st = badgeStatus(badges[c.index] ?? null);
    return `Série ${c.rank}${sideWord(c)}, ${bandName(c.set)}${st ? `, ${st.word}` : ''}`;
  }
  if (c.state === 'current') return `Série ${c.rank} en cours${sideWord(c)}, ${bandName(draft)}`;
  return `Série ${c.rank}${sideWord(c)}, à faire`;
}
