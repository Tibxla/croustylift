// PROTOTYPE JETABLE · variante F « Graphite » : palette, formateurs et petits
// morceaux partagés entre la Salle et l'Analyse. Même structure que A, autre
// habit : gris parfaitement neutres (R = G = B), aucune couleur d'accent.
//
// Palette (ratios de contraste WCAG calculés sur le fond #111111) :
//   fond        #111111   page
//   creux       #0a0a0a   fenêtre de la règle, zones en retrait
//   touche      #1c1c1c   surface des touches (enfoncée : #151515)
//   relief      #262626   segment actif, rangée choisie
//   bord        #3a3a3a   arête 1 px des touches (arête haute #484848)
//   encre       #ededed   16,1:1  texte principal
//   encre-2     #a8a8a8    7,9:1  libellés (7,2:1 sur touche)
//   encre-3     #8f8f8f    5,8:1  méta (5,3:1 sur touche, 4,7:1 sur relief)
//   blanc       #ffffff   aiguille, cadre de sélection (2 px, sans aplat), valeur lue
//   fantôme     #666666    3,3:1  nom de l'exo suivant (grand texte)
//   creux enfoncé #050505  les surfaces en creux s'assombrissent aussi au toucher
//   statut ▲    #95b49f    8,4:1  vert de gris, toujours avec signe et mot
//   statut ▼    #c4ae8a    8,8:1  ambre éteint, toujours avec signe et mot
//   touche Log  #e8e8e8   texte #111111 15,4:1, résumé #4d4d4d 6,9:1
//
// Les classes Tailwind sont écrites en clair (jamais interpolées) pour que le
// compilateur les voie.
import type { ExercisePlan } from './fixtures';
import { e1rm } from './fixtures';

export const STEP_KG = 1.25;

/** Valeurs brutes, pour le SVG et les styles en ligne. */
export const G = {
  bg: '#111111',
  recess: '#0a0a0a',
  key: '#1c1c1c',
  raised: '#262626',
  edge: '#3a3a3a',
  hair: '#232323',
  ink: '#ededed',
  ink2: '#a8a8a8',
  ink3: '#8f8f8f',
  white: '#ffffff',
  good: '#95b49f',
  warn: '#c4ae8a',
} as const;

/** Poids français jusqu'à deux décimales : 81,25 ; 82,5 ; 80. `kg()` des fixtures arrondit à 0,1. */
export function fmtKg(n: number): string {
  const r = Math.round(n * 100) / 100;
  if (Number.isInteger(r)) return String(r);
  const s = Number.isInteger(r * 10) ? r.toFixed(1) : r.toFixed(2);
  return s.replace('.', ',');
}

/** Une décimale fixe, virgule : 107,3. */
export function fmt1(n: number): string {
  return n.toFixed(1).replace('.', ',');
}

/** Écart signé, signe moins typographique (U+2212). */
export function fmtSigned(n: number): string {
  if (n === 0) return '0';
  return `${n > 0 ? '+' : '−'}${fmt1(Math.abs(n))}`;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function fmtDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

export function monthLabel(iso: string): string {
  const m = Number(iso.split('-')[1]);
  return MONTHS[m - 1] ?? '';
}

export type Verdict = 'up' | 'eq' | 'down';

/** Règle unique, celle de l'app (set-badges) : e1RM strictement supérieur, égal, inférieur. */
export function verdict(now: number, ref: number): Verdict {
  if (now > ref) return 'up';
  if (now === ref) return 'eq';
  return 'down';
}

export const SIGN: Record<Verdict, string> = { up: '▲', eq: '▬', down: '▼' };
/** Seuls ▲ et ▼ portent une couleur ; l'égalité reste grise. */
export const TONE: Record<Verdict, string> = {
  up: 'text-[#95b49f]',
  eq: 'text-[#a8a8a8]',
  down: 'text-[#c4ae8a]',
};
/** Le mot qui accompagne toujours le signe (série face à sa Référence). */
export const WORD_SET: Record<Verdict, string> = { up: 'battue', eq: 'égalée', down: 'en deçà' };
/** Le mot de la pente. */
export const WORD_SLOPE: Record<Verdict, string> = { up: 'en hausse', eq: 'stable', down: 'en baisse' };

/** Pente en %/semaine → verdict. Sous 0,25 % en valeur absolue : stagnation. */
export function slopeVerdict(pct: number): Verdict {
  if (pct >= 0.25) return 'up';
  if (pct <= -0.25) return 'down';
  return 'eq';
}

export function fmtPct(pct: number): string {
  const a = Math.abs(pct).toFixed(1).replace('.', ',');
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${a} %`;
}

export interface SetValue {
  weightKg: number;
  reps: number;
  rir: number;
}

export function setE1rm(s: SetValue): number {
  return e1rm(s.weightKg, s.reps, s.rir);
}

export function refAt(ex: ExercisePlan, rank: number): SetValue | null {
  return ex.reference?.sets[rank - 1] ?? null;
}

export type View = 'salle' | 'analyse';

/**
 * Touche physique : surface graphite plate, arête nette de 1 px un peu plus
 * claire en haut, enfoncement d'1 px et fond un cran plus sombre au toucher.
 * Aucune ombre, aucun halo.
 */
export const KEY =
  'rounded-[8px] border border-[#3a3a3a] border-t-[#484848] bg-[#1c1c1c] text-[#ededed] transition-[transform,background-color] duration-75 active:translate-y-px active:border-t-[#333333] active:bg-[#151515]';

/**
 * Styles portés par la racine de F : focus et sélection de texte en blanc
 * (les règles globales sont teintées), chiffres tabulaires partout.
 */
export function GraphiteStyle() {
  return (
    <style>{`
[data-graphite] { font-family: "Geist Variable", "Inter Variable", ui-sans-serif, system-ui, sans-serif; font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
[data-graphite] :focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }
[data-graphite] ::selection { background-color: #3a3a3a; color: #ffffff; }
`}</style>
  );
}

/** Barre haute commune : contexte à gauche, bascule Salle / Analyse en deux touches à droite. */
export function TopBar({
  view,
  onView,
  left,
}: {
  view: View;
  onView: (v: View) => void;
  left: React.ReactNode;
}) {
  return (
    <header className="flex h-[60px] flex-none items-center justify-between gap-3 pl-4 pr-4">
      <div className="min-w-0 truncate text-[13px] text-[#a8a8a8]">{left}</div>
      <nav
        aria-label="Surfaces"
        className="flex flex-none overflow-hidden rounded-[8px] border border-[#3a3a3a] bg-[#0a0a0a]"
      >
        {(['salle', 'analyse'] as const).map((v, i) => {
          const active = v === view;
          return (
            <button
              key={v}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onView(v)}
              className={`h-11 px-3.5 text-[14px] transition-[transform,background-color] duration-75 active:translate-y-px ${
                i > 0 ? 'border-l border-[#3a3a3a]' : ''
              } ${
                active
                  ? 'bg-[#262626] font-medium text-[#ffffff]'
                  : 'text-[#a8a8a8] active:bg-[#050505]'
              }`}
            >
              {v === 'salle' ? 'Salle' : 'Analyse'}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
