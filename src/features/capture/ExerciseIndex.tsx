// Index des exos en haut de l'instrument : un numéro par exo, sa marque d'état
// (fait, en cours, passé) et une jauge de ses séries. Toucher un numéro ouvre
// l'exo (alternance, superset). Le mot de l'état est dans le nom accessible :
// la colonne est trop étroite pour lui. Le numéro et sa marque prennent la
// pastille d'état du Sommaire (`StatePill`, kit) : pleine et colorée pour un exo
// fait, en contour pour un exo entamé ; la ligne garde sa hauteur.
import { StatePill, type ExoState } from '../../ui';
import { EXO_STATE_WORD } from './salle-progress';

export interface IndexItem {
  exerciseId: string;
  name: string;
  state: ExoState;
  /** Part du minimum de séries faite, de 0 à 1. */
  fill: number;
}

export function ExerciseIndex({
  items,
  activeId,
  onPick,
}: {
  items: IndexItem[];
  activeId: string;
  onPick: (exerciseId: string) => void;
}) {
  return (
    <div
      className="grid px-3"
      style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}
      aria-label="Exercices de la séance"
    >
      {items.map((it, i) => {
        const active = it.exerciseId === activeId;
        return (
          <button
            key={it.exerciseId}
            type="button"
            aria-current={active ? 'true' : undefined}
            aria-label={`Exo ${i + 1}, ${it.name}, ${EXO_STATE_WORD[it.state]}`}
            onClick={() => onPick(it.exerciseId)}
            className="flex h-11 min-w-0 flex-col justify-center px-2"
          >
            <span className={`tnum flex h-5 items-center text-left text-[14px] ${active ? 'font-semibold' : ''}`}>
              <span className={`[&>span]:leading-5 ${it.state === 'done' || it.state === 'partial' ? '-ml-2' : ''}`}>
                <StatePill state={it.state} size={13}>
                  <span className={it.state === 'todo' && active ? 'text-ink' : ''}>{i + 1}</span>
                </StatePill>
              </span>
            </span>
            {it.state === 'skipped' ? (
              <span className="mt-1.5 block h-[3px] w-full border-t-[3px] border-dashed border-dim" />
            ) : (
              <span className="relative mt-1.5 block h-[3px] w-full bg-line">
                <span className={`absolute inset-y-0 left-0 ${active ? 'bg-ink' : 'bg-muted'}`} style={{ width: `${it.fill * 100}%` }} />
                {active && it.fill === 0 && <span className="absolute inset-y-0 left-0 w-2 bg-ink" />}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
