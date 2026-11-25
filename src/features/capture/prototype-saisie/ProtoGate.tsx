// PROTOTYPE JETABLE · aiguillage de la Salle : sans variante choisie (ou hors
// build prototype), l'écran actuel tel quel ; sinon la variante. Et la barre de
// bascule, posée une fois sur la Salle (Sommaire compris).
import type { ReactNode } from 'react';
import { PrototypeSwitcher } from '../../../ui/prototype-switcher';
import { PROTO, setVariant, useSaid, useVariant, VARIANTS, type VariantKey } from './variant';

export function ProtoGate({ render, children }: { render: (v: Exclude<VariantKey, 'actuel'>) => ReactNode; children: ReactNode }) {
  const v = useVariant();
  return <>{PROTO && v !== 'actuel' ? render(v) : children}</>;
}

export function ProtoBar() {
  const v = useVariant();
  const said = useSaid();
  if (!PROTO) return null;
  return <PrototypeSwitcher variants={VARIANTS} current={v} onChange={(k) => setVariant(k as VariantKey)} message={said} />;
}
