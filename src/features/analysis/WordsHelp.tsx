// Une ligne d'aide repliable sur les mots du domaine (UX 6) : « Que veulent dire
// ces mots ? », souligné ; toucher déplie une phrase par mot, tirée du texte
// commun (lib/glossary-text.ts), et la replie. Pas de bulle ni de feuille : la
// lecture reste dans la page, sous la ligne, et ne pousse rien tant qu'elle est
// repliée. Aucune animation : le dépli est instantané.
import { useId, useState } from 'react';
import { GLOSSARY_TEXT, type GlossaryTerm } from '../../lib/glossary-text';

/** « e1RM : la charge… » -> le mot et sa phrase. */
function split(text: string): [string, string] {
  const at = text.indexOf(' : ');
  return at < 0 ? ['', text] : [text.slice(0, at), text.slice(at + 3)];
}

export function WordsHelp({ terms, className = '' }: { terms: readonly GlossaryTerm[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center text-left text-[15px] text-muted underline decoration-1 underline-offset-4 active:text-ink"
      >
        {open ? 'Masquer les définitions' : 'Que veulent dire ces mots\u00a0?'}
      </button>
      <dl id={id} hidden={!open} className="pb-2 text-[15px] leading-[1.45]">
        {terms.map((term) => {
          const [word, sentence] = split(GLOSSARY_TEXT[term]);
          return (
            <div key={term} className="mt-1.5 first:mt-0">
              <dt className="inline font-medium text-ink">{word}</dt>
              <dd className="inline text-muted"> : {sentence}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
