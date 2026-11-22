// PROTOTYPE JETABLE. Barre flottante de bascule entre variantes : ← / → (boutons
// ou flèches du clavier), état dans `?variant=` pour un lien stable au reload.
// Jamais montée hors dev (import.meta.env.DEV).
import { useEffect } from 'react';

export interface VariantEntry {
  key: string;
  name: string;
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
}: {
  variants: VariantEntry[];
  current: string;
  onChange: (key: string) => void;
}) {
  const idx = Math.max(0, variants.findIndex((v) => v.key === current));
  const go = (delta: number) => {
    const next = variants[(idx + delta + variants.length) % variants.length];
    if (next) onChange(next.key);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!import.meta.env.DEV) return null;
  const v = variants[idx];

  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 16,
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 4,
        borderRadius: 999,
        background: '#fff',
        color: '#000',
        font: '600 13px/1 system-ui, sans-serif',
        boxShadow: '0 6px 24px rgba(0,0,0,.5), 0 0 0 2px #ff3d00',
      }}
    >
      <button type="button" onClick={() => go(-1)} style={btn} aria-label="Variante précédente">←</button>
      <span style={{ padding: '0 10px', whiteSpace: 'nowrap' }}>
        PROTO {v?.key} · {v?.name}
      </span>
      <button type="button" onClick={() => go(1)} style={btn} aria-label="Variante suivante">→</button>
    </div>
  );
}

const btn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 999,
  border: 0,
  background: '#000',
  color: '#fff',
  cursor: 'pointer',
  font: 'inherit',
};
