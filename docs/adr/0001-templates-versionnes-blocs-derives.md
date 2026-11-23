# Templates versionnés, blocs dérivés automatiquement

Les séances et leurs prescriptions sont **versionnées** : éditer une prescription crée une nouvelle version, et chaque exécution reste rattachée à la version active au moment où elle a eu lieu. Un **bloc** (l'unité de comparaison de la progression) n'est jamais déclaré à la main — il est dérivé automatiquement comme la période continue durant laquelle la configuration du template (routine courante + ses séances) n'a pas changé. Les déviations d'exécution (série annulée/ajoutée, exo skippé/remplacé) ne créent ni version ni bloc.

## Pourquoi

Le but produit est de comparer des configurations d'entraînement stables (« triceps 2 séries vs 4 séries ») par vitesse de progression. Ça n'a de sens que si (a) on sait précisément sous quelle prescription chaque perf a été réalisée, et (b) les frontières de blocs suivent les changements *de plan*, pas le bruit des séances individuelles.

## Alternatives écartées

- **Templates mutables (édition en place)** : casse l'auditabilité — une perf passée ne saurait plus dire sous quelle prescription elle a eu lieu, et l'attribution aux blocs devient fausse.
- **Blocs déclarés manuellement** : friction et oublis ; l'utilisateur a explicitement refusé de déclarer les blocs à l'avance.

## Conséquences

- Toute lecture du template vise une version précise (celle active à une date donnée).
- Les déviations sont stockées au niveau exécution, séparées du template versionné.

## Amendement du 2026-11-23

**Rattachement par instant.** Le code rattachait une exécution à son bloc par jour : la frontière d'un bloc était réduite à sa date, et toute séance de ce jour-là passait dans le nouveau bloc. Une séance faite à 18 h, suivie d'une retouche du plan à 19 h 30, changeait donc de bloc, alors qu'elle avait été faite sous l'ancien plan. Le geste le plus naturel, éditer sa séance juste après l'avoir faite, était celui qui déplaçait le point. La règle écrite plus haut (« rattachée à la version active au moment où elle a eu lieu ») s'applique désormais à la lettre :

- chaque changement de plan garde son instant, et un bloc est borné par deux instants, début inclus et fin exclue ;
- l'instant d'une exécution est son lancement (`started_at`, ADR 0011), à défaut la création de sa ligne ;
- le jour tranche d'abord, l'instant départage le même jour. Une séance hors ligne dont la ligne n'atteint la base que le lendemain ne change donc pas de bloc pour autant. Sans instant d'un côté ou de l'autre, le jour de la coupure appartient au bloc qui s'ouvre ;
- le jour d'une frontière est son jour local, comme celui des exécutions. Daté en UTC, un plan édité à 00 h 30 à Paris tombait la veille.

Deux blocs peuvent donc naître le même jour et porter chacun des points : un bloc s'identifie par son instant de début, plus par sa date.

**Bloc implicite.** Un compte qui capture avant d'avoir activé une routine (la Capture se replie sur la première routine non archivée) n'avait aucun bloc pour ces séances, écartées de la comparaison sans rien dire. Quand la première exécution du compte précède toute activation, elle ouvre un bloc sur la routine de sa séance, à son jour. C'est la seule exécution que lit la dérivation des blocs ; aucune série n'est lue, une déviation ne crée toujours pas de bloc.

**Enregistrer sans modifier ne crée pas de version.** « Éditer une prescription crée une nouvelle version » suppose une édition. L'éditeur de séance créait une version à chaque appui sur « Enregistrer », même sans changement, ce qui coupait un bloc en deux périodes de configuration identique. Il ne crée plus de version que si les prescriptions diffèrent de la dernière enregistrée.
