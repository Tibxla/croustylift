// La bande des séries de la Salle, en modèle pur : quelles cases, dans quel
// ordre, et ce qui s'écrit sous chaque numéro (une ligne, poids en quatre
// chiffres au plus, RIR).
import { describe, expect, it } from 'vitest';
import type { PerformedSet } from '../../domain/types';
import { BAND_DIGITS, bandCells, bandFirstShown, bandName, bandParts, bandValue, bandWeight } from './set-band';

describe('bandWeight : quatre chiffres au plus, décimales tronquées au-delà', () => {
  it('la limite est de quatre chiffres', () => {
    expect(BAND_DIGITS).toBe(4);
  });

  it('les décimales restent tant que le poids tient en quatre chiffres', () => {
    expect(bandWeight(82.5)).toBe('82,5');
    expect(bandWeight(22.25)).toBe('22,25');
    expect(bandWeight(7.5)).toBe('7,5');
    expect(bandWeight(7.25)).toBe('7,25');
    expect(bandWeight(102.5)).toBe('102,5');
  });

  it('au-delà, tronquées, jamais arrondies vers le haut', () => {
    expect(bandWeight(171.25)).toBe('171,2');
    expect(bandWeight(126.75)).toBe('126,7');
    expect(bandWeight(99.99)).toBe('99,99');
    expect(bandWeight(1000.5)).toBe('1000');
  });

  it('sans zéro final ; un entier reste entier', () => {
    expect(bandWeight(100)).toBe('100');
    expect(bandWeight(140.05)).toBe('140');
    expect(bandWeight(0)).toBe('0');
    expect(bandWeight(0.25)).toBe('0,25');
  });

  it('calcul en centièmes : un flottant comme 0,29 ne perd pas un centième', () => {
    expect(bandWeight(0.29)).toBe('0,29');
    expect(bandWeight(1.15)).toBe('1,15');
    expect(bandWeight(60.3)).toBe('60,3');
  });
});

describe('bandValue : une ligne sous le numéro', () => {
  it('le poids en quatre chiffres au plus, puis les reps, une espace fine et le RIR', () => {
    expect(bandValue({ weightKg: 171.25, reps: 8, rir: 1 })).toBe('171,2×8\u2009R1');
    expect(bandValue({ weightKg: 82.5, reps: 10, rir: 2 })).toBe('82,5×10\u2009R2');
    expect(bandValue({ weightKg: 126.75, reps: 12, rir: 4 })).toBe('126,7×12\u2009R4');
  });

  it('un poids entier reste tel quel', () => {
    expect(bandValue({ weightKg: 100, reps: 5, rir: 0 })).toBe('100×5\u2009R0');
    expect(bandValue({ weightKg: 0, reps: 15, rir: 3 })).toBe('0×15\u2009R3');
  });
});

describe('bandParts : la charge et le RIR, écrits en deux teintes', () => {
  it('« 126,2×12 » puis « R4 »', () => {
    expect(bandParts({ weightKg: 126.25, reps: 12, rir: 4 })).toEqual({ load: '126,2×12', rir: 'R4' });
  });
});

describe('bandName : la valeur exacte reste dans le nom lu', () => {
  it('le poids exact en kilos, les reps et le RIR en toutes lettres', () => {
    expect(bandName({ weightKg: 171.25, reps: 8, rir: 1 })).toBe('171,25 kilos, 8 reps, RIR 1');
  });
});

const B = (order: number, weightKg = 100, reps = 8): PerformedSet => ({ order, weightKg, reps, rir: 1 });
const L = (order: number, reps = 10): PerformedSet => ({ order, weightKg: 12, reps, rir: 2, side: 'left' });
const R = (order: number, reps = 10): PerformedSet => ({ order, weightKg: 12, reps, rir: 2, side: 'right' });
const ids = (sets: PerformedSet[]) => sets.map((_, i) => `id${i}`);
const brief = (cells: ReturnType<typeof bandCells>) => cells.map((c) => `${c.label}:${c.state}`);

describe('bandCells, bilatéral : une case par série prévue, la série en cours en plus', () => {
  it('deux séries loggées sur quatre prévues : deux faites, la 3ᵉ en cours, la 4ᵉ à faire', () => {
    const sets = [B(1), B(2)];
    expect(brief(bandCells({ sets, setIds: ids(sets), plannedMax: 4, unilateral: false, side: null }))).toEqual([
      '1:logged',
      '2:logged',
      '3:current',
      '4:todo',
    ]);
  });

  it('au-delà du plan, la case en cours s’ajoute', () => {
    const sets = [B(1), B(2), B(3)];
    expect(brief(bandCells({ sets, setIds: ids(sets), plannedMax: 3, unilateral: false, side: null }))).toEqual([
      '1:logged',
      '2:logged',
      '3:logged',
      '4:current',
    ]);
  });

  it('une case loggée porte sa série, son rang dans `sets` (badges) et son id', () => {
    const sets = [B(1, 171.25)];
    const [cell] = bandCells({ sets, setIds: ['a'], plannedMax: 2, unilateral: false, side: null });
    expect(cell).toMatchObject({ state: 'logged', set: sets[0], index: 0, id: 'a', side: null });
  });

  it('une série sans id (cache d’ancien format) ne se corrige pas', () => {
    const sets = [B(1)];
    expect(bandCells({ sets, setIds: [null], plannedMax: 2, unilateral: false, side: null })[0]?.id).toBeNull();
  });
});

describe('bandCells, unilatéral : une case par côté, rangées par série puis gauche, droite', () => {
  it('premier passage, gauche choisie : « 1 G » en cours, puis les côtés à faire', () => {
    expect(brief(bandCells({ sets: [], setIds: [], plannedMax: 2, unilateral: true, side: 'left' }))).toEqual([
      '1 G:current',
      '1 D:todo',
      '2 G:todo',
      '2 D:todo',
    ]);
  });

  it('cas courant : série 1 complète, la 2 entamée à gauche, droite choisie', () => {
    const sets = [L(1), R(1), L(2)];
    expect(brief(bandCells({ sets, setIds: ids(sets), plannedMax: 3, unilateral: true, side: 'right' }))).toEqual([
      '1 G:logged',
      '1 D:logged',
      '2 G:logged',
      '2 D:current',
      '3 G:todo',
      '3 D:todo',
    ]);
  });

  it('trois gauches de suite, droite choisie : rangées par série, jamais « 1 D » après « 3 G »', () => {
    const sets = [L(1, 10), L(2, 9), L(3, 8)];
    const cells = bandCells({ sets, setIds: ids(sets), plannedMax: 2, unilateral: true, side: 'right' });
    // Chaque série a sa gauche puis sa droite, dans l'ordre des rangs ; la
    // droite visée est celle de la 3ᵉ série (`targetSlotForSide`).
    expect(brief(cells)).toEqual(['1 G:logged', '1 D:todo', '2 G:logged', '2 D:todo', '3 G:logged', '3 D:current']);
  });

  it('trois gauches sur un exo prévu à deux séries, gauche choisie : la 4ᵉ gauche en cours', () => {
    const sets = [L(1, 10), L(2, 9), L(3, 8)];
    const cells = bandCells({ sets, setIds: ids(sets), plannedMax: 2, unilateral: true, side: 'left' });
    expect(cells.map((c) => c.label)).toEqual(['1 G', '1 D', '2 G', '2 D', '3 G', '3 D', '4 G', '4 D']);
    expect(cells.find((c) => c.state === 'current')?.label).toBe('4 G');
  });

  it('deux droites au même rang (doublon venu d’un autre appareil) : les deux se voient et se corrigent', () => {
    const sets = [L(1), R(1, 10), R(1, 7)];
    const cells = bandCells({ sets, setIds: ids(sets), plannedMax: 2, unilateral: true, side: 'left' });
    const logged = cells.filter((c) => c.state === 'logged');
    expect(logged.map((c) => `${c.label}:${c.id}`)).toEqual(['1 G:id0', '1 D:id1', '2 D:id2']);
    // Comme le rang que dit « Logger » (`targetSlotForSide`) : la 3ᵉ série.
    expect(cells.find((c) => c.state === 'current')?.label).toBe('3 G');
  });

  it('une case loggée renvoie à SA ligne dans `sets`, pour son badge par côté', () => {
    const sets = [R(1, 9), L(1, 10)];
    const cells = bandCells({ sets, setIds: ids(sets), plannedMax: 1, unilateral: true, side: 'left' });
    expect(cells.slice(0, 2).map((c) => [c.label, c.index])).toEqual([
      ['1 G', 1],
      ['1 D', 0],
    ]);
  });
});

describe('bandFirstShown : la case où la bande se cale', () => {
  it('bilatéral : deux cases avant la série en cours', () => {
    expect(bandFirstShown(0, false)).toBe(0);
    expect(bandFirstShown(5, false)).toBe(3);
  });

  it('unilatéral : les paires G et D restent ensemble, la série d’avant puis l’en cours', () => {
    // Case en cours « 3 D » (index 5) : la vue part de « 2 G » (index 2).
    expect(bandFirstShown(5, true)).toBe(2);
    // « 3 G » (index 4) : pareil, jamais une vue qui commence par « 2 D ».
    expect(bandFirstShown(4, true)).toBe(2);
    expect(bandFirstShown(1, true)).toBe(0);
  });

  it('trois cases à l’écran (sous 360 px) : la série en cours reste en vue, sa paire entière', () => {
    // « 2 D » (index 3) : la série d'avant entière la poussait en quatrième
    // case, hors de l'écran. La vue part alors de sa paire, « 2 G ».
    expect(bandFirstShown(3, true, 3)).toBe(2);
    expect(bandFirstShown(5, true, 3)).toBe(4);
    // « 2 G » (index 2) tient en troisième case : la série d'avant reste.
    expect(bandFirstShown(2, true, 3)).toBe(0);
    expect(bandFirstShown(5, false, 3)).toBe(3);
  });
});
