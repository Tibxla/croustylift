# Croustylift

Tracker de musculation multi-user : capture des séries en salle (zéro-friction, offline), analyse de la progression au calme.

## Langage

### Compte & appareil

**Connexion**:
L'acte de s'identifier auprès du serveur (email + mot de passe). Exige le réseau, arrive rarement (une fois par appareil, ou après déconnexion).
_Avoid_: Login, authentification (trop large) ; « se connecter » pour désigner l'ouverture de l'app

**Session locale**:
L'état « reconnu sur cet appareil » qui suit une Connexion et persiste jusqu'à Déconnexion explicite. Fait foi hors-ligne, même si sa validation par le serveur est périmée : l'app s'ouvre et la capture fonctionne, la revalidation attend le retour du réseau.
_Avoid_: Session (ambigu avec « séance » en salle), token

**Déconnexion**:
L'acte volontaire de retirer la Session locale de l'appareil, qui purge les données locales du compte. Seule façon de perdre la reconnaissance : une panne de réseau ou un jeton périmé n'y suffisent jamais. Refusée tant que des écritures locales attendent la synchronisation — sauf forçage explicite qui assume la perte.
_Avoid_: Logout, expiration (une session locale n'expire pas d'elle-même)

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
La dernière performance réelle sur un exercice **dans la même séance** — le même exercice exécuté dans une autre séance ne compte pas (le contexte de fatigue diffère d'une séance à l'autre). Affichée en salle comme repère à dépasser, série par série (position N comparée à la position N de la dernière fois). Dérivée de l'historique, jamais saisie. Une série du jour la **bat** (strictement mieux), l'**égale** (à l'identique) ou reste en deçà — trois états distincts, jamais confondus. Sans exécution passée de l'exercice dans cette séance, il n'y a **pas de Référence** (rien à battre ni à égaler), même si l'exercice a un historique dans d'autres séances. L'exécution en cours n'est jamais sa propre Référence — après une Clôture, une seconde exécution le même jour prend la première comme repère. Ce qui a été saisi sur l'appareil compte immédiatement, synchronisé ou non.
_Avoid_: Cible, objectif, PR ; ne pas confondre avec le Record personnel (all-time, toutes séances confondues)

**Record personnel**:
La meilleure performance jamais réalisée sur un exercice, tous jours et toutes séances confondus — distinct de la **Référence** (la dernière fois, dans la même séance). Deux mesures : le meilleur e1RM, pris sur **toutes les séries** (un record est une perf démontrée, quel que soit le rang de la série — la courbe e1RM d'analyse, elle, reste sur la 1ʳᵉ série de chaque exécution pour la comparabilité jour à jour), et la charge la plus lourde (poids, reps en départage). Dérivé de l'historique, jamais saisi. Sur un exo unilatéral, il se lit à **deux échelles** : par côté en salle (chaque bras tient son propre record, repère de séance), au **côté faible** en analyse (la courbe de progression, ADR 0005). Un record sur le bras fort en salle peut donc ne pas faire avancer la courbe d'analyse.
_Avoid_: PR (sigle), record du jour ; ne pas confondre avec la Référence (dernière fois, par position de série)

**Routine**:
Collection ordonnée de séances qu'un utilisateur tourne sur une période (ex. Upper/Lower = 2 séances). Une séance appartient à une seule routine.
_Avoid_: Programme, cycle, split

**Routine courante**:
La routine qu'un utilisateur tourne en ce moment ; c'est parmi ses séances qu'il choisit en arrivant à la salle.
_Avoid_: Routine active, routine par défaut

**Duplication de séance**:
Création d'une nouvelle séance à partir du contenu d'une séance existante — ses exercices et leurs prescriptions tels qu'ils sont au moment du geste — dans la même routine ou dans une autre. Les deux séances sont indépendantes dès la copie : éditer l'une ne touche jamais l'autre, et une séance appartient toujours à une seule routine. La copie ne reprend **aucun historique** : la séance née d'une duplication n'a ni Référence, ni note datée en repère, ni courbe tant qu'elle n'a pas été exécutée — seuls les Records personnels, qui ignorent la séance, restent visibles.
_Avoid_: Partage, séance commune, modèle / template (une Séance est déjà un template) ; ne jamais dire « la même séance dans deux routines »

**Bloc**:
Période continue pendant laquelle la configuration du template (routine courante et ses séances) est restée inchangée. Unité de comparaison de la progression. Dérivé automatiquement, jamais déclaré à l'avance.
_Avoid_: Cycle, mésocycle, période

**Déviation**:
Écart entre le plan prescrit et l'exécution réelle (série annulée, exo skippé, série ajoutée, exo remplacé, ordre changé). Dérivée par diff (prescription vs réel), auditable, elle n'altère jamais le template ni les blocs.
_Avoid_: Modification, correction, erreur

### Exécution

**Exécution**:
Le déroulé réel d'une séance un jour donné : les séries réellement faites, rattachées à la version de séance active ce jour-là. Le diff entre les deux donne les déviations. Une exécution n'existe que par ses séries : sans aucune série loggée, ce n'est pas une exécution — elle n'a sa place ni au journal ni dans les métriques (durée, BPM), qui décrivent toujours une séance réellement faite.
_Avoid_: Session, séance réalisée (« séance » désigne le template) ; exécution vide (sans série)

**Clôture**:
Le geste par lequel l'utilisateur déclare sa séance finie en salle : il fige les métriques de fin (durée chronométrée, BPM moyen optionnel), voit son récap, puis l'écran de Capture redevient disponible. Un moment, pas un statut : une fois rangée, la séance vit dans le journal comme n'importe quelle Exécution.
_Avoid_: Statut « terminée » persistant, fin de séance comme verrou

**Série**:
Une série de travail réellement effectuée dans une exécution : poids, reps, RIR et son rang d'ordre. Aucun échauffement n'est loggé. Sur un exercice unilatéral, une série tient sur deux lignes au même rang (un côté gauche, un côté droite, valeurs par côté) ; son e1RM est celui du côté faible.
_Avoid_: Set ; ne pas confondre avec « rep » (les répétitions à l'intérieur d'une série)

**e1RM**:
La charge maximale estimée pour une seule répétition, dérivée d'une série (poids, reps, RIR) — jamais mesurée, jamais saisie. Le RIR compte comme des reps supplémentaires : 100×5 @ RIR 2 vaut 100×7 @ RIR 0. Ancrée sur le réel : une série menée à l'échec pour une seule rep vaut exactement sa charge (140×1 @ RIR 0 → 140). Unité commune des courbes de progression et des records.
_Avoid_: 1RM (le vrai maximal, réellement soulevé), max, PR

**Note datée**:
Note libre attachée à une exécution (un exo un jour donné) : contexte d'une perf ou d'une déviation (fatigue, blessure, machine prise). Distincte de la note d'instructions (persistante). En **repère lecture seule** (« Dernière fois tu notais : … », toujours daté), ressort uniquement la note que la **dernière exécution de cette séance** porte pour cet exo ; si elle n'en porte pas, rien ne ressort — on ne repêche jamais une note plus ancienne. Sans changer sa nature : on en saisit toujours une fraîche chaque jour.
_Avoid_: Commentaire, log

**Décompte de séries**:
Nombre de séries d'une séance, au total et par muscle principal, pondéré par les reps : une série compte `min(reps, 5) / 5` (pleine à 5 reps ou plus, partielle en deçà). Calculé sur le prévu (prescriptions) comme sur le réel (séries loggées). Une série unilatérale compte 2 au total (les deux côtés) et le côté faible par muscle. Sert à comparer des configurations (« triceps 2 séries vs 4 »), jamais à mesurer un volume.
_Avoid_: Volume, tonnage, charge totale
