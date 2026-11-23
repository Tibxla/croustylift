// PROTOTYPE JETABLE · socle E. BOUCHON de la sous-page Salle « fin-de-seance »,
// à remplir par un autre agent : récap de l'Exécution, durée chronométrée, BPM
// moyen optionnel (Stepper du kit, pas de clavier), Décompte de séries par
// muscle, puis Clôture.
//
// Données : useProto().seance.state (exercises, logged, skipped, elapsedMin…),
// helpers progressOf / totalSets dans seance.ts. Clôture :
//   seance.close(); nav.reset();   // la Salle revient au choix de la séance
// Retour à la séance sans clôturer : nav.back().
import { PrimaryButton, Screen, ScreenHeader } from './kit';
import { totalSets } from './seance';
import { useNav, useProto } from './shell';

export function SalleFin() {
  const nav = useNav();
  const { seance } = useProto();
  const s = seance.state;
  return (
    <Screen
      bottom={
        <PrimaryButton
          onClick={() => {
            seance.close();
            nav.reset();
          }}
        >
          Clôturer la séance
        </PrimaryButton>
      }
    >
      <ScreenHeader
        title="Fin de séance"
        meta={`${s.seanceName} · ${s.elapsedMin} min · ${totalSets(s)} séries`}
        back={{ label: 'Séance', onClick: nav.back }}
      />
    </Screen>
  );
}
