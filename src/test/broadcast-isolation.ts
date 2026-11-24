// Préparation des tests (Vitest, `setupFiles`) : un `BroadcastChannel` PROPRE
// AU FICHIER DE TEST.
//
// Node fournit `BroadcastChannel`, partagé par tout le fil d'exécution. En
// `--pool=threads` (fil unique ou réutilisé), le canal des acquittements
// (lib/dated-read) qu'un fichier précédent avait ouvert restait ouvert, sur
// l'instance de ses modules à lui, et recevait les messages du fichier suivant :
// il agissait alors sur le stockage du fichier courant (sync-vues.test.ts
// échouait après reference-fraicheur.test.ts). Chaque fichier voit ici les
// canaux sous un nom préfixé par son propre jeton : deux instances de modules
// d'un même fichier (deux « onglets ») se parlent, jamais celles d'un fichier
// précédent.
const globals = globalThis as unknown as {
  BroadcastChannel?: typeof BroadcastChannel;
  __nativeBroadcastChannel?: typeof BroadcastChannel;
};

if (globals.BroadcastChannel) {
  globals.__nativeBroadcastChannel ??= globals.BroadcastChannel;
  const Native = globals.__nativeBroadcastChannel;
  const token = `fichier-${Math.random().toString(36).slice(2)}`;
  globals.BroadcastChannel = class extends Native {
    constructor(name: string) {
      super(`${token}:${name}`);
    }
  };
}
