// PROTOTYPE JETABLE · socle E. BOUCHON de la surface « Compte », à remplir par
// un autre agent : connexion, inscription, mot de passe oublié, premier
// lancement (nommer sa 1ʳᵉ routine et sa 1ʳᵉ séance).
//
// Le shell n'affiche cette surface (sans barre de navigation) que si
// account.phase vaut 'deconnecte' ou 'premier-lancement'. Pour entrer dans
// l'app : setAccount({ phase: 'connecte' }). Après une inscription :
// setAccount({ phase: 'premier-lancement' }) puis nav.reset('premier-lancement').
// Pages prévues : index (connexion), inscription, mot-de-passe, premier-lancement.
import { EmptyState, PrimaryButton, Screen, ScreenHeader, TextLink } from './kit';
import { Pages, useNav, useProto } from './shell';

export function Compte() {
  const { account } = useProto();
  return (
    <Pages
      pages={{
        index: () => (account.phase === 'premier-lancement' ? <Stub title="Premier lancement" /> : <Stub title="Connexion" />),
        inscription: () => <Stub title="Inscription" back />,
        'mot-de-passe': () => <Stub title="Mot de passe oublié" back />,
        'premier-lancement': () => <Stub title="Premier lancement" />,
      }}
    />
  );
}

function Stub({ title, back }: { title: string; back?: boolean }) {
  const nav = useNav();
  const { setAccount } = useProto();
  return (
    <Screen bottom={<PrimaryButton onClick={() => setAccount({ phase: 'connecte' })}>Entrer dans l'app</PrimaryButton>}>
      <div className="h-12" />
      <ScreenHeader title={title} back={back ? { label: 'Connexion', onClick: nav.back } : undefined} />
      <EmptyState
        title="Écran à construire"
        body="Bouchon du socle. Le bouton du bas rétablit la session locale."
        action={
          !back && (
            <div className="flex flex-col items-start">
              <TextLink onClick={() => nav.push('inscription')}>Créer un compte</TextLink>
              <TextLink onClick={() => nav.push('mot-de-passe')}>Mot de passe oublié</TextLink>
            </div>
          )
        }
      />
    </Screen>
  );
}
