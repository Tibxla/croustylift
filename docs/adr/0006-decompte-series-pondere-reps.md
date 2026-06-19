# Décompte de séries pondéré par les reps

Le décompte de séries d'une séance (total et par muscle principal) ne compte plus chaque série pour 1, mais pour sa **contribution** pondérée par les reps : `min(reps, 5) / 5`. Une série de 5 reps ou plus vaut 1 (plafonné) ; en deçà, elle vaut un crédit partiel (3 reps → 0,6). Le même cœur de comptage sert au **prévu** (depuis les prescriptions, pondéré par la borne basse `reps.min`) et au **réel** (depuis les séries loggées). Une série unilatérale compte la **somme des deux côtés** au total et le **côté faible** par muscle.

## Pourquoi

Toutes les séries ne se valent pas : une série lourde de 3 reps n'apporte pas autant qu'une série de 10, et les compter à égalité fausse la comparaison de configurations. Plafonner à 5 reps évite l'inverse — gonfler le décompte avec des séries très longues. Le côté faible par muscle reste cohérent avec l'e1RM côté faible (ADR 0005) : c'est lui qui dicte la charge réelle. Le terme reste **« décompte de séries »**, jamais « volume » : on compte des séries rattachées aux muscles principaux, pas un tonnage.

## Alternatives écartées

- **Une série = 1, sans pondération** (règle initiale) : traite une série de 3 reps comme une de 12, ce que la comparaison « 2 séries vs 4 » devait justement affiner.
- **Pondérer aussi par la charge (tonnage)** : c'est du volume, proscrit, et incomparable entre exos.
- **Unilatéral compté pour 1 partout** : sous-estime le travail total (deux côtés faits) ou surestime par muscle ; on sépare donc total (somme) et par muscle (côté faible).

## Conséquences

- Les valeurs sont **fractionnaires** : à afficher avec une décimale (« 1,8–2,4 séries »).
- Le prévu se lit en fourchette (séries prescrites min–max), reps figées à la borne basse.
- Une série unilatérale pleine (≥5 reps des deux côtés) vaut 2 au total et 1 par muscle.
