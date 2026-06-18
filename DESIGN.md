<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->
---
name: Croustylift
description: Tracker de musculation — capture zéro-friction en salle, analyse au calme.
---

# Design System: Croustylift

## 1. Overview

**Creative North Star : « L'instrument de nuit »**

Un instrument de précision qu'on lit dans le noir. Scène physique : entre deux séries, sous des néons durs, le téléphone à bout de bras, une seule main libre — puis le soir, posé sur le canapé. Cette scène **force le mode sombre** : fond mat quasi-noir pour tuer l'éblouissement, contraste élevé pour rester lisible de loin, et les données qui ressortent au lieu de se noyer. Le mode sombre n'est pas un goût ici, c'est la réponse à l'usage.

La personnalité tient en trois mots de PRODUCT.md : **rapide · clean · impressionnant**. L'« impressionnant » ne vient pas de la couleur ni de la décoration — il vient de la **précision** : une hiérarchie nette, un seul accent qui claque, des chiffres alignés comme sur un cadran. On vole la **sobriété sombre et précise de Linear** et la **lisibilité des graphes d'Apple Fitness**, rien d'autre.

Ce que le système **rejette explicitement** (anti-références de PRODUCT.md) : tout ce qui ressemble aux trackers de muscu classiques — **Hevy, Strong, FitNotes** — encombrés de boutons, formulaires à rallonge, claviers qui surgissent, décoration gratuite et ton « coach motivant » à emojis. Croustylift disparaît dans la tâche ; il n'essaie pas d'animer ta séance.

**Key Characteristics :**
- Base mate quasi-noire, légèrement teintée vers l'accent (mode sombre par nécessité, pas par mode).
- **Un seul accent** : violet/indigo électrique, utilisé sur ≤10 % de l'écran.
- **Chiffres en mono tabulaire** — la signature : poids, reps, RIR, e1RM se lisent comme un instrument.
- Contraste WCAG AA plancher, pensé pour les néons et le bras tendu.
- Densité au pouce : tout atteignable d'une main, gros tap-targets.
- Plat par défaut ; la profondeur vient des paliers tonals, pas des ombres.

## 2. Colors

Palette **Restrained** : un océan de quasi-noir teinté, traversé par un seul trait de violet électrique. La rareté de l'accent est ce qui le rend impressionnant.

### Primary
- **Violet électrique** (`[à résoudre à l'implémentation — indigo/violet vif en OKLCH]`) : action primaire, sélection courante, indicateur de progression (la « cible à battre » dépassée), états actifs. **Jamais** décoratif.

### Neutral
- **Noir d'instrument** (`[à résoudre]`) : fond. Quasi-noir mat, teinté de 0,005–0,015 de chroma **vers le violet** de l'accent (pas vers le « chaud » par défaut).
- **Surface** (`[à résoudre]`) : panneaux et lignes de série, un palier tonal au-dessus du fond.
- **Encre** (`[à résoudre]`) : texte principal, quasi-blanc, contraste ≥ 4,5:1. Pas de gris clair « élégant ».
- **Encre atténuée** (`[à résoudre]`) : labels secondaires, toujours ≥ 4,5:1 — jamais le gris délavé par défaut.

### Named Rules
**The One Voice Rule.** L'accent violet ne couvre jamais plus de **10 %** d'un écran. Action primaire, sélection, progression : c'est tout. Sa rareté EST le message.

**The No Fitness-Red Rule.** Le rouge/orange « énergie » des trackers génériques est **interdit** comme accent. La couleur de l'app, c'est le violet froid et premium — pas la salle de sport.

## 3. Typography

**Sans (texte/UI) :** `[famille à choisir — sans technique/géométrique, ex. familles type Inter / Geist / SF]`
**Mono (chiffres mesurés) :** `[famille mono à chiffres tabulaires à choisir]`

**Character :** un sans neutre et lisible porte tout (titres, labels, boutons, corps), pris dans une seule famille en plusieurs graisses. Les **chiffres** basculent en mono à chasse fixe : ils s'alignent en colonne et donnent l'effet « cadran d'instrument ».

### Hierarchy
- **Display** (échelle rem fixe, pas de `clamp` fluide) : le nom de l'exo en cours, roi de l'écran-salle.
- **Headline / Title** : titres de séance, d'analyse.
- **Body** (65–75ch en prose) : notes, instructions.
- **Readout** (mono, chasse tabulaire) : poids · reps · RIR · e1RM. Le gros nombre de la série en cours est ici.
- **Label** : métadonnées discrètes (référence « dernière fois », compteur de séries).

### Named Rules
**The Readout Rule.** Tout chiffre **mesuré** (poids, reps, RIR, e1RM, dates) est en mono à chasse tabulaire. Les chiffres s'alignent verticalement et ne « dansent » jamais entre deux séries.

**The Fixed-Scale Rule.** Échelle typographique en rem **fixe**, pas de `clamp` fluide : un outil se lit à DPI constant, une taille qui rétrécit dans un panneau est pire, pas mieux.

## 4. Elevation

**Plat par défaut.** La profondeur vient du **palier tonal** (surface un cran plus claire que le fond quasi-noir), pas de l'ombre. Cohérent avec une énergie de motion *Responsive* : pas de couches qui flottent pour décorer. Une ombre n'apparaît qu'en **réponse à un état** — feuille/sheet active, focus — jamais au repos.

### Named Rules
**The Flat-By-Default Rule.** Les surfaces sont plates au repos. L'ombre est une réaction (focus, élévation d'une feuille), pas une texture.

## 5. Components

*Seed : aucun composant n'existe encore. Ils seront documentés au prochain passage `/impeccable document` en mode scan, sur le vrai code.*

Primitives signature à venir (issues de la session, pour mémoire) :
- **Stepper +/− au pouce** et **pavé numérique custom** (jamais le clavier OS) pour poids/reps/RIR.
- **Bouton « logger la série » en 1 tap**, cible déjà affichée.
- **Sélecteur « je tape l'exo que j'attaque »** (ordre libre).
- **Courbe e1RM** (analyse) façon Apple Fitness : lisible, sobre, l'accent violet pour la série de référence.

## 6. Do's and Don'ts

### Do:
- **Do** garder l'accent violet sur **≤10 %** de l'écran : action primaire, sélection courante, indicateur de progression.
- **Do** afficher **tout chiffre mesuré en mono tabulaire** ; les readouts s'alignent en colonne.
- **Do** tenir le **contraste WCAG AA** (lisible sous néons, à bout de bras) ; bumper le texte vers l'encre plutôt que vers le gris.
- **Do** des **tap-targets ≥ 44px**, tout atteignable au pouce d'une main.
- **Do** rester **plat par défaut** ; profondeur par paliers tonals, ombres seulement en réponse à un état.
- **Do** une motion **150–250 ms** qui sert l'état ; `prefers-reduced-motion` → crossfade ou instantané.
- **Do** coder progrès/stagnation/régression par **couleur + signe/forme**, jamais par la couleur seule.

### Don't:
- **Don't** ressembler à **Hevy / Strong / FitNotes** : interfaces chargées, formulaires à rallonge, boutons partout.
- **Don't** faire surgir le **clavier OS** : steppers et pavé custom au pouce, point.
- **Don't** utiliser le **rouge/orange « énergie » fitness** comme accent.
- **Don't** de **décoration gratuite**, ni ton « coach motivant », ni emojis/confettis.
- **Don't** de **gris clair « élégant »** sur le fond sombre : c'est la première cause d'illisibilité.
- **Don't** de **tiret long (—)** dans le texte affiché : un point ou une virgule à la place. (Préférence produit ferme.)
- **Don't** (bans absolus) : bordure-latérale colorée > 1px, texte en dégradé (`background-clip: text`), glassmorphism décoratif, template hero-metric, eyebrow majuscule traquée au-dessus de chaque section.
