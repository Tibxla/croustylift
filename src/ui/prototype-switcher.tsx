// PROTOTYPE JETABLE · barre de bascule entre variantes (skill prototype, branche
// UI). Outil de revue, pas un élément du design : elle se veut visiblement
// étrangère (bloc clair, texte noir). Posée en haut, sur la ligne de navigation,
// et non en bas : le bas de la Salle est la barre du pouce, que la bascule ne
// doit jamais couvrir. Absente du build sans `VITE_PROTOTYPE=1`.
import { useEffect, useState } from 'react';

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
  message,
}: {
  variants: readonly { key: string; name: string }[];
  current: string;
  onChange: (key: string) => void;
  /** Dernier message d'un bouchon, montré quelques secondes sous la barre. */
  message?: { text: string; at: number } | null;
}) {
  const i = Math.max(0, variants.findIndex((v) => v.key === current));
  const go = (d: number) => onChange(variants[(i + d + variants.length) % variants.length]!.key);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    setShown(message.text);
    const t = window.setTimeout(() => setShown(null), 4500);
    return () => window.clearTimeout(t);
  }, [message]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable], [role="slider"], [role="radiogroup"]')) return;
      e.preventDefault();
      go(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const v = variants[i]!;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-1 px-3"
      style={{ top: 'calc(var(--safe-top, 0px) + 2px)' }}
    >
      <div
        role="toolbar"
        aria-label="Variantes du prototype"
        className="pointer-events-auto flex h-11 items-center rounded-[8px] bg-[#e9e4d8] text-[#100e0c] outline outline-2 outline-[#100e0c]"
      >
        <button type="button" aria-label="Variante précédente" onClick={() => go(-1)} className="h-11 w-11 text-[20px] active:bg-[#cfc8b8]">
          ‹
        </button>
        <span className="min-w-[132px] px-1 text-center text-[14px] font-semibold leading-tight">
          {v.key === 'actuel' ? v.name : `${v.key} · ${v.name}`}
          <span className="block text-[11px] font-normal">
            prototype {i + 1}/{variants.length}
          </span>
        </span>
        <button type="button" aria-label="Variante suivante" onClick={() => go(1)} className="h-11 w-11 text-[20px] active:bg-[#cfc8b8]">
          ›
        </button>
      </div>
      {shown && (
        <p role="status" className="pointer-events-auto max-w-[360px] rounded-[6px] bg-[#e9e4d8] px-3 py-1.5 text-[13px] leading-snug text-[#100e0c] outline outline-2 outline-[#100e0c]">
          {shown}
        </p>
      )}
    </div>
  );
}
