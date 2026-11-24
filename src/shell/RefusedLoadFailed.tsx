// La feuille des saisies refusées n'a pas pu se charger (son fichier a quitté le
// précache après une mise à jour, ou le réseau manque) et la reprise protégée
// n'a pas rechargé la page (hors ligne, saisie en cours, déjà tenté). On le dit,
// avec deux reprises : réessayer le chargement, ou recharger l'app par les mêmes
// gardes que l'écran d'erreur (pwa/manual-reload.ts).
import { useState } from 'react';
import { manualReload } from '../pwa/register';
import type { ManualReloadVerdict } from '../pwa/manual-reload';
import { Alert, PrimaryButton, SecondaryButton, Sheet } from '../ui';

export function RefusedLoadFailed({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  const [refusal, setRefusal] = useState<Exclude<ManualReloadVerdict, 'reload'> | null>(null);
  return (
    <Sheet
      open
      title="Saisies refusées"
      onClose={onClose}
      footer={
        <>
          <PrimaryButton
            onClick={() => {
              const verdict = manualReload();
              if (verdict !== 'reload') setRefusal(verdict);
            }}
          >
            Recharger l’app
          </PrimaryButton>
          <SecondaryButton onClick={onRetry}>Réessayer</SecondaryButton>
        </>
      }
    >
      <div className="px-5 pb-2">
        <Alert>L’écran des saisies refusées n’a pas pu se charger : l’app a été mise à jour, ou le réseau manque. Tes saisies refusées restent sur l’appareil.</Alert>
        {refusal && (
          <Alert label="Pas de rechargement" className="mt-3">
            {refusal === 'unsaved'
              ? 'des saisies ne sont encore qu’en mémoire (le stockage de l’appareil est plein) : recharger les perdrait. Réessaie une fois le réseau revenu.'
              : 'un brouillon ou un enregistrement est en cours : recharger le perdrait. Termine-le, puis recharge.'}
          </Alert>
        )}
      </div>
    </Sheet>
  );
}
