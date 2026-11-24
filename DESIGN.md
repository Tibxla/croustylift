---
name: Croustylift
description: Tracker de musculation, capture sans friction en salle, analyse au calme.
colors:
  bg: "#100e0c"
  raise: "#1a1815"
  ink: "#f4f0e7"
  muted: "#b5b0a9"
  faint: "#8f8c85"
  dim: "#6b6761"
  line: "#3a3733"
  on-ink: "#4a463f"
  sig: "#f6d236"
typography:
  weight-readout:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "72px"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "-0.045em"
    fontFeature: "tabular-nums"
  weight-readout-small:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "56px"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "-0.045em"
    fontFeature: "tabular-nums"
  instrument-title:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  screen-title:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  key-figure:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontFeature: "tabular-nums"
  button:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  section-title:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
  body:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  meta:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  small:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
rounded:
  block: "6px"
  sheet: "10px"
spacing:
  gutter: "20px"
  row: "56px"
  target: "44px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bg}"
    rounded: "{rounded.block}"
    height: "56px"
  button-primary-pressed:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.bg}"
  button-primary-disabled:
    backgroundColor: "{colors.line}"
    textColor: "{colors.muted}"
  button-secondary:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.block}"
    height: "48px"
  button-secondary-small:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.block}"
    height: "44px"
  text-link:
    textColor: "{colors.ink}"
    height: "44px"
  row:
    textColor: "{colors.ink}"
    height: "56px"
  sheet:
    backgroundColor: "{colors.raise}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
  surface-nav:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.muted}"
    height: "48px"
---

# Design System: Croustylift

## Overview

**Creative North Star : « Signal »**

Un cadran noir, du texte blanc cassé, et une seule couleur qui veut dire quelque chose. Scène d'usage : entre deux séries, sous des néons durs, le téléphone à bout de bras et une seule main libre, puis le soir, assis, pour lire sa progression. Le fond sombre répond à cette scène (pas d'éblouissement, contraste maximal), il n'est pas un goût.

Tout est neutre et chaud : noir chaud, blanc cassé, gris chauds. La hiérarchie vient de la taille et de la graisse d'Inter, des filets et de l'espace, jamais d'un aplat coloré. Par-dessus ce calme, **une** couleur, le signal, réglable par l'utilisateur (jaune par défaut). Elle ne dit que deux choses : « tu es ici » (l'aiguille de la règle) et « mieux que la dernière fois » (le ▲ d'une série battue, d'un record, d'une pente en hausse). Comme elle ne sert à rien d'autre, on la voit tout de suite.

L'action principale d'un écran est un bloc blanc cassé plein, en bas, dans la zone du pouce. Le reste se range en boutons à contour, liens soulignés, lignes et filets. La navigation tient en cinq mots en haut de l'écran ; le bas appartient à la séance.

Ce que le système rejette : les trackers de muscu classiques (Hevy, Strong, FitNotes), chargés de boutons et de formulaires ; le ton coach motivant ; et la panoplie des interfaces générées (violet électrique, halos, dégradés, verre dépoli, cartes arrondies à icône dans un rond, surtitres en majuscules). La direction précédente, « L'instrument de nuit » violette, est abandonnée pour ces raisons.

**Key Characteristics :**
- Noir chaud, blanc cassé, gris chauds ; une seule couleur, le signal, réservée à deux sens.
- Bouton principal en bloc blanc cassé plein, un par écran, en bas.
- Inter partout, chiffres tabulaires pour les nombres seulement.
- Plat : aucune ombre, aucun dégradé, aucun flou. La structure est faite de filets.
- Navigation en mots, en haut ; feuilles basses pour les choix de second rang.
- Contraste AA prouvé par script (`npm run contrast`), cibles de 44 px au moins.

## Colors

Palette **retenue** : neuf valeurs, toutes définies une fois dans `src/index.css` (`@theme`), en hexadécimal. Ratios WCAG sur le fond, mesurés par `npm run contrast`.

### Neutres

- **Fond** (`#100e0c`, `--color-bg`) : noir chaud, le fond de tout écran.
- **Levé** (`#1a1815`, `--color-raise`) : fond des feuilles basses et du bouton secondaire. Tous les textes y restent à 5,2:1 ou plus.
- **Blanc cassé** (`#f4f0e7`, `--color-ink`, 16,9:1) : texte principal et fond du bouton principal.
- **Gris** (`#b5b0a9`, `--color-muted`, 8,9:1) : libellés secondaires, mots non choisis, ▼ « en deçà ».
- **Gris discret** (`#8f8c85`, `--color-faint`, 5,7:1) : méta discrète, texte de 13 px au moins.
- **Gris repère** (`#6b6761`, `--color-dim`, 3,4:1) : repères non textuels (graduations, filet de fourchette), texte de 24 px au moins seulement.
- **Filet** (`#3a3733`, `--color-line`, 1,6:1) : filets et séparateurs, jamais porteurs de sens seuls ; aplat de pression.
- **Encre sur blanc** (`#4a463f`, `--color-on-ink`, 8,3:1 sur le blanc cassé) : texte secondaire posé sur le bouton principal.

### Le signal

- **Signal** (`--sig`, `#f6d236` par défaut, en Tailwind `text-sig` / `bg-sig`) : réglable dans Réglages. Six prédéfinies (Jaune, Rouge, Rose, Violet, Ciel, Vert), de 5,9 à 13,0:1 sur le fond comme sur le levé, plus une couleur libre (toutes les teintes, toutes les clartés, à l'intensité la plus forte que l'écran sait afficher). La couleur libre peut descendre sous 4,5:1 : c'est la seule exception au contraste AA, signalée à l'utilisateur (« Peu lisible sous les néons »), jamais refusée.
- Le choix est stocké sur l'appareil (`src/settings/`) et posé sur `:root` avant le premier rendu : aucun écran ne s'affiche dans la mauvaise couleur.

### Named Rules

**The Two Meanings Rule.** Le signal dit « tu es ici » (aiguille) ou « mieux que la Référence » (▲). Rien d'autre : jamais un fond, un bouton, un lien, un interrupteur activé, une sélection, une confirmation ou une erreur.

**The Status Triad Rule.** Un statut est couleur + signe + mot, jamais la couleur seule. Mieux : signal et ▲. Égalé : blanc cassé et ▬. En deçà : gris et ▼. Le signal ne touche jamais le blanc cassé (1,3:1).

**The No Gray-On-Gray Rule.** Tout texte porteur d'information tient 4,5:1 sur son fond. `--color-dim` n'écrit pas de texte courant.

## Typography

**Police unique :** Inter Variable (auto-hébergée, sous-ensemble latin, `src/fonts.css`), repli `system-ui`.

**Character :** une grotesque neutre et dense, lisible à bout de bras. La hiérarchie se fait par la taille et la graisse (400, 500, 600, 650), sur une échelle fixe en pixels, sans `clamp`. Pas de seconde famille, pas de mono : les chiffres sont en Inter à chasse tabulaire.

### Hierarchy

- **Poids lu** (650, 72 px, `-0.045em`, tabulaire) : la charge de la série en cours. 56 px en lecture secondaire.
- **Titre d'instrument** (650, 32 px, `-0.03em`) : nom de l'exo en salle.
- **Titre d'écran** (650, 28 px, `-0.025em`) : en-tête de chaque écran.
- **Chiffre clé** (500, 22 px, tabulaire) : e1RM, totaux, valeurs d'une ligne d'instrument.
- **Bouton** (600, 18 px ; 17 px avec une ligne au-dessus) : libellé du bouton principal.
- **Titre de section** (600, 17 px) : en casse de phrase. Titre de ligne de liste : 500, 17 px.
- **Corps** (400, 16 px, interligne 1,45) : phrases, liens, choix.
- **Libellé** (400, 15 px) : mots de la navigation, sous-titres, explications courtes.
- **Méta** (400, 14 px) : ligne sous un titre, valeur d'appoint.
- **Petit** (400, 13 px) : le plus petit autorisé, étiquettes de graduation.

### Named Rules

**The Tabular Numbers Rule.** Les nombres mesurés seuls (poids, reps, RIR, e1RM, compteurs) sont en chiffres tabulaires (`.tnum`) : ils ne dansent pas d'une série à l'autre. Le texte courant ne l'est pas, ni un texte qui mêle nombres et traits d'union : Inter tabulaire donne au trait d'union une chasse de chiffre (« 3 - 4 », « E - mail »).

**The No Kicker Rule.** Aucun surtitre en majuscules, aucune étiquette mono traquée au-dessus d'un titre. Le titre porte son propre poids.

## Layout

- **Marge d'écran** de 20 px (`px-5`) ; une colonne, contenu au fil du doigt, de haut en bas.
- **Navigation** : une ligne de cinq mots en haut de chaque écran authentifié (Salle, Analyse, Séances, Exos, Réglages), 48 px de haut, dans le flux (elle défile avec la page). Le mot actif est en demi-gras souligné, les autres en gris. Retoucher le mot actif ne recharge rien. Un appui long de 1,5 s sur la ligne ouvre le relevé d'affichage (diagnostic des barres basses de l'iPhone), comme « Relevé d'affichage » dans Réglages et `?diag=1`.
- **Bas d'écran** : réservé à l'action du moment (logger, exo suivant, enregistrer), dans une barre collée en `position: sticky`, fond plein, qui porte elle-même l'encoche basse (`--safe-bottom`). Jamais de `position: fixed` pour une barre : sur iPhone en mode écran d'accueil, une barre fixe se décroche quand WebKit se trompe de fenêtre.
- **Hauteur d'écran** : le document ne défile pas quand le contenu tient. `.min-h-screen` (écran entier) et `.min-h-surface` (sous la navigation) retirent l'encoche haute et la navigation de `100dvh`.
- **Encoches** : `--safe-top` et `--safe-bottom` (`env(safe-area-inset-*)`) sont lues une fois sur `:root`. Rien ne passe jamais sous la barre d'état de l'iPhone (heure, batterie, Dynamic Island) : une bande opaque au noir chaud du fond (`.safe-top-scrim`, `position: sticky; top: 0`, premier enfant de #root, posée une fois pour tous les écrans, connexion comprise) réserve `--safe-top` dans le flux au-dessus de la navigation et couvre ce qui défile dessous ; elle passe sous les voiles des feuilles. Un écran plein écran hérité qui défile seul pose sa propre bande en premier enfant ; une feuille ne monte jamais au-delà de `100dvh - --safe-top`. En bas, chaque barre collée et chaque feuille portent `--safe-bottom`.
- **Cibles** : 44 × 44 px au moins, y compris les liens et les icônes seules. Lignes de liste de 56 px au moins.
- **Feuilles basses** : montées dans l'emplacement que le shell pose en bas de sa racine (`SheetSlot`), jamais en `position: fixed`.

## Elevation & Depth

**Plat.** Aucune ombre, aucun halo, aucun dégradé, aucun flou, nulle part. La profondeur se lit à deux paliers de fond (fond, levé) et à des filets de 1 px. Une feuille basse se distingue par son fond levé, son filet haut et le voile noir plein (65 %) qui couvre l'écran derrière elle, pas par une ombre.

### Named Rules

**The Flat Rule.** Si un élément a besoin d'une ombre pour se détacher, c'est que la mise en page le noie : on lui donne un filet, de l'espace ou un fond levé.

## Shapes

- **Rayon des blocs** : 6 px (`rounded-block`) pour les boutons, les carrés de couleur, les champs. Les cases d'un interrupteur prennent 3 px.
- **Rayon haut des feuilles** : 10 px (`rounded-t-sheet`).
- **Filets** : 1 px `--color-line` ; trait épais de 2 px en `--color-muted` pour séparer deux familles de contenu ; trait de 3 px blanc cassé à gauche d'un message d'erreur, d'un avis ou d'une confirmation en ligne (jamais d'une ligne de liste).
- Pas de pilule, pas de `rounded-2xl`, pas de cercle décoratif. Les seuls cercles sont les marques d'état d'un exo.

## Components

Le kit vit dans `src/ui/` (règles d'usage en tête de `src/ui/index.ts`). Les écrans s'y servent ; aucun ne redessine un bouton.

### Boutons et liens

- **Bouton principal** (`PrimaryButton`) : bloc blanc cassé plein, 56 px, rayon 6 px, texte noir en demi-gras 18 px ; une ligne au-dessus (`over`, 13 px, `--on-ink`) et une valeur à droite (`meta`) au besoin. Un seul par écran, en bas. Pressé : fond gris (`--muted`) et `scale(0.97)` en 140 ms ; sur un geste répété des centaines de fois (logger), le fond change seul, sans enfoncement. Désactivé : fond filet, texte gris.
- **Bouton secondaire** (`SecondaryButton`) : contour blanc cassé de 1,5 px sur fond levé, libellé centré en demi-gras, 48 px (44 px en `size="sm"`). Il ne doit jamais se lire comme un champ.
- **Lien souligné** (`TextLink`) : 16 px, soulignement de 1 px décalé de 4 px, cible de 44 px. Réservé à la navigation, aux actions mineures en ligne et à l'option qui fait perdre des données dans une confirmation (l'option sûre est toujours le bouton).
- **Icône seule** (`IconButton`) : 44 × 44 px, trait de 1,75 sur grille de 24, `currentColor`, nom lu par les lecteurs d'écran obligatoire. Avec cadre (action d'en-tête) ou sans (dans une ligne).

### Icônes et marques d'état

- **Icônes fonctionnelles** (`Icon`) : ajouter, plus d'options, éditer, supprimer, note, réordonner, masquer, afficher, déplier, replier, chevron. Une icône remplace un mot seulement quand elle est lue sans hésiter ; ailleurs le mot reste. Jamais décorative, jamais le signal.
- **Marques d'état d'un exo** (`StateIcon`, `StateMark`) : trois cercles de même encombrement, toujours à côté de leur mot. Fait : cercle et coche. En cours : cercle à moitié plein. Passé : cercle barré, en gris. À faire : aucune marque.
- **Statut** (`Sign`, `Status`) : ▲ ▬ ▼ dessinés en SVG (les glyphes varient d'une police à l'autre), dans la teinte de la triade.

### Listes et structure

- **Ligne** (`Row`) : titre 17 px qui passe à la ligne plutôt que d'être coupé, méta 14 px dessous, valeur à droite, chevron si la ligne s'ouvre. Filet bas. Ligne courante : titre en demi-gras et `aria-current`, le mot qui le dit (« courante ») en méta ; pas de bande latérale.
- **Titre de section** (`SectionTitle`) : 17 px demi-gras, en casse de phrase, avec une valeur d'appoint à droite.
- **En-tête d'écran** (`ScreenHeader`) : retour nommé (« ‹ Séances »), titre de 28 px, méta dessous.
- **Filet** (`Rule`) : 1 px, aligné sur la marge ou bord à bord.
- **État vide** (`EmptyState`) : une phrase qui dit ce qui manque, l'action dessous.

### Champs et confirmations

- **Champ** (`TextField`, `PasswordField`, `TextArea`) : fond levé, contour gris repère, 48 px, texte de 17 px (jamais sous 16 px : iOS zoome). Libellé visible au-dessus, ou masqué mais lu (`hideLabel`) quand la section porte déjà le titre. Focus : un seul indicateur, le contour passe au blanc cassé et double. Erreur : la phrase sous le champ, sur un trait blanc cassé à gauche (`FieldError`), jamais de rouge. Pas de placeholder qui imite une valeur. Le clavier n'est admis que pour du texte libre.
- **Avis** (`Notice`) : trait à gauche, titre, texte gris, actions dessous.
- **Confirmation en ligne** (`Confirm`) : posée là où l'action a été demandée, le texte dit ce qui sera perdu. Une perte définitive : l'option sûre est le bouton, la perte un lien. Un geste qui se défait (archiver) : l'action est le bouton, « Annuler » le lien.
- **Section repliée** (`Disclosure`) : titre, compte après un point médian, « Afficher » ou « Masquer » souligné.
- **Action d'objet** (`ActionRow`) : bouton secondaire pleine largeur, l'explication dessous ; `ActionNote` dit pourquoi une action manque.
- **Chargement** (`Loading`) : une phrase grise, pas de toupie. **Échec** (`LoadError`) : « Erreur : » puis la phrase, entre deux filets, puis « Réessayer ».

### Contrôles sans clavier

- **Interrupteur** (`Switch`) : une ligne, le libellé à gauche, « Oui » ou « Non » écrit, puis la case. Activé : case blanc cassé pleine (jamais le signal).
- **Stepper de formulaire** (`Stepper`) : − valeur +, carrés de 48 px, une ligne, valeur en chiffre clé (22 px) à largeur fixe pour que les boutons ne bougent pas sous le pouce.
- **Choix exclusif** (`Choice`) : des mots, le choisi en demi-gras souligné de 2 px. Pas de pilules.
- **Règle graduée** (`Ruler`) : la règle glisse sous une aiguille fixe (le signal). Toucher va au cran, glisser suit le doigt sans transition, un coup sec garde son élan (320 ms, interruptible). Flèches au clavier.

### Salle

- **Lecture du poids** (`WeightReadout`) : 72 px, chiffres tabulaires, la valeur entière centrée sur l'aiguille (80 comme 82,5 ou 126,25), « kg » accroché à sa droite sur la ligne de base, hors centrage ; une valeur trop longue réduit sa taille juste assez pour ne toucher ni le bord ni « kg ». La toucher ouvre le clavier numérique pour une valeur précise (virgule acceptée, bornée) ; Entrée ou toucher ailleurs valide, Échap ou vide annule, la règle se recale.
- **Règle de poids** : au pas de Réglages, graduation majeure tous les 5 kg, élan sur un coup sec ; jusqu'à 500 kg (au-delà, le clavier).
- **Rangées de numéros** (`NumberRow`) : reps 1 à 50, RIR 0 à 10, élargies si la valeur en sort ; un tap, une valeur.
- **Barre du pouce** : rangée du haut à trois places fixes (Sommaire, Annuler la série n, Exo suivant ou Terminer), Sommaire et Exo suivant au même gabarit (48 px, deux lignes, même ligne de base) ; dessous, Logger en bloc plein, toujours au même endroit, sans enfoncement. Rien ne change de place au minimum du plan.
- **Mesure du brouillon** : e1RM (ou reps effectives à 0 kg), écart à la Référence et record en chiffres seuls, sans signe ni couleur : le signal ne juge que des séries faites.

### Feuille basse

- **Saisies refusées** : quand le serveur refuse des saisies, la ligne de synchro porte à son bout « N refusées », souligné ; toute la ligne ouvre la feuille des saisies refusées (aussi depuis Réglages, Données). Chaque saisie dit quoi, quand et pourquoi, avec « Renvoyer » et « Abandonner » (confirmé).
- **`Sheet`** : voile noir plein à 65 % et panneau levé collé en bas, rayon haut de 10 px, titre et « Fermer » en tête (le titre passe à la ligne, jamais coupé ; sa première ligne au niveau de « Fermer »), défilement interne. Elle monte en 240 ms (courbe de tiroir iOS) et descend en 150 ms ; « Réduire les animations » la fait apparaître en fondu. Fermeture par « Fermer », le voile ou Échap ; le focus va au titre à l'ouverture, reste piégé dans la feuille, et revient à l'élément d'origine à la fermeture.

### Mouvement

- Rare, court, interruptible : des transitions, pas d'images clés. Sorties plus courtes que les entrées. Courbe forte `cubic-bezier(0.23, 1, 0.32, 1)` pour l'enfoncement et l'élan, `cubic-bezier(0.32, 0.72, 0, 1)` pour la feuille.
- Aucune animation sur les gestes répétés en salle (logger, règle au toucher, rangées de numéros) ni sur le changement de surface : le retour est instantané.
- Réduire les animations (Réglages, défaut = préférence du système, `data-motion="reduite"` sur `<html>`) : plus de déplacement ni de changement d'échelle ; restent les fondus d'opacité et de couleur.

### Reste du pont hérité

Tous les écrans sont au kit. Seule la classe `.field` reste dans `src/index.css` : le choix d'exo de la Salle (`ExercisePicker`) l'écrit encore. Elle se retire quand ce champ passe à `TextField`. Aucun nouvel usage.

## Do's and Don'ts

### Do:

- **Do** réserver le signal à l'aiguille et au ▲ « mieux que la Référence ».
- **Do** un seul bouton principal par écran, en bloc blanc cassé plein, en bas.
- **Do** écrire chaque statut en couleur + signe + mot.
- **Do** tenir 4,5:1 pour tout texte porteur d'information, prouvé par `npm run contrast`.
- **Do** des cibles de 44 px au moins, liens compris.
- **Do** coller les barres basses en `sticky`, fond plein, encoche comprise.
- **Do** passer par le kit `src/ui/` plutôt que de redessiner un bouton ou une feuille.
- **Do** des chiffres tabulaires pour les nombres, et seulement pour eux.

### Don't:

- **Don't** ressembler à Hevy, Strong ou FitNotes : boutons partout, formulaires à rallonge.
- **Don't** faire surgir le clavier en salle : règle, rangées de numéros, steppers.
- **Don't** utiliser le signal en fond, bouton, lien, sélection, interrupteur, confirmation ou erreur.
- **Don't** de dégradé (fond ou texte), de flou, de verre dépoli, de halo, de lueur, ni d'ombre floue.
- **Don't** de carte arrondie avec icône dans un rond, de pilule de badge, de `rounded-2xl`.
- **Don't** de surtitre en majuscules ni de mono en costume technique.
- **Don't** d'emoji, d'icône décorative ni de microcopie motivante.
- **Don't** de tiret long dans le texte affiché : un point médian « · » ou une virgule.
- **Don't** de `position: fixed` pour une barre collée.
- **Don't** de gris sur gris : `--color-dim` n'écrit pas de texte courant.
