// PROTOTYPE JETABLE · refonte visuelle (branche prototype/refonte-visuelle).
// Question : « À quoi doit ressembler Croustylift, en salle et au calme, sans
// slop d'IA ? » Trois variantes structurellement différentes, même données
// fabriquées (fixtures.ts), aucune écriture : tout l'état vit en mémoire.
// Lancer : npm run dev, puis /prototype-refonte.html?variant=A (B, C).
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { session } from './fixtures';
import { PrototypeSwitcher } from './PrototypeSwitcher';
import { VariantA, name as nameA } from './VariantA';
// VariantB et VariantC : 1er tour, gardées pour mémoire hors bascule.

import { VariantD, name as nameD } from './VariantD';
// E : depuis le 3ᵉ tour, socle de l'app entière (e/App.tsx). Les VariantE*.tsx
// restent en fichiers pour mémoire mais ne sont plus servis.
import { AppE as VariantE, name as nameE } from './e/App';
import { VariantF, name as nameF } from './VariantF';

const VARIANTS = [
  // 2ᵉ tour : l'utilisateur garde la structure de A (roulette, zéro clavier),
  // rejette son style violet. D, E, F = A rhabillée. B et C restent hors bascule
  // (fichiers gardés pour mémoire, ?variant=B ou C ne les sert plus).
  { key: 'A', name: nameA, C: VariantA },
  { key: 'D', name: nameD, C: VariantD },
  { key: 'E', name: nameE, C: VariantE },
  { key: 'F', name: nameF, C: VariantF },
];

function readVariant(): string {
  const v = new URLSearchParams(window.location.search).get('variant')?.toUpperCase();
  return VARIANTS.some((x) => x.key === v) ? (v as string) : 'A';
}

function Prototype() {
  const [variant, setVariant] = useState(readVariant);
  const change = (key: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('variant', key);
    window.history.replaceState(null, '', url);
    setVariant(key);
    console.info('[proto] variante', key);
  };
  const Current = VARIANTS.find((v) => v.key === variant)?.C ?? VariantA;
  return (
    <>
      {/* Cadre téléphone sur grand écran, plein écran sur mobile. La clé remonte
          la variante à zéro à chaque bascule. */}
      <div className="relative mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-bg sm:my-6 sm:h-[860px] sm:min-h-0 sm:overflow-y-auto sm:rounded-[28px] sm:outline sm:outline-1 sm:outline-white/10">
        <Current key={variant} session={session} />
      </div>
      <PrototypeSwitcher variants={VARIANTS} current={variant} onChange={change} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Prototype />
  </StrictMode>,
);
