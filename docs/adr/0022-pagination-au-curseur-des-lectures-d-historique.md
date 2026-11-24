# Lectures d'historique paginées au curseur sur `id`

Toute lecture « tout l'historique » passe par `fetchAllRows` (`src/lib/fetch-all.ts`), qui enchaîne les pages : chaque page est triée par `id` seul et demande les lignes d'id supérieur au dernier reçu. La lecture s'arrête sur une page courte (moins de lignes que demandé), sans requête de plus. L'ordre métier (date, ordre de saisie) est reposé côté client. Le compte connecté est relevé au départ et revérifié après chaque page : s'il a changé, la lecture lève une erreur et ne rend rien.

Sont concernés : journal, exos entraînés, courbes, métriques, blocs, historique du plan, catalogue des séances, historique d'un exo en Capture, export JSON.

## Pourquoi

PostgREST plafonne chaque réponse (« Max rows », 1000 par défaut chez Supabase) et tronque en silence au-delà : ni erreur, ni indice. Passé ce seuil, les lectures d'historique perdaient des lignes dans un ordre non garanti. Un exo très pratiqué dérivait sa Référence et ses records d'un historique tronqué, et l'export produisait une sauvegarde incomplète qui avait l'air entière.

Le curseur ne dépend que de la dernière ligne reçue. `id` est la clé unique de toutes les tables lues, donc une écriture arrivée entre deux pages ne fait ni sauter ni relire une ligne.

L'arrêt sur page courte évite un aller-retour. Avec l'arrêt sur page vide, cette requête de plus, coupée, faisait échouer une lecture déjà complète (Capture sans copie au premier montage).

La garde de compte existe parce que supabase-js résout le jeton à chaque requête : une Déconnexion suivie d'une Connexion pendant la lecture ferait lire les pages suivantes chez un autre compte, avec le curseur du premier.

## Alternatives écartées

- **Pagination par offset (`.range()`)** : une écriture entre deux pages décale la fenêtre. Une ligne supprimée en fait sauter une autre, une ligne insérée en fait relire une.
- **Arrêt sur page vide** : une requête de plus, et une lecture complète qui échoue si elle est coupée.
- **Lecture en une seule requête** (comportement d'origine) : tronquée à 1000 lignes sans le dire.

## Conséquences

- Hypothèse à tenir : le plafond « Max rows » du projet est au moins égal à la taille de page (`FETCH_PAGE_SIZE`, 1000), vérifié en prod le 2026-11-23. S'il était abaissé, une page courte ne serait plus la fin ; il faudrait alors aligner la taille de page sur le plafond.
- Contrat de l'appelant : sélectionner `id`, trier par `id` seul, limiter, filtrer `id > curseur`. Un tri métier dans la requête casse le curseur ; il se pose après, côté client (`inCreationOrder` ou les tris du domaine).
- Ce n'est pas un instantané : chaque page est une requête à part, une ligne modifiée pendant la lecture peut être lue avant ou après sa modification. L'export, qui lit plusieurs tables, écarte donc les lignes dont le parent manque (`withoutRowsNewerThanTheirParent`), pour rester restaurable. Les liens vers `exercises` sont vérifiés contre tout le catalogue lu, exos de base compris, avant que ceux-ci soient retirés de la sauvegarde.
- Garde-fou : la lecture s'arrête en erreur si le curseur ne progresse pas, ou au bout de 1000 pages.
