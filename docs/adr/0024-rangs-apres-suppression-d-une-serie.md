# Rangs après la suppression d'une série en cours de séance : les suivantes remontent

Statut : **proposé** (2026-11-25). En attente de la décision de l'utilisateur. Le code suit cette proposition ; l'autre option tient à une constante.

En Salle, on peut désormais supprimer n'importe quelle série de l'exo en cours, pas seulement la dernière (`deleteSet`, `src/features/capture/set-gestures.ts`). Question : que deviennent les rangs des séries qui la suivaient ? Supprimer la série 2 d'un exo qui en compte quatre donne soit 1, 2, 3 (les suivantes remontent), soit 1, 3, 4 (un trou).

Proposition : **les suivantes remontent**. Le rang d'une série est sa place dans l'exo, pas un numéro d'ordre de saisie.

## Pourquoi

- **La Référence se lit par rang.** « Série 2 » se compare à la série 2 de la dernière fois (ADR 0010, 0014). Avec un trou, la série restée au rang 3 se compare à la troisième de la dernière fois alors qu'elle est la deuxième faite aujourd'hui, et la prochaine fois la Référence de ce jour aura un rang 2 vide : « pas de réf. » pour une série qui en a une.
- **Même règle que l'éditeur de séance passée.** Il recompacte déjà les rangs à l'écriture (`reorderSets`, `past-session-edit.ts`) : corriger la même séance depuis le Journal ou depuis la Salle donne le même résultat en base.
- **Le compteur dit vrai.** « Logger la série 4 » après trois séries faites, pas « la série 5 » parce qu'une a été supprimée.
- **Une suppression est une correction de saisie**, pas un événement de la séance (ADR 0002) : rien n'a à garder la trace du rang qu'occupait la série retirée.

## Options écartées

- **Laisser un trou** : moins d'écritures (une suppression, aucune réécriture), et le rang d'une série ne change jamais une fois saisi. Mais la Référence et le compteur lisent des rangs qui ne correspondent plus à ce qui a été fait, et le Journal recompacterait de toute façon à la première correction.
- **Laisser un trou et faire recompacter les lectures** : tout ce qui lit les séries (Référence, décompte, courbe, Journal, export) devrait le faire, pour une donnée qu'on peut simplement écrire juste.

## Conséquences

- Supprimer une série réécrit chaque série qui la suivait dans l'exo (un `patchSet` par ligne, qui n'écrit que son rang). Dans la file : les suppressions d'abord, puis les réécritures, pour qu'aucune série gardée ne partage un rang avec celle qui s'en va si l'envoi s'interrompt entre deux écritures. Aucune unicité ne porte sur le rang en base.
- Unilatéral : c'est la série entière qui part, gauche et droite, et les deux côtés des suivantes remontent ensemble (ADR 0005 : un rang commun aux deux côtés). Seulement pour une paire sans ambiguïté (une gauche et une droite à ce rang) ; sinon la ligne touchée part seule.
- Deux lignes au même rang (deux onglets ont chacun ajouté une série depuis le même état ; la base n'y met aucune unicité) : supprimer l'une ne retire qu'elle. Le rang reste occupé par l'autre, donc rien ne remonte : faire remonter les suivantes créerait une nouvelle collision.
- Hors ligne, plusieurs suppressions de suite empilent des réécritures ; chacune est idempotente par id, la dernière gagne.
- Une réponse tardive de la base, partie avant la suppression, ne ramène ni la série ni les anciens rangs : l'état local des séries touchées pendant le trajet prime (ADR 0021).
- La règle tient en un endroit : `RANK_POLICY_AFTER_DELETION`, `logicalSetRows` et `ranksAfterDeletion` (`src/features/capture/set-ranks.ts`). Passer à `'gap'` suffit à laisser un trou ; le geste n'enfile alors que la suppression.
