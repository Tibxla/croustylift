// PROTOTYPE JETABLE · pièces communes aux variantes : la lecture du poids (avec
// trois façons de placer « kg »), la règle de poids, le choix du côté. Des
// commandes, pas des mises en page : chaque variante les range à sa façon.
import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Side } from '../../../domain/types';
import { Ruler } from '../../../ui';
import { formatWeight } from '../format';
import { parseTypedValue, roundWeightKg, WEIGHT_MAX_KG } from '../stepper-utils';
import { weightGraduations } from '../weight-graduations';

const FACE = 'font-[650] leading-none tracking-[-0.045em]';

/** Où va « kg » :
 *  - `block` : « 140 kg » forme un bloc, centré EN ENTIER (le nombre quitte un peu
 *    l'aiguille, vers la gauche, de la moitié de « kg ») ;
 *  - `below` : « kg » sous le nombre, en petit ; le nombre reste sur l'aiguille ;
 *  - `none` : le nombre seul, centré sur l'aiguille ; l'unité est dite ailleurs
 *    (titre de section, en-tête de colonne). */
export type UnitMode = 'block' | 'below' | 'none';

/** Lecture du poids, toucher = clavier numérique pour une valeur précise (comme
 *  l'instrument réel). La taille se réduit si la valeur ne tient pas. */
export function ProtoWeight({ value, onChange, size, unit }: { value: number; onChange: (kg: number) => void; size: number; unit: UnitMode }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const before = useRef(value);
  const shown = formatWeight(value);
  const text = editing ? draft || '0' : shown;
  const box = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [fit, setFit] = useState({ size, width: 0 });
  const unitRoom = unit === 'block' ? size * 0.55 : 0;

  useLayoutEffect(() => {
    const b = box.current;
    const p = probe.current;
    if (!b || !p || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const room = b.clientWidth - 40 - unitRoom;
      const natural = p.getBoundingClientRect().width;
      const s = natural > room ? Math.max(32, Math.floor((size * room) / natural)) : size;
      setFit({ size: s, width: Math.ceil((natural * s) / size) + 4 });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    ro.observe(p);
    return () => ro.disconnect();
  }, [size, unitRoom]);

  const start = () => {
    before.current = value;
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
    if (/\d/.test(clean)) onChange(parseTypedValue(clean, 0, WEIGHT_MAX_KG, before.current, true));
  };
  const close = (raw: string) => {
    setEditing(false);
    if (!/\d/.test(raw)) onChange(before.current);
  };

  const kgInline = <span className="ml-[0.12em] font-medium text-muted" style={{ fontSize: Math.round(fit.size * 0.36) }}>kg</span>;
  const kgBelow = <span className="mt-1 block text-[14px] font-medium leading-none text-muted">kg</span>;
  const number = editing ? (
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
      style={{ fontSize: fit.size, height: fit.size, width: fit.width || undefined }}
    />
  ) : (
    <span className={`tnum ${FACE}`} style={{ fontSize: fit.size }}>
      {shown}
    </span>
  );

  const body =
    unit === 'below' ? (
      <span className="flex flex-col items-center">
        {number}
        {kgBelow}
      </span>
    ) : (
      <span className="inline-flex items-baseline">
        {number}
        {unit === 'block' && kgInline}
      </span>
    );

  return (
    <div ref={box} className="relative flex items-center justify-center overflow-hidden" style={{ height: unit === 'below' ? size + 18 : size }}>
      {editing ? (
        body
      ) : (
        <button
          type="button"
          onClick={start}
          aria-label={`Poids : ${shown} kg. Toucher pour saisir une valeur précise`}
          className="flex h-full w-full items-center justify-center text-ink active:opacity-70"
        >
          <span aria-hidden>{body}</span>
        </button>
      )}
      <span ref={probe} aria-hidden className={`tnum pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap ${FACE}`} style={{ fontSize: size }}>
        {text}
      </span>
    </div>
  );
}

const RULER_MAX_KG = 500;

/** La règle de poids de la Salle, telle quelle (pas de Réglages, élan). */
export function WeightRuler({ weightKg, onChange, stepKg, height, compact }: { weightKg: number; onChange: (kg: number) => void; stepKg: number; height: number; compact: boolean }) {
  const { majorEvery, midEvery } = weightGraduations(stepKg);
  return (
    <Ruler
      key={stepKg}
      label="Poids"
      steps={weightKg / stepKg}
      max={Math.max(Math.round(RULER_MAX_KG / stepKg), Math.ceil(weightKg / stepKg))}
      pxPerStep={Math.max(8, 11.2 * stepKg)}
      isMajor={(s) => s % majorEvery === 0}
      isMid={(s) => midEvery > 0 && s % midEvery === 0}
      majorLabel={(s) => formatWeight(s * stepKg)}
      format={(s) => `${formatWeight(roundWeightKg(s * stepKg))} kg`}
      onChange={(s) => onChange(roundWeightKg(s * stepKg))}
      height={height}
      compact={compact}
    />
  );
}

/** Gauche · Droite en mots, le choisi en demi-gras souligné (`Choice`). */
export function SideChoice({ side, done, onChoose, className = '' }: { side: Side; done: Side[]; onChoose: (s: Side) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Côté à logger" className={`flex flex-none ${className}`}>
      {(['left', 'right'] as const).map((sd) => {
        const sel = sd === side;
        const isDone = done.includes(sd);
        return (
          <button
            key={sd}
            type="button"
            role="radio"
            aria-checked={sel}
            onClick={() => onChoose(sd)}
            className={`h-11 flex-none px-2.5 text-[17px] ${sel ? 'font-semibold text-ink underline decoration-[3px] underline-offset-[8px]' : isDone ? 'text-faint' : 'text-muted active:text-ink'}`}
          >
            {sd === 'left' ? 'Gauche' : 'Droite'}
            {isDone && <span className="ml-1 text-[13px] text-faint">faite</span>}
          </button>
        );
      })}
    </div>
  );
}

/** « 140,5 × 7 · RIR 0 ». */
export function setText(s: { weightKg: number; reps: number; rir: number }): string {
  return `${formatWeight(s.weightKg)} × ${s.reps} · RIR ${s.rir}`;
}
