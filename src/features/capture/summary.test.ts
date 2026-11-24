// Tests unitaires de elapsedMinutesSince. Les décomptes de l'ancien
// `buildSummary` sont reportés sur le récap actuel (session-recap-counts.test.ts).
//
// Logique pure, pas de DOM. On contrôle Date.now via vi.setSystemTime.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { elapsedMinutesSince } from './summary';

// --- elapsedMinutesSince -----------------------------------------------------

describe('elapsedMinutesSince', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('séance oubliée, terminée le lendemain : durée non mesurée (null), pas 1 400 min', () => {
    vi.setSystemTime(1_000_000 + 60_000 * 1400);
    expect(elapsedMinutesSince(1_000_000)).toBeNull();
  });

  it('au plafond exact (600 min) la durée est encore rendue', () => {
    vi.setSystemTime(1_000_000 + 60_000 * 600);
    expect(elapsedMinutesSince(1_000_000)).toBe(600);
  });

  it('retourne le nombre de minutes écoulées (arrondi)', () => {
    vi.setSystemTime(1_000_000 + 60_000 * 45); // +45 min exactement
    expect(elapsedMinutesSince(1_000_000)).toBe(45);
  });

  it('arrondit au plus proche : 30 secondes de plus -> +1 min', () => {
    vi.setSystemTime(1_000_000 + 60_000 * 3 + 30_000); // 3 min 30 s
    expect(elapsedMinutesSince(1_000_000)).toBe(4);
  });

  it('arrondit au plus proche : 29 secondes de plus -> même minute', () => {
    vi.setSystemTime(1_000_000 + 60_000 * 3 + 29_000); // 3 min 29 s
    expect(elapsedMinutesSince(1_000_000)).toBe(3);
  });

  it('retourne 0 si lancé juste maintenant (delta < 30 s)', () => {
    vi.setSystemTime(1_000_000 + 10_000); // +10 s
    expect(elapsedMinutesSince(1_000_000)).toBe(0);
  });

  it('startedAt dans le futur (horloge qui recule) -> 0, jamais négatif', () => {
    // Une durée négative serait rejetée par la base (check >= 0, migration 0012)
    // et l'op de clôture empoisonnerait l'outbox (incident 2026-07-30).
    vi.setSystemTime(1_000_000);
    expect(elapsedMinutesSince(1_000_000 + 60_000 * 10)).toBe(0);
  });

  it('cas dégénéré : undefined -> null (pas de durée)', () => {
    expect(elapsedMinutesSince(undefined)).toBeNull();
  });

  it('cas dégénéré : NaN -> null', () => {
    expect(elapsedMinutesSince(NaN)).toBeNull();
  });

  it('cas dégénéré : Infinity -> null', () => {
    expect(elapsedMinutesSince(Infinity)).toBeNull();
  });

  it('cas dégénéré : -Infinity -> null', () => {
    expect(elapsedMinutesSince(-Infinity)).toBeNull();
  });

});
