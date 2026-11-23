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
- l'instant d'une exécution est son lancement (`started_at`, ADR 0011), posé par l'appareil et exact même hors ligne. Quand l'exécution et la frontière ont chacune leur instant, on compare ces deux instants et rien d'autre : le résultat ne dépend pas du fuseau où l'on relit les données ;
- la création de la ligne (`created_at`) ne remplace jamais le lancement. C'est l'heure d'arrivée en base, fausse après une séance hors ligne ;
- sans lancement horodaté (exécutions d'avant la colonne) ou sans instant de frontière, la règle au jour d'origine reste le repli : le jour de la coupure appartient au bloc qui s'ouvre ;
- le jour d'une frontière, qui sert au libellé et à ce repli, est son jour local, comme celui des exécutions. Daté en UTC, un plan édité à 00 h 30 à Paris tombait la veille.

Limite assumée : l'exécution ne naît qu'à sa première série (ADR 0011) et garde la version sous laquelle elle est née (ADR 0021). Si le plan est retouché entre le lancement et la première série, la séance se joue sous la nouvelle version mais reste rangée dans l'ancien bloc. La fenêtre est d'une heure au plus, un lancement sans série expirant au bout d'1 h.

Deux blocs peuvent donc naître le même jour et porter chacun des points : un bloc s'identifie par son instant de début, plus par sa date.

**Bloc implicite.** Un compte qui capture avant d'avoir activé une routine (la Capture se replie sur la première routine non archivée) n'avait aucun bloc pour ces séances, écartées de la comparaison sans rien dire. Quand la première séance réellement faite (au moins une série, la plus ancienne par jour puis par lancement) précède toute activation, elle ouvre un bloc sur la routine de sa séance, à son lancement, à défaut à son jour. La dérivation des blocs ne lit pas d'autre exécution, et une déviation ne crée toujours pas de bloc.

**Enregistrer sans modifier ne crée pas de version.** « Éditer une prescription crée une nouvelle version » suppose une édition. L'éditeur de séance créait une version à chaque appui sur « Enregistrer », même sans changement, ce qui coupait un bloc en deux périodes de configuration identique. Il ne crée plus de version que si les prescriptions diffèrent de la dernière enregistrée.
