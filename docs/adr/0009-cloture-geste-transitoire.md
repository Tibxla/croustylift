# Clôture de séance : geste transitoire, pas un état restaurable

Clôturer une séance pose les métriques de fin (durée chronométrée, BPM moyen optionnel) sur l'exécution et affiche le récap dans la foulée, puis **nettoie l'état de capture local**. Au retour en Capture (changement d'onglet, reload, réouverture le même jour), on repart sur une **capture vierge** (ou le choix de séance) : on ne restaure **aucun** état « séance terminée ». L'état de capture d'une séance **en cours** (non clôturée) reste, lui, restauré. Le récap d'une séance passée se consulte dans le journal.

## Pourquoi

- **Esprit du produit.** La Capture fait « un seul boulot, saisir vite » (PRODUCT.md) ; une fois rangée, la séance appartient au passé. Son récap vit déjà dans le journal (vue Analyse), il n'a pas à squatter l'écran de salle.
- **Supprime le piège par construction.** L'ancien comportement (réafficher « Séance terminée » au remontage) coinçait l'utilisateur sur un écran de fin le reste de la journée, et l'obligeait à « Nouvelle séance » pour repartir. Repartir propre élimine ce cul-de-sac sans cas particulier.

## Alternatives écartées

- **Persister l'état close et réafficher « Séance terminée » au remontage** (le comportement d'origine) : fait survivre le récap à un changement d'onglet, mais piège l'utilisateur sur l'écran de fin et lui impose une action pour reprendre la main. Le récap est de toute façon dans le journal.
- **Détecter l'exécution du jour et proposer « Reprendre »** : utile contre la clôture accidentelle, mais c'est une feature à part entière (requête + réhydratation au montage). La correction d'une clôture accidentelle passe déjà par l'éditeur de séance passée (journal).

## Conséquences

- `closedAt` disparaît de l'état de capture persisté ; le geste de clôture appelle `clearPersisted`.
- Le récap de fin n'est visible que dans la foulée immédiate de la clôture (état mémoire) et, ensuite, dans le journal.
- Une 2ᵉ exécution de la même séance le même jour reste possible (déjà le cas avant) ; elle se rattrape via l'édition de séance passée.
- **À ne pas confondre** : on retire la restauration de l'état *close*, jamais celle de l'état *en cours* (séance non clôturée), qui reste indispensable à l'offline (ne pas perdre les séries loggées sur un reload).
