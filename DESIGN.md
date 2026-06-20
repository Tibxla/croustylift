---
name: Croustylift
description: Tracker de musculation — capture zéro-friction en salle, analyse au calme.
colors:
  accent: "oklch(0.62 0.19 286)"
  accent-strong: "oklch(0.55 0.20 286)"
  accent-ink: "oklch(0.74 0.16 288)"
  accent-soft: "color-mix(in oklab, oklch(0.62 0.19 286), transparent 86%)"
  on-accent: "oklch(0.99 0.01 286)"
  bg: "oklch(0.145 0.012 286)"
  surface: "oklch(0.192 0.014 286)"
  surface-2: "oklch(0.238 0.016 286)"
  line: "oklch(0.30 0.012 286)"
  ink: "oklch(0.975 0.004 286)"
  ink-muted: "oklch(0.715 0.018 286)"
  ink-faint: "oklch(0.545 0.016 286)"
  good: "oklch(0.80 0.13 158)"
  warn: "oklch(0.82 0.115 80)"
typography:
  display:
    fontFamily: "Geist Variable, Inter Variable, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  hero-readout:
    fontFamily: "Geist Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "62px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "tabular-nums slashed-zero"
  metric-readout:
    fontFamily: "Geist Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "52px"
    fontWeight: 500
    fontFeature: "tabular-nums slashed-zero"
  body:
    fontFamily: "Geist Variable, Inter Variable, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Variable, Inter Variable, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    letterSpacing: "0.04em"
  kicker:
    fontFamily: "Geist Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 600
    letterSpacing: "0.14em"
rounded:
  chip: "10px"
  input: "14px"
  card: "16px"
  panel: "18px"
  pill: "20px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.card}"
    height: "56px"
  button-primary-hover:
    backgroundColor: "color-mix(in oklab, oklch(0.62 0.19 286), transparent 80%)"
    textColor: "{colors.accent-ink}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    height: "44px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    height: "54px"
  chip-neutral:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.chip}"
  chip-accent:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.chip}"
---

# Design System: Croustylift

## 1. Overview

**Creative North Star : « L'instrument de nuit »**

Un instrument de précision qu'on lit dans le noir. Scène physique : entre deux séries, sous des néons durs, le téléphone à bout de bras, une seule main libre — puis le soir, posé sur le canapé. Cette scène **force le mode sombre** : fond mat quasi-noir pour tuer l'éblouissement, contraste élevé pour rester lisible de loin, les données qui ressortent au lieu de se noyer. Le mode sombre n'est pas un goût ici, c'est la réponse à l'usage.

La personnalité tient en trois mots de PRODUCT.md : **rapide · clean · impressionnant**. L'« impressionnant » ne vient pas de la couleur ni de la décoration — il vient de la **précision** : une hiérarchie nette, un seul accent qui claque, des chiffres alignés comme sur un cadran. On vole la **sobriété sombre et précise de Linear** et la **lisibilité des graphes d'Apple Fitness**, rien d'autre. La matière premium tient à des finitions « machinées » — hairlines 1px, liseré spéculaire en haut des surfaces, ombres chuchotées — et à une seule lueur violette : celle du bouton d'action.

Ce que le système **rejette explicitement** (anti-références de PRODUCT.md) : tout ce qui ressemble aux trackers de muscu classiques — **Hevy, Strong, FitNotes** — encombrés de boutons, formulaires à rallonge, claviers qui surgissent, décoration gratuite et ton « coach motivant » à emojis. Croustylift disparaît dans la tâche ; il n'essaie pas d'animer ta séance.

**Key Characteristics :**
- Base mate quasi-noire teintée vers l'accent (mode sombre par nécessité, pas par mode).
- **Un seul accent** : violet/indigo électrique, sur ≤10 % de l'écran, jamais décoratif.
- **Chiffres en mono tabulaire** (Geist Mono, chasse fixe, zéro barré) — la signature instrument.
- Contraste WCAG AA plancher, pensé pour les néons et le bras tendu.
- Densité au pouce : tout atteignable d'une main, tap-targets ≥ 44px.
- Plat par paliers tonals + finitions machinées (hairline, liseré spéculaire) ; la seule lumière est le halo accent de l'action primaire.

## 2. Colors

Palette **Restrained** : un océan de quasi-noir teinté, traversé par un seul trait de violet électrique. La rareté de l'accent est ce qui le rend impressionnant. Tout est en OKLCH (doctrine du projet, défini dans `@theme` de `src/index.css`).

### Primary
- **Violet électrique** (`oklch(0.62 0.19 286)` — `--color-accent`) : trait de courbe, sélection, indicateur de progression, bordure de l'action primaire. **Jamais** décoratif.
- **Violet d'appui** (`oklch(0.55 0.20 286)` — `--color-accent-strong`) : variante foncée pour les fonds d'action si besoin de contraste blanc.
- **Encre accent** (`oklch(0.74 0.16 288)` — `--color-accent-ink`) : texte/icône violet **sur fond sombre** (≥ 6:1) — c'est le texte du bouton primaire et des kickers.
- **Violet voilé** (`color-mix(accent, transparent 86%)` — `--color-accent-soft`) : fond de l'action primaire et des chips accent — un violet à peine présent, rehaussé par la bordure + le halo.

### Neutral
- **Noir d'instrument** (`oklch(0.145 0.012 286)` — `--color-bg`) : fond. Quasi-noir mat, teinté ~0.012 de chroma **vers le violet** de l'accent (pas vers le « chaud »).
- **Surface** (`oklch(0.192 0.014 286)` — `--color-surface`) : panneaux, cartes, lignes de série — un palier tonal au-dessus du fond.
- **Surface +2** (`oklch(0.238 0.016 286)` — `--color-surface-2`) : hover, ligne sélectionnée, segment actif, fond des steppers — le palier neutre qui marque l'état (le violet reste pour l'action).
- **Encre** (`oklch(0.975 0.004 286)` — `--color-ink`) : texte principal, quasi-blanc (≥ 16:1 sur surface).
- **Encre atténuée** (`oklch(0.715 0.018 286)` — `--color-ink-muted`) : labels secondaires (≥ 7:1 — jamais le gris délavé).
- **Encre discrète** (`oklch(0.545 0.016 286)` — `--color-ink-faint`) : méta et kickers mono.
- **Finitions machinées** : `--hair` `rgba(255,255,255,0.075)` (bordure 1px des cartes), `--hair-strong` `rgba(255,255,255,0.14)` (cartes clés), `--spec` `rgba(255,255,255,0.055)` (liseré spéculaire haut, en `box-shadow: inset 0 1px 0`).

### Secondary (statut — couleur **plus** forme, jamais la couleur seule)
- **Vert froid** (`oklch(0.80 0.13 158)` — `--color-good`) : cible atteinte/battue, accompagné du signe ▲.
- **Ambre** (`oklch(0.82 0.115 80)` — `--color-warn`) : sous-objectif, série passée, destructif — accompagné du signe ▼/▬. **Jamais** de rouge.

### Named Rules
**The One Voice Rule.** L'accent violet ne couvre jamais plus de **10 %** d'un écran. Action primaire, sélection, progression : c'est tout. Sa rareté EST le message. Une seule surface est pleinement violette par écran : le bouton primaire.

**The No Fitness-Red Rule.** Le rouge/orange « énergie » des trackers génériques est **interdit** comme accent. La couleur de l'app, c'est le violet froid et premium — pas la salle de sport. Une régression reste en **ambre atténué**, pas en alarme.

## 3. Typography

**Sans (texte/UI) :** `Geist Variable` (fallback `Inter Variable`, `system-ui`)
**Mono (chiffres mesurés) :** `Geist Mono Variable` (fallback `JetBrains Mono`)

**Character :** un sans technique et neutre porte tout (titres, labels, boutons, corps) en une seule famille, plusieurs graisses ; titres en 600 / `-0.025em`. Les **chiffres mesurés** basculent en mono à chasse tabulaire avec **zéro barré** : ils s'alignent en colonne et donnent l'effet « cadran d'instrument ». Échelle en rem **fixe**, jamais de `clamp` fluide.

### Hierarchy
- **Display** (600, 28–30px, `-0.025em`) : nom de l'exo en cours / titre d'écran, roi de l'écran-salle.
- **Headline / Title** (600, 17–20px) : titres de séance, noms de carte, en-têtes d'analyse.
- **Hero Readout** (mono, 500, **62px**, `-0.03em`) : le poids de la série en cours, dans le cluster instrument.
- **Metric Readout** (mono, 500, **52px**) : la métrique e1RM héros en Analyse ; totaux 24–32px.
- **Body** (400, 15px, line-height 1.5, 65–75ch en prose) : notes, instructions, sous-titres.
- **Label** (500, 12–13px, `0.04em`) : libellés de champ, métadonnées discrètes.
- **Kicker** (mono, 600, 10–12px, `0.1–0.18em`, majuscules, `ink-faint`) : « ROUTINE COURANTE », « SÉRIES LOGGÉES », en-têtes de section.

### Named Rules
**The Readout Rule.** Tout chiffre **mesuré** (poids, reps, RIR, e1RM, dates, compteurs) est en mono à chasse tabulaire (`.readout` : `tabular-nums slashed-zero`). Les chiffres s'alignent verticalement et ne « dansent » jamais entre deux séries.

**The Fixed-Scale Rule.** Échelle typographique en rem **fixe**, pas de `clamp` fluide : un outil se lit à DPI constant ; une taille qui rétrécit dans un panneau est pire, pas mieux.

## 4. Elevation

**Plat par paliers tonals, rehaussé d'une finition machinée.** La profondeur principale vient du **palier tonal** (surface un cran plus claire que le fond), pas d'une ombre portée. Chaque surface porte ensuite une finition « machinée » : bordure **hairline 1px** + **liseré spéculaire** (`inset 0 1px 0 var(--spec)`, la lumière vient d'en haut) + une **ombre chuchotée** (`0 1px 2px rgba(0,0,0,.45)`). La seule vraie **lumière** du système est le **halo accent** du bouton primaire ; le cluster instrument reçoit une ombre interne douce. Motion *Responsive* (150–250 ms) : rien ne flotte pour décorer.

### Shadow Vocabulary
- **Carte (`--shadow-card`)** (`inset 0 1px 0 var(--spec), 0 1px 2px rgba(0,0,0,.45)`) : `.panel` / `.surface-card` au repos.
- **Surélevé (`--shadow-raised`)** (`inset 0 1px 0 var(--spec), 0 2px 4px rgba(0,0,0,.3), 0 14px 32px -14px rgba(0,0,0,.6)`) : feuilles modales, barres d'action flottantes.
- **Cluster instrument** (`inset 0 1px 0 var(--spec), 0 14px 30px -18px rgba(0,0,0,.7)`) sur un fond `linear-gradient(180deg, surface, color-mix(surface,#000 8%))`.
- **Halo accent (bouton primaire)** (`0 0 14px -3px [accent/40], 0 6px 20px -8px [accent/35], inset 0 0 12px -6px [accent/50]`) : la matière lumineuse de l'action primaire. **Pas de dégradé plein, pas d'ombre noire dure.**
- **Anneau de focus (champ)** (`0 0 0 3px [accent/0.3]` + bordure `accent`) : seul halo au focus clavier.

### Named Rules
**The Flat-By-Default Rule.** Les surfaces sont plates au repos ; la profondeur vient des paliers et de la finition hairline + spéculaire, pas d'une ombre décorative. L'ombre portée n'apparaît qu'en **réponse à un état** (feuille active, barre flottante, focus).

**The Single-Glow Rule.** La seule surface qui **rayonne** est le bouton d'action primaire (halo accent doux). Tout autre élément reste mat : un deuxième glow tuerait la One Voice Rule.

## 5. Components

État de référence : `src/index.css` (primitives `@layer components`) + composants par feature dans `src/features/*` et `src/auth/*`. Affordances **constantes** d'un écran à l'autre (même forme de bouton, même vocabulaire de champ, même style d'icône stroke).

### Buttons
- **Shape :** coins arrondis 14px (`.btn`, `rounded-[0.875rem]`) ; les CTA pleine largeur montent à 16–18px (`rounded-2xl` / `rounded-[18px]`). `:active` = `scale(0.97)`.
- **Primary — « contour accent » lumineux** (`.btn-primary`) : fond `accent-soft` + **bordure `accent`** + texte `accent-ink`, rehaussé du **halo accent 3 couches** (cf. Elevation). C'est la seule surface pleinement violette. Hover : voile un cran plus dense (`accent` à transparent 80%). Disabled : opacité 0.45, halo retiré. **Pas de dégradé plein, pas de texte blanc-sur-violet.**
- **Secondary — fantôme cerclé** (`.btn-secondary`) : fond transparent + bordure `hair-strong` ; le **ton** est porté par l'action — `ink-muted` (neutre : Renommer, Modifier, Exporter), `accent-ink` + `border-accent` + 600 (accent : Éditer, Définir courante), `warn` (destructif : Supprimer — bordure `hair-strong`, **jamais** de bordure ni d'aplat warn). Hover : wash `surface`.
- **Ghost — texte seul** (`.btn-ghost`) : `ink-muted`, wash discret au hover (Clôturer sans noter, retour). 
- **Petit « + » d'en-tête / icône accent** : carré 40px, `accent-soft` + bordure `accent` + `accent-ink` + liseré spéculaire — distinct du CTA plein.

### Chips / Badges
- **Neutre** (`bg-surface-2`, `ink-muted`, 11.5px, rayon 10px) : muscles, badge « Base », « Unilatéral » sans accent.
- **Accent** (`accent-soft` + bordure `accent` + `accent-ink`) : « Personnalisé », « Unilatéral » (carte perso), segment courant.
- **Contour déviation** (bordure `hair-strong`, `ink-muted`) : « Ajouté » / « Remplacé ».
- **Règle :** un statut porte toujours un **mot** (et/ou une **forme** ▲ ▬ ▼), jamais la seule couleur.

### Cards / Containers
- **Corner Style :** 16px (`.panel`/`.surface-card`), 18px pour les rangées denses.
- **Background / Border / Shadow :** `surface` + hairline `--hair` 1px + `--shadow-card` (cf. Elevation).
- **`.panel-key`** : bordure `--hair-strong` pour marquer une carte clé (séance dépliée, séance courante).
- **`.surface-interactive`** : carte tappable, ajoute hover (`surface-hover`) + `:active scale(0.99)`. Pattern « carte = bouton plein recouvrant + actions sœurs » pour éviter les boutons imbriqués.
- **`.surface-raised`** : feuilles modales (bottom-sheet) et barres d'action — `--shadow-raised` + poignée `surface-2` 42×5px.

### Inputs / Fields
- **Style** (`.field`) : fond `surface`, bordure `--hair` 1px, liseré `inset 0 1px 0 var(--spec)`, rayon 14px, hauteur 54px. Placeholder en `ink-faint` (≥ 4.5:1, jamais le gris par défaut).
- **Focus** : bordure `accent` + anneau `0 0 0 3px [accent/0.3]`. Recherche : loupe `ink-faint` à gauche.
- **Disabled / autofill** : fond `surface` forcé (l'autofill navigateur est neutralisé pour ne pas casser le thème sombre).

### Navigation
- **Bottom tab nav** persistante (`h-14`, `--nav-height: 3.5rem`) avec `safe-area-inset-bottom` ; surfaces et barres d'action fixes s'alignent sur `--nav-offset`.
- **Top bar capture** : boutons carrés 38px (`panel`) back / overflow ; centre en mono `ink-muted`.

### Signature components
- **Cluster instrument** (écran roi) : carte rayon 20–22px, fond `linear-gradient(180deg, surface, color-mix(surface,#000 8%))`, bordure `hair-strong`, ombre interne douce. Boutons ronds `−`/`+` (54px poids, 40px reps/RIR ; le `+` poids en accent), readout poids **62px mono**. Steppers custom **jamais le clavier OS** (tap-to-type optionnel préservé).
- **Stepper rectangulaire** (`.Stepper`, partagé par 5 surfaces) : `−` / valeur mono / `+`, pas fin configurable.
- **Courbe e1RM** (Analyse, recharts) : trait `accent` 2.5px, aire dégradée violet 32 %→0, grille hairline, ligne de référence pointillée `ink-faint` `4 5`, points cerclés, **dernier point plein accent r=5**. Façon Apple Fitness.
- **StatusIndicator** : pastille SVG dont la **forme** change avec l'état (anneau à faire, anneau+disque en cours, disque+coche fait, anneau+tiret passé) — couleur ET forme.
- **ProgressionBadge / TrendArrow** : flèche ▲ ▬ ▼ + signe + couleur, sur fond teinté `good-soft` / `warn-soft` selon la tendance.
- **Plaquette logo** (Login) : squircle 62px (gradient `surface-2`→`bg`, bordure `hair-strong`, liseré spéculaire + halo accent) contenant 3 barres ascendantes (faint / muted / accent avec glow).

## 6. Do's and Don'ts

### Do:
- **Do** garder l'accent violet sur **≤10 %** de l'écran : action primaire, sélection courante, indicateur de progression.
- **Do** afficher **tout chiffre mesuré en mono tabulaire** (`.readout`) ; les readouts s'alignent en colonne.
- **Do** réserver la **seule lueur** de l'écran au bouton primaire (halo accent doux : `0 0 14px -3px [accent/40], 0 6px 20px -8px [accent/35], inset 0 0 12px -6px [accent/50]`).
- **Do** tenir le **contraste WCAG AA** (lisible sous néons, à bout de bras) ; bumper le texte vers l'encre plutôt que vers le gris.
- **Do** des **tap-targets ≥ 44px**, tout atteignable au pouce d'une main.
- **Do** rester **plat par défaut** ; profondeur par paliers tonals + finition hairline/spéculaire, ombres portées seulement en réponse à un état.
- **Do** une motion **150–250 ms** ease-out (quart/quint/expo) qui sert l'état ; `prefers-reduced-motion` → crossfade ou instantané.
- **Do** coder progrès/stagnation/régression par **couleur + signe/forme** (▲ ▬ ▼), jamais par la couleur seule.

### Don't:
- **Don't** ressembler à **Hevy / Strong / FitNotes** : interfaces chargées, formulaires à rallonge, boutons partout.
- **Don't** faire surgir le **clavier OS** : steppers et pavé custom au pouce, point.
- **Don't** donner au bouton primaire un **dégradé plein**, un texte blanc-sur-violet ou une **ombre noire dure** : c'est le contour accent + halo, pas un aplat élevé.
- **Don't** un **deuxième élément qui rayonne** : un seul glow violet par écran (Single-Glow Rule).
- **Don't** utiliser le **rouge/orange « énergie » fitness** comme accent ; un destructif est en **ambre** + bordure `hair-strong`, jamais en bordure/aplat warn.
- **Don't** de **décoration gratuite**, ni ton « coach motivant », ni emojis/confettis.
- **Don't** de **gris clair « élégant »** sur le fond sombre : c'est la première cause d'illisibilité.
- **Don't** de **tiret long (—)** dans le texte affiché : un point médian `·` ou une virgule à la place. (Préférence produit ferme.)
- **Don't** (bans absolus) : bordure-latérale colorée > 1px, texte en dégradé (`background-clip: text`), glassmorphism décoratif, template hero-metric, eyebrow majuscule traquée au-dessus de **chaque** section.
