# Copie d'historique relue après acquittement, sous gardes d'ordre

Après toute passe de flush qui acquitte des séries (insertion, suppression de série, suppression d'exécution), la copie locale de l'historique des exos concernés est relue depuis le réseau, en fond, sans attendre la relance de l'app. Comme plusieurs lectures d'une même clé peuvent être en vol, l'écriture de la copie passe par trois gardes :

1. **Dernière réponse écrite.** Une réponse n'écrit la copie que si elle est partie après la dernière réponse déjà écrite pour sa clé.
2. **Seuil.** Une relecture qui suit un acquittement pose un seuil sur sa clé à son départ : toute réponse partie avant ne peut plus écrire, même si la relecture elle-même échoue.
3. **Purge et compte.** Une réponse partie avant une purge du cache, ou arrivée après un changement de compte reconnu, n'écrit rien. La purge a son propre compteur.

Dans tous les cas la valeur lue est rendue à son appelant ; les gardes ne portent que sur la copie.

## Pourquoi

L'ADR 0014 fait voir à la Référence les séries encore en file. Une fois acquittée, la série quitte la file, mais la copie de lecture ne la contenait pas encore : la séance suivante dérivait son repère d'une copie périmée jusqu'à la prochaine revalidation, donc en pratique jusqu'à la relance. Le trou s'ouvrait au moment précis où la synchro réussissait.

Les gardes viennent des courses que cette relecture crée. Une revalidation de fond partie avant l'acquittement d'une suppression pouvait répondre après la relecture et remettre dans la copie la série ou la séance supprimée. Le seuil tient même quand la relecture échoue : sans cela, hors ligne juste après l'acquittement, la réponse ancienne gagnait.

On compare à la dernière réponse écrite, pas à la dernière lecture partie. Avec la seconde règle, un « Réessayer » qui échoue sur réseau lent empêchait la réponse tardive et valide de la lecture précédente de semer la copie, et le premier démarrage restait sur « Impossible de charger ton compte ».

## Alternatives écartées

- **Write-through** (l'outbox écrit aussi dans la copie) : déjà écarté par l'ADR 0014, pour la même raison. Deux endroits devraient s'accorder sur la forme d'une ligne serveur.
- **Relire toutes les copies d'historique après chaque flush** : simple, mais chaque relecture pose un seuil. Si celle d'un exo sans rapport échoue, la réponse valide d'une lecture en cours sur cet exo est écartée. Seuls les exos touchés sont relus.
- **Comparer à la dernière lecture partie** : voir ci-dessus, une relance en échec bloque une réponse valide.
- **S'en remettre à la revalidation générale d'après flush** : elle ne rejoue que les lectures déjà vues dans la session, et sans garde d'ordre.

## Conséquences

- `flush` ne dit pas quelles ops sont passées : chaque fonction de sync note les exos qu'elle touche, et `flushOutbox`, point de passage de tous les flush, relit leurs copies une fois la passe finie, même arrêtée sur un échec.
- Une suppression ne porte que l'id de sa ligne. Ses exos se retrouvent par trois voies : ceux que l'émetteur nomme sur l'op (`exerciseIds`, posé par l'annulation en Capture et par l'éditeur de séance passée), les copies qui contiennent la ligne, et la mémoire de session des séries acquittées. Une op ancienne sans `exerciseIds` garde les deux dernières.
- Les ops d'exécution (création, clôture, métriques) ne déclenchent aucune relecture : la copie ne porte ni clôture ni métriques de fin.
- Seules les écritures faites depuis cet appareil déclenchent la relecture sous seuil. Une série écrite ailleurs, ou une app tuée entre l'acquittement et la réponse de la relecture, est rattrapée par la revalidation de fond de la copie, que l'écran monté suit désormais (amendement du 2026-11-23). Hors ligne, la copie reste en retard jusqu'au retour du réseau.
- Complète l'ADR 0014 (la Référence ne retombe plus en retard quand la file se vide) et la limite de revalidation de l'ADR 0012.

## Amendement du 2026-11-23 (Lot 3)

**Référence suivie en direct.** La limite « pas de mise à jour en direct » est levée. La séance s'ouvre sur les copies locales, et leur revalidation de fond répond juste après : quand la copie d'historique d'un exo change, la Capture montée rejoue sa dérivation (copie fusionnée avec la file, sans réseau) et met à jour la Référence, le repli de préremplissage et les records de cet exo. Trois règles tiennent l'écran :

- Seule une écriture passée par les gardes d'ordre prévient l'écran (`onReadWritten`) : une réponse supplantée, non écrite, ne peut pas faire reculer l'affichage. Une purge n'est pas une écriture, et une copie absente ne change rien à l'écran.
- La dérivation est rejouée à chaque écriture de la copie (chaque série acquittée en provoque une), mais l'exo n'est remplacé que si le résultat diffère. Elle est aussi rejouée une fois au montage, la revalidation pouvant répondre avant.
- Le brouillon de la série en cours est marqué « touché » à la première interaction dans la zone de saisie (tap, focus, frappe même non validée) et ne bouge alors plus : seul l'historique change. Un brouillon intact suit le nouveau préremplissage. Le marqueur est levé quand une nouvelle saisie commence (série loggée ou annulée, changement de côté ou d'exo) (`shouldReseedDraft`).

Reste : hors ligne, rien ne revalide, la copie garde son retard jusqu'au retour du réseau.

## Amendement du 2026-11-24 : le flush dit ce qu'il a acquitté

La conséquence « `flush` ne dit pas quelles ops sont passées » est levée. La passe rend le sort de chaque écriture traitée, avec les exos dont l'historique vient de changer en base (ADR 0025), et `flushOutbox` relit leurs copies. Les fonctions de sync ne notent plus rien de côté. Pour une suppression, les exos sont ceux que l'émetteur nomme, ceux des écritures de la même série ou de la même exécution que le registre retient encore (dix minutes, à la place de la mémoire de session), et les copies qui contiennent la ligne. Une suppression conditionnelle que la base n'a pas faite ne relit rien. Les trois gardes d'ordre ne changent pas.
