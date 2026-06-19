# Croustylift

Tracker de musculation multi-user : capture des séries en salle (zéro-friction, offline), analyse de la progression au calme.

## Langage

### Exercices

**Exercice**:
Un mouvement de musculation identifiable et réutilisable (ex. développé couché). Unité de référence des séances et des logs.
_Avoid_: Mouvement, lift (« lift » est réservé à l'exécution réelle)

**Exercice de base**:
Exercice du catalogue commun, partagé en lecture seule entre tous les utilisateurs, jamais modifié. Livré déjà tagué de ses muscles principaux. Un utilisateur le personnalise sans toucher au partagé via un **Override d'exercice**.
_Avoid_: Exercice standard, exercice public

**Exercice perso**:
Exercice créé par un utilisateur, visible de lui seul.
_Avoid_: Exercice custom, exercice privé

**Note d'instructions**:
Consigne personnelle et persistante qu'un utilisateur attache à un exercice (de base ou perso). Distincte de l'exercice lui-même, et propre à chaque utilisateur.
_Avoid_: Description, commentaire

**Muscles principaux**:
La liste des muscles qu'un exercice cible en priorité (au moins un, champ `primary_muscles`). Jamais de muscle secondaire : un muscle est principal ou n'est pas compté. Sert à regrouper et filtrer les exercices dans l'analyse, et à rattacher le décompte de séries (jamais à calculer un volume). Vocabulaire canonique (15) : pectoraux · avant épaule · milieu épaule · arrière épaule · trapèzes · dorsaux · biceps · triceps · brachioradial · abdominaux · quadriceps · ischio-jambiers · adducteurs · fessiers · mollets.
_Avoid_: Volume musculaire, muscle secondaire

**Unilatéral**:
Exercice travaillé un côté à la fois (ex. développé haltère unilatéral), marqué par le flag `unilateral`. Une série se complète quand les deux côtés (gauche et droite) sont saisis, chacun avec ses propres valeurs. Le côté est choisi à la saisie (sélecteur, sans ordre imposé). La courbe e1RM suit le côté faible.
_Avoid_: Bilatéral implicite ; ne pas confondre côté et série

**Override d'exercice**:
Personnalisation d'un exercice de base propre à un seul utilisateur (nom, unilatéral, muscles principaux), sans modifier l'exercice partagé. Fusionnée champ par champ à la lecture : un champ surchargé gagne, les autres gardent la base.
_Avoid_: Fork, copie, exercice perso (l'exercice de base reste partagé)

### Séances & routines

**Séance**:
Template d'entraînement : liste ordonnée d'exercices, chacun avec sa prescription. Choisie en arrivant à la salle (pas de calendrier). Le déroulé réel d'une séance est une **Exécution**.
_Avoid_: Workout, session ; ne pas confondre avec l'Exécution (le réel)

**Prescription**:
Le plan cible d'un exercice dans une séance : séries, reps et RIR, chacun en valeur fixe ou fourchette (min–max). Ce que l'utilisateur vise.
_Avoid_: Objectif, cible (ambigu avec la référence)

**Référence**:
La dernière performance réelle sur un exercice, affichée en salle comme repère à dépasser. Dérivée de l'historique, jamais saisie.
_Avoid_: Cible, objectif, PR

**Routine**:
Collection ordonnée de séances qu'un utilisateur tourne sur une période (ex. Upper/Lower = 2 séances). Une séance appartient à une seule routine.
_Avoid_: Programme, cycle, split

**Routine courante**:
La routine qu'un utilisateur tourne en ce moment ; c'est parmi ses séances qu'il choisit en arrivant à la salle.
_Avoid_: Routine active, routine par défaut

**Bloc**:
Période continue pendant laquelle la configuration du template (routine courante et ses séances) est restée inchangée. Unité de comparaison de la progression. Dérivé automatiquement, jamais déclaré à l'avance.
_Avoid_: Cycle, mésocycle, période

**Déviation**:
Écart entre le plan prescrit et l'exécution réelle (série annulée, exo skippé, série ajoutée, exo remplacé, ordre changé). Dérivée par diff (prescription vs réel), auditable, elle n'altère jamais le template ni les blocs.
_Avoid_: Modification, correction, erreur

### Exécution

**Exécution**:
Le déroulé réel d'une séance un jour donné : les séries réellement faites, rattachées à la version de séance active ce jour-là. Le diff entre les deux donne les déviations.
_Avoid_: Session, séance réalisée (« séance » désigne le template)

**Série**:
Une série de travail réellement effectuée dans une exécution : poids, reps, RIR et son rang d'ordre. Aucun échauffement n'est loggé. Sur un exercice unilatéral, une série tient sur deux lignes au même rang (un côté gauche, un côté droite, valeurs par côté) ; son e1RM est celui du côté faible.
_Avoid_: Set ; ne pas confondre avec « rep » (les répétitions à l'intérieur d'une série)

**Note datée**:
Note libre attachée à une exécution (un exo un jour donné) : contexte d'une perf ou d'une déviation (fatigue, blessure, machine prise). Distincte de la note d'instructions (persistante).
_Avoid_: Commentaire, log

**Décompte de séries**:
Nombre de séries d'une séance, au total et par muscle principal, pondéré par les reps : une série compte `min(reps, 5) / 5` (pleine à 5 reps ou plus, partielle en deçà). Calculé sur le prévu (prescriptions) comme sur le réel (séries loggées). Une série unilatérale compte 2 au total (les deux côtés) et le côté faible par muscle. Sert à comparer des configurations (« triceps 2 séries vs 4 »), jamais à mesurer un volume.
_Avoid_: Volume, tonnage, charge totale
