// Kit E · bandeau de synchro, une seule ligne (il ne doit pas pousser
// l'instrument). Le shell le pose sous la navigation ; il ne s'affiche que s'il
// y a quelque chose à dire (src/shell/sync-line.ts). Un mot en blanc cassé, le
// détail en gris, entre deux filets ; jamais de couleur d'alerte.
export function SyncBanner({ line }: { line: { title: string; detail: string } | null }) {
  if (!line) return null;
  return (
    <div role="status" className="flex items-baseline gap-2 whitespace-nowrap border-y border-line px-5 py-2 text-[14px]">
      <span className="flex-none font-semibold text-ink">{line.title}</span>
      <span className="min-w-0 truncate text-muted">{line.detail}</span>
    </div>
  );
}
