// PROTOTYPE JETABLE · barre de bascule entre variantes (skill prototype, branche
// UI). Outil de revue, pas un élément du design : elle se veut visiblement
// étrangère (bloc clair, texte noir).
//
// Deux réglages depuis le tour des arrondis (25/11) : la variante de la Salle
// (`?variant=`) et le traitement d'arrondi de toute l'app (`?arrondi=`). Pour
// laisser la navigation et le bas de l'écran libres sur TOUTES les surfaces, la
// barre est repliée par défaut en une languette au bord droit, qui dit le choix
// en cours (« A4 / R1 ») ; la toucher déplie les deux rangées sous la
// navigation, « Replier » la range. Clavier : ← → la variante, Maj + ← →
// l'arrondi. Absente du build sans `VITE_PROTOTYPE=1`.
import { useEffect, useState } from 'react';

export interface SwitchRow {
  /** Nom de la rangée (« Salle », « Arrondi »). */
  label: string;
  options: readonly { key: string; name: string }[];
  current: string;
  onChange: (key: string) => void;
  /** Touche de bascule : flèches seules ou avec Maj. */
  shift?: boolean;
}

function short(o: { key: string }) {
  return o.key === 'actuel' ? '·' : o.key;
}

export function PrototypeSwitcher({ rows, message }: { rows: SwitchRow[]; message?: { text: string; at: number } | null }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    setShown(message.text);
    const t = window.setTimeout(() => setShown(null), 4500);
    return () => window.clearTimeout(t);
  }, [message]);

  const go = (r: SwitchRow, d: number) => {
    const i = Math.max(0, r.options.findIndex((o) => o.key === r.current));
    r.onChange(r.options[(i + d + r.options.length) % r.options.length]!.key);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable], [role="slider"], [role="radiogroup"]')) return;
      const r = rows.find((x) => !!x.shift === e.shiftKey);
      if (!r) return;
      e.preventDefault();
      go(r, e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const cur = rows.map((r) => r.options.find((o) => o.key === r.current) ?? r.options[0]!);

  return (
    <div data-proto-bar className="contents">
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Prototype : ${rows.map((r, i) => `${r.label} ${cur[i]!.name}`).join(', ')}. Déplier la barre`}
          className="fixed right-0 z-[70] flex min-h-16 w-[30px] flex-col items-center justify-center gap-1.5 rounded-l-[8px] bg-[#e9e4d8] py-2 text-[12px] font-semibold leading-none text-[#100e0c] outline outline-2 outline-[#100e0c] active:bg-[#cfc8b8]"
          style={{ top: '38%' }}
        >
          {cur.map((o, i) => (
            <span key={i}>{short(o)}</span>
          ))}
        </button>
      )}
      {open && (
        <div
          role="toolbar"
          aria-label="Variantes du prototype"
          className="fixed inset-x-0 z-[70] mx-auto flex w-[min(360px,calc(100%-24px))] flex-col rounded-[8px] bg-[#e9e4d8] p-1 text-[#100e0c] outline outline-2 outline-[#100e0c]"
          style={{ top: 'calc(var(--safe-top, 0px) + var(--nav-height, 48px) + 4px)' }}
        >
          {rows.map((r, i) => {
            const idx = Math.max(0, r.options.findIndex((o) => o.key === r.current));
            return (
              <div key={r.label} className="flex h-11 items-center">
                <span className="w-[62px] flex-none pl-2 text-[12px] font-semibold">{r.label}</span>
                <button type="button" aria-label={`${r.label} : précédente`} onClick={() => go(r, -1)} className="h-11 w-11 flex-none text-[20px] active:bg-[#cfc8b8]">
                  ‹
                </button>
                <span className="min-w-0 flex-1 text-center text-[14px] font-semibold leading-tight">
                  {r.current === 'actuel' ? cur[i]!.name : `${r.current} · ${cur[i]!.name}`}
                  <span className="block text-[11px] font-normal">
                    {idx + 1}/{r.options.length}
                  </span>
                </span>
                <button type="button" aria-label={`${r.label} : suivante`} onClick={() => go(r, 1)} className="h-11 w-11 flex-none text-[20px] active:bg-[#cfc8b8]">
                  ›
                </button>
              </div>
            );
          })}
          <button type="button" onClick={() => setOpen(false)} className="h-11 text-[14px] underline underline-offset-4 active:bg-[#cfc8b8]">
            Replier
          </button>
        </div>
      )}
      {shown && (
        <p
          role="status"
          className="pointer-events-none fixed inset-x-0 z-[71] mx-auto w-fit max-w-[360px] rounded-[6px] bg-[#e9e4d8] px-3 py-1.5 text-[13px] leading-snug text-[#100e0c] outline outline-2 outline-[#100e0c]"
          style={{ top: 'calc(var(--safe-top, 0px) + 2px)' }}
        >
          {shown}
        </p>
      )}
    </div>
  );
}
