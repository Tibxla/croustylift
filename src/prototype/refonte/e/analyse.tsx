// PROTOTYPE JETABLE · socle E. BOUCHON de la surface « Analyse », à remplir par un
// autre agent. Lecture de la progression au calme : courbe e1RM par exo, pente, record, journal des exécutions, comparaison de blocs. Le graphe de E est dans ../VariantE-analyse.tsx.
//
// Contrat (voir shell.tsx et kit.tsx) :
//   - la surface exporte un composant sans props, monté par App.tsx ;
//   - ses sous-pages se déclarent ici avec <Pages pages={{ index, ... }} /> ;
//   - useNav() pour push / back / go, useProto() pour l'état partagé ;
//   - mise en page : <Screen bottom={...}> + <ScreenHeader>, primitives du kit,
//     jamais de couleur en dur (tokens --bg, --ink, --muted, --faint, --line, --sig).
import { EmptyState, Screen, ScreenHeader, TextLink } from './kit';
import { Pages, useNav } from './shell';

export function Analyse() {
  return (
    <Pages
      pages={{
        index: () => <Index />,
        exemple: (p) => <Exemple from={p.from ?? ''} />,
      }}
    />
  );
}

function Index() {
  const nav = useNav();
  return (
    <Screen>
      <ScreenHeader title="Analyse" />
      <EmptyState
        title="Surface à construire"
        body="Bouchon du socle. Le lien ci-dessous montre une sous-page et son retour."
        action={<TextLink onClick={() => nav.push('exemple', { from: 'Analyse' })}>Ouvrir une sous-page</TextLink>}
      />
    </Screen>
  );
}

function Exemple({ from }: { from: string }) {
  const nav = useNav();
  return (
    <Screen>
      <ScreenHeader title="Sous-page" back={{ label: from, onClick: nav.back }} />
    </Screen>
  );
}
