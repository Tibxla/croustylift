// Réglages de l'appareil (écran Réglages) : couleur de signal, pas de la règle,
// réduire les animations.
//
// Préférences d'AFFICHAGE, pas des données : elles restent sur l'appareil, sous
// une clé qui ne dépend d'aucun compte (lues avant la connexion, pour que l'écran
// de connexion ait déjà le bon signal) et qu'aucune purge ne balaie
// (`croustylift:reglages`, hors des préfixes de la capture, des copies de lecture
// et des préférences de compte). Elles survivent donc à la Déconnexion, comme le
// choix d'un thème.
//
// Démarrage sans flash : `applyStoredReglages()` est appelé en tête de main.tsx,
// avant le premier rendu React, et pose `--sig` et `data-motion` sur `:root`.
// Rien n'est écrit dans index.html (la CSP de prod refuse le script en ligne).
//
// Réduire les animations : `null` tant que l'utilisateur n'a rien choisi, et
// c'est alors la préférence du système qui vaut (suivie si elle change) ; un
// choix explicite l'emporte ensuite, dans un sens comme dans l'autre.
//
// La valeur lue est validée champ par champ : un stockage abîmé ou d'une autre
// version retombe sur les défauts, jamais sur une couleur injectée telle quelle.
import { useSyncExternalStore } from 'react';
import { CLARTE_MAX, FREE_NAME, freeHex, HUE_MAX, HUE_STEP, SIG_DEFAULT, SIG_PRESETS } from './signal-color';

export const REGLAGES_KEY = 'croustylift:reglages';

/** Couleur de signal choisie : une prédéfinie (par son nom) ou une couleur libre. */
export type SignalChoice = { kind: 'preset'; name: string } | { kind: 'free'; h: number; l: number };

export interface Reglages {
  signal: SignalChoice;
  /** Pas de la règle de poids, en kg : de 0,25 à 10 par 0,25. */
  stepKg: number;
  /** Réduire les animations : choix explicite, ou null pour suivre le système. */
  reduceMotion: boolean | null;
}

export const STEP_MIN = 0.25;
export const STEP_MAX = 10;
export const STEP_INC = 0.25;

export const DEFAULT_REGLAGES: Reglages = {
  signal: { kind: 'preset', name: SIG_DEFAULT.name },
  // 0,25 kg depuis le 25/11 (demande de l'utilisateur ; 1,25 avant). Un pas
  // déjà enregistré sur l'appareil reste tel quel : seul le défaut change.
  stepKg: 0.25,
  reduceMotion: null,
};

function validSignal(raw: unknown): SignalChoice | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (s.kind === 'preset' && typeof s.name === 'string' && SIG_PRESETS.some((p) => p.name === s.name)) {
    return { kind: 'preset', name: s.name };
  }
  if (
    s.kind === 'free' &&
    Number.isInteger(s.h) &&
    Number.isInteger(s.l) &&
    (s.h as number) >= 0 &&
    (s.h as number) <= HUE_MAX &&
    (s.h as number) % HUE_STEP === 0 &&
    (s.l as number) >= 0 &&
    (s.l as number) <= CLARTE_MAX
  ) {
    return { kind: 'free', h: s.h as number, l: s.l as number };
  }
  return null;
}

function validStep(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw < STEP_MIN || raw > STEP_MAX) return null;
  return Number.isInteger(raw / STEP_INC) ? raw : null;
}

/** Lit des réglages stockés ; chaque champ illisible retombe sur son défaut. */
export function parseReglages(raw: string | null): Reglages {
  if (!raw) return DEFAULT_REGLAGES;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_REGLAGES;
  }
  if (typeof data !== 'object' || data === null) return DEFAULT_REGLAGES;
  const d = data as Record<string, unknown>;
  return {
    signal: validSignal(d.signal) ?? DEFAULT_REGLAGES.signal,
    stepKg: validStep(d.stepKg) ?? DEFAULT_REGLAGES.stepKg,
    reduceMotion: typeof d.reduceMotion === 'boolean' ? d.reduceMotion : null,
  };
}

/** Couleur CSS du signal choisi. */
export function signalHex(signal: SignalChoice): string {
  if (signal.kind === 'free') return freeHex(signal.h, signal.l);
  return SIG_PRESETS.find((p) => p.name === signal.name)?.hex ?? SIG_DEFAULT.hex;
}

/** Nom affiché du signal choisi (« Jaune », « Autre couleur »). */
export function signalName(signal: SignalChoice): string {
  return signal.kind === 'free' ? FREE_NAME : signal.name;
}

function readStored(): Reglages {
  try {
    return parseReglages(localStorage.getItem(REGLAGES_KEY));
  } catch {
    return DEFAULT_REGLAGES;
  }
}

function applySignal(signal: SignalChoice): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--sig', signalHex(signal));
}

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

/** Le système demande-t-il de réduire les animations ? */
export function systemReducesMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(REDUCE_QUERY).matches;
}

/** Réduire les animations, tel qu'appliqué : le choix explicite, sinon le système. */
export function effectiveReduceMotion(r: Reglages, system: boolean = systemReducesMotion()): boolean {
  return r.reduceMotion ?? system;
}

function applyMotion(r: Reglages): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.motion = effectiveReduceMotion(r) ? 'reduite' : 'normale';
}

let current: Reglages | null = null;
const listeners = new Set<() => void>();

function snapshot(): Reglages {
  current ??= typeof localStorage === 'undefined' ? DEFAULT_REGLAGES : readStored();
  return current;
}

/** Pose le signal et le mouvement enregistrés sur `:root`, et suit la préférence
 *  du système tant qu'aucun choix explicite n'est fait. À appeler avant le
 *  premier rendu. */
export function applyStoredReglages(): void {
  applySignal(snapshot().signal);
  applyMotion(snapshot());
  if (typeof window === 'undefined' || !window.matchMedia) return;
  window.matchMedia(REDUCE_QUERY).addEventListener?.('change', () => {
    if (snapshot().reduceMotion !== null) return;
    applyMotion(snapshot());
    for (const l of listeners) l();
  });
}

/** Change des réglages : appliqués tout de suite (le signal en direct sur toute
 *  l'app), puis enregistrés. Un stockage refusé (mode privé, quota) garde le
 *  réglage pour la session. */
export function updateReglages(patch: Partial<Reglages>): void {
  const next = { ...snapshot(), ...patch };
  current = next;
  if (patch.signal) applySignal(next.signal);
  if (patch.reduceMotion !== undefined) applyMotion(next);
  try {
    localStorage.setItem(REGLAGES_KEY, JSON.stringify(next));
  } catch {
    /* le réglage vaut pour cette session seulement */
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Un autre onglet a changé les réglages : on les relit et on les applique.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== REGLAGES_KEY) return;
    current = readStored();
    applySignal(current.signal);
    applyMotion(current);
    for (const l of listeners) l();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Les réglages courants, relus à chaque changement. */
export function useReglages(): Reglages {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_REGLAGES);
}
