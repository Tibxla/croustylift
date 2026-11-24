// Kit E · signes ▲ ▬ ▼ et statut lisible (signe + mot, dans la teinte de la triade).
import { TONE, type Verdict } from './status-tone';

/** ▲ ▬ ▼ dessinés en SVG : les glyphes varient d'une police à l'autre. */
export function Sign({ v, size = 11 }: { v: Verdict; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden fill="currentColor" className="inline-block flex-none">
      {v === 'up' && <path d="M6 1.5 11 10.5H1z" />}
      {v === 'eq' && <rect x="0.5" y="3.5" width="11" height="5" />}
      {v === 'down' && <path d="M6 10.5 1 1.5h10z" />}
    </svg>
  );
}

/** Signe + mot, dans la bonne teinte : `<Status v="up" word="battue" />`. */
export function Status({ v, word, size = 11, className = '' }: { v: Verdict; word: string; size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${TONE[v]} ${className}`}>
      <Sign v={v} size={size} />
      {word}
    </span>
  );
}
