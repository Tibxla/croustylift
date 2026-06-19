# Modèle d'exercice étendu : muscles principaux multiples + flag unilatéral

Un exercice porte désormais une **liste** de muscles principaux (`primary_muscles`, au moins un) au lieu d'un muscle unique, et un drapeau `unilateral`. Toujours pas de muscle secondaire : un muscle est principal ou n'est pas compté. La migration est **additive** — la colonne `muscle_group` (1 muscle, au singulier) reste comme legacy et vaut le premier muscle principal.

## Pourquoi

Beaucoup de mouvements ciblent réellement plusieurs muscles en priorité (un rowing tape dorsaux ET arrière épaule ET trapèzes) : les coincer sur un seul faussait le regroupement et le décompte de séries. Le flag `unilateral` est requis par le logging un côté à la fois (ADR 0005) et par l'e1RM côté faible. On garde le tabou du muscle secondaire : la nuance « un peu sollicité » n'a pas de place dans un tracker qui compare des séries, pas un volume.

## Alternatives écartées

- **Garder un muscle unique** : sous-décrit les mouvements composés et oblige à choisir arbitrairement un seul muscle par exo.
- **Muscles principaux + secondaires (pondérés)** : ouvre la porte au calcul de volume, explicitement proscrit par le glossaire.
- **Supprimer `muscle_group` d'emblée** : casserait tout code et tout filtre qui le lit ; on le conserve dérivé du premier principal jusqu'à migration complète des lectures.

## Conséquences

- `muscle_group` est legacy : ne plus l'enrichir, lire `primary_muscles` partout où on regroupe ou compte.
- Le décompte de séries (ADR 0006) attribue chaque série à **tous** les muscles principaux de l'exo.
- `unilateral` est personnalisable par utilisateur via override (ADR 0007).
