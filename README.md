<div align="center">

<img src="public/icon.svg" width="92" alt="Croustylift" />

# Croustylift

**Tracker de musculation — capture zéro-friction en salle, analyse au calme.**

Logge chaque série en un geste, le téléphone à bout de bras sous les néons.
Lis ta progression réelle au calme, façon cadran d'instrument.

[![License](https://img.shields.io/badge/license-MIT-7c5cff.svg)](./LICENSE)
[![PWA](https://img.shields.io/badge/PWA-offline--first-7c5cff.svg)](#pwa--offline-first)
![React](https://img.shields.io/badge/React-19-20232a.svg?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646cff.svg?logo=vite&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ecf8e.svg?logo=supabase&logoColor=white)
![Tests](https://img.shields.io/badge/tests-Vitest-22c55e.svg)

</div>

---

## Le pitch

La plupart des trackers te forcent à te battre avec l'app au pire moment — fatigué, pressé,
entre deux séries — puis noient la seule vraie question (**« est-ce que je progresse ? »**)
sous des données brutes.

Croustylift sépare radicalement **deux moments** :

| 🏋️ Capture *(en salle)* | 📈 Analyse *(au calme)* |
|---|---|
| Minimale et increvable. Un tap, au pouce, **jamais de clavier**. Offline d'abord. | Riche et posée. Courbe e1RM façon Apple Fitness, décompte par muscle, comparaison de blocs. |

Projet perso (et quelques potes). PWA installable, **offline-first**, **0 € d'infra**.

## Fonctionnalités

**Capture en salle**
- Logging d'une série en **1 tap**, cible « à battre » déjà affichée.
- Steppers custom au pouce (poids / reps / RIR) : le clavier OS reste facultatif.
- Une séance se **lance** par un geste explicite, qui démarre le chrono (ADR 0011).
- Exercices **unilatéraux** (logging du côté faible), ajout / remplacement d'exo à la volée.
- **Offline-first** : écriture locale immédiate, file d'attente de sync (last-write-wins).
- **Démarrage hors ligne** : l'app s'ouvre sans réseau sur une copie locale de tes
  données, et reconnaît l'appareil sans appel serveur (ADR 0012).

**Analyse au calme**
- **Courbe e1RM** estimée (max théorique à 1 rép), trend par bloc, journal brut auditable.
- **Décompte de séries par muscle** principal, pondéré par les reps.
- Comparaison de **deux blocs au choix**, y compris entre deux routines.

**Organisation**
- Routines → séances → **prescriptions** (séries × fourchette de reps × RIR).
- Catalogue d'exercices **base + perso**, personnalisation par utilisateur.
- **Duplication** d'une séance, dans la même routine ou une autre (ADR 0015).
- **Archivage** des routines et séances déjà exécutées : elles sortent du plan,
  leur historique reste entier (ADR 0017).

**Données & plateforme**
- **Export / import** JSON de tout l'historique.
- Multi-utilisateur (toi + potes), isolation par **RLS** Postgres.
- PWA installable, safe-area iOS, `prefers-reduced-motion` respecté.
- **Mise à jour sans invite** : une nouvelle version s'installe au lancement ou à un
  changement d'onglet, jamais pendant une séance. La version qui tourne (commit et
  date de build) s'affiche dans le bloc Compte de l'Analyse.

## Design — « L'instrument de nuit »

Un instrument de précision qu'on lit dans le noir. Le mode sombre n'est pas un goût : c'est la
réponse à l'usage (néons durs, bras tendu, une main libre). L'« impressionnant » vient de la
**précision**, pas de la décoration.

- **Un seul accent** violet, sur **≤ 10 %** de l'écran *(The One Voice Rule)*.
- **Chiffres mesurés en mono tabulaire** (Geist Mono, zéro barré) — la signature instrument.
- Statut par **couleur + forme** (▲ ▬ ▼), jamais la couleur seule. Pas de rouge « énergie ».
- Tokens **OKLCH**, contraste **WCAG AA** plancher, tap-targets ≥ 44px.

Le système complet est documenté dans **[`DESIGN.md`](./DESIGN.md)** (format Stitch + tokens).

## Stack technique

| Domaine | Choix |
|---|---|
| Front | **React 19** · **Vite** · **TypeScript** (strict) · **Tailwind CSS v4** |
| Données | **Supabase** — Auth + Postgres + RLS · sync UUID client, last-write-wins |
| Dataviz | **Recharts** (courbe e1RM, comparaisons) |
| PWA | `vite-plugin-pwa` / Workbox — precache + offline |
| Typo | Geist · Geist Mono *(Inter en second de pile ; auto-hébergées, sous-ensembles latins)* |
| Tests | **Vitest** · domaine métier en **TDD** |

## Démarrage

> Prérequis : **Node ≥ 20.19**.

```bash
# 1. Installer
git clone https://github.com/Tibxla/croustylift.git
cd croustylift
npm install

# 2. Configurer Supabase
cp .env.example .env
#   puis renseigner :
#   VITE_SUPABASE_URL=...
#   VITE_SUPABASE_PUBLISHABLE_KEY=...

# 3. Lancer
npm run dev
```

| Script | Rôle |
|---|---|
| `npm run dev` | Serveur de dev Vite |
| `npm run build` | Typecheck (`tsc -b`) + build de prod + PWA |
| `npm run preview` | Sert le build de prod en local |
| `npm test` | Tests en watch · `npm run test:run` en one-shot |
| `npm run lint` | ESLint (dont `react-hooks` / React Compiler), plafond de warnings fixé |
| `npm run typecheck` | `tsc -b` seul |
| `npm run size` | Poids gzip de chaque chunk du build, confronté à son budget |
| `npm run contrast` | Contrastes WCAG des tokens de couleur |

Le schéma Postgres et les politiques RLS sont versionnés dans `supabase/migrations/`, appliquées sur le projet Supabase hébergé.

La CI (GitHub Actions) enchaîne lint, tests, build et budget de taille.

### Mise à jour de l'app installée

Après un déploiement, le nouveau service worker **attend** : l'app ouverte garde son
ancien bundle complet, hors ligne compris. Elle bascule (un rechargement) au lancement
tant que rien n'a été touché, ou au changement d'onglet suivant, et jamais pendant une
séance en cours ni pendant une saisie. Le bloc Compte (onglet Analyse) affiche la
version qui tourne et, si une version attend, un bouton « Mettre à jour ». La logique
est dans `src/pwa/`.

### Relevé de diagnostic (iPhone)

Sur iPhone en mode écran d'accueil, WebKit peut garder une fenêtre d'affichage fausse
après le clavier ou un passage en arrière-plan, ce qui décroche les barres du bas.
L'app le détecte, force une remesure et journalise l'incident sur l'appareil
(`src/viewport/`). Un **appui long d'une seconde et demie sur la barre d'onglets**
ouvre le relevé : mesures en direct, journal des incidents, bouton « Copier ». Sur
un navigateur de bureau, `?diag=1` l'ouvre aussi.

## Structure

```
src/
├─ domain/      # Cœur métier pur, testé en TDD (e1RM, décompte séries, déviations…)
├─ features/
│  ├─ capture/      # Écran de salle : picker, cluster instrument, logging
│  ├─ analysis/     # Courbe e1RM, décompte muscle, comparaison de blocs
│  ├─ authoring/    # Routines, séances, prescriptions
│  ├─ exercises/    # Catalogue base + perso
│  ├─ onboarding/   # Premier lancement
│  ├─ export/       # Export / import JSON
│  └─ notes/        # Notes datées
├─ auth/        # Login, mot de passe oublié / réinitialisation
├─ lib/         # Client Supabase, helpers
├─ pwa/         # Service worker : mise à jour contrôlée, reprise sur chunk introuvable
├─ viewport/    # Fenêtre d'affichage iOS : détection, remesure, relevé de diagnostic
└─ index.css    # Tokens OKLCH (@theme) + primitives .btn / .panel / .field
```

## Concepts du domaine

Vocabulaire métier complet dans **[`GLOSSARY.md`](./GLOSSARY.md)**. En bref :

- **Série** : une exécution (poids × reps + RIR). En unilatéral, gauche + droite au même rang.
- **e1RM** : *estimated 1-rep max*, le max théorique à 1 répétition ; la métrique de progression.
- **RIR** : *reps in reserve*, réps qu'il restait dans le réservoir en fin de série.
- **Prescription** : la cible d'un exo dans une séance (séries × fourchette de reps × RIR).
- **Bloc** : une période pendant laquelle le plan n'a pas bougé, l'unité de comparaison de la progression.
- **Déviation** : écart entre le template versionné et ce qui a réellement été fait, dérivé par diff.

## Décisions d'architecture

Les choix structurants sont tracés dans **[`docs/adr/`](./docs/adr/)** — templates de séance
versionnés, déviations dérivées par diff, synchro UUID *last-write-wins*, décompte de séries
pondéré par les reps, gestion de l'unilatéral, chrono au lancement, boot hors ligne,
duplication et archivage des séances, etc.

## Documentation

| Fichier | Contenu |
|---|---|
| [`PRODUCT.md`](./PRODUCT.md) | Stratégie produit — qui, quoi, pourquoi |
| [`DESIGN.md`](./DESIGN.md) | Système visuel — tokens, composants, règles nommées |
| [`GLOSSARY.md`](./GLOSSARY.md) | Glossaire du domaine |
| [`docs/adr/`](./docs/adr/) | Décisions d'architecture |

## Licence

[MIT](./LICENSE) © Tibxla
