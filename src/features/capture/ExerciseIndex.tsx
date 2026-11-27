// Index des exos en haut de l'instrument : un numéro par exo, sa marque d'état
// (fait, en cours, passé) et une jauge de ses séries. Toucher un numéro ouvre
// l'exo (alternance, superset). Le mot de l'état est dans le nom accessible :
// la colonne est trop étroite pour lui. Le numéro et sa marque prennent la
// pastille d'état du Sommaire (`StatePill`, kit) : vert sauge pour un exo fait,
// bleu ardoise pour un exo entamé ; la ligne garde sa hauteur.
//
// La pastille tient dans sa colonne (retour du 27/11 : à 9 exos sur 393 px, la
// colonne fait 41 px et les pastilles se chevauchaient). Version serrée (jeu de
// 6 px, 4 à partir de 10 exos ; marque de 11). Pastille ou simple numéro, le
// contenu est centré au-dessus de sa jauge (retour du 27/11 : calés à gauche, les
// numéros d'un exo fait ou en cours sautaient à droite). Quand la colonne ne loge pas la
// marque avec 4 px d'écart (`iconFits`, bouton en conteneur), la marque tombe :
// la couleur et la jauge disent encore l'état, le mot reste dans le nom
// accessible.
import { StatePill, type ExoState } from '../../ui';
import { EXO_STATE_WORD } from './salle-progress';

export interface IndexItem {
  exerciseId: string;
  name: string;
  state: ExoState;
  /** Part du minimum de séries faite, de 0 à 1. */
  fill: number;
}

/** Classe qui montre la marque seulement si sa pastille tient dans la colonne
 *  avec 4 px d'écart. Seuils sur le contenu du bouton (colonne moins 16 px) :
 *  pastille = jeu × 2 + marque 11 + écart 4 + chiffres (8,5 px chacun). Les
 *  classes restent littérales pour Tailwind. */
function iconFits(many: boolean, twoDigits: boolean): string {
  if (!many) return 'hidden @min-[24px]:block'; // 12 + 11 + 4 + 8,5 = 35,5
  return twoDigits ? 'hidden @min-[28px]:block' : 'hidden @min-[20px]:block'; // 8 + 15 + 17 ou 8,5
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
  // À partir de 10 exos, les numéros à deux chiffres demandent le jeu le plus court.
  const many = items.length >= 10;
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
            className="@container flex h-11 min-w-0 flex-col justify-center px-2"
          >
            <span className={`tnum flex h-5 items-center justify-center text-[14px] ${active ? 'font-semibold' : ''}`}>
              <span>
                <StatePill
                  state={it.state}
                  size={11}
                  compact
                  dense={many ? 'sm' : 'md'}
                  iconClassName={iconFits(many, i + 1 >= 10)}
                >
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
