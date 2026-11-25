// PROTOTYPE JETABLE · aiguillage de la Salle : sans variante choisie (ou hors
// build prototype), l'écran actuel tel quel ; sinon la variante. Et la barre de
// bascule (variante de la Salle + arrondi de toute l'app), montée une fois hors
// de l'app (main.tsx) : elle suit toutes les surfaces, connexion comprise.
import type { ReactNode } from 'react';
import { ARRONDIS, setArrondi, useArrondi, type ArrondiKey } from '../../../ui/arrondi';
import { PrototypeSwitcher } from '../../../ui/prototype-switcher';
import { PROTO, setVariant, useSaid, useVariant, VARIANTS, type VariantKey } from './variant';

export function ProtoGate({ render, children }: { render: (v: Exclude<VariantKey, 'actuel'>) => ReactNode; children: ReactNode }) {
  const v = useVariant();
  return <>{PROTO && v !== 'actuel' ? render(v) : children}</>;
}

export function ProtoBar() {
  const v = useVariant();
  const a = useArrondi();
  const said = useSaid();
  if (!PROTO) return null;
  return (
    <PrototypeSwitcher
      rows={[
        { label: 'Salle', options: VARIANTS, current: v, onChange: (k) => setVariant(k as VariantKey) },
        { label: 'Arrondi', options: ARRONDIS, current: a, onChange: (k) => setArrondi(k as ArrondiKey), shift: true },
      ]}
      message={said}
    />
  );
}
