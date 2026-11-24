// Les cinq surfaces de la navigation, dans l'ordre, avec le mot qui les nomme.
//
// L'identifiant est celui de `SurfaceName` (pwa/update.ts), stable et stocké ; le
// libellé est ce que l'écran écrit. La surface de salle garde l'identifiant
// 'capture' (la règle « jamais de rechargement vers la Capture » et l'onglet
// mémorisé avant un rechargement en dépendent) et s'écrit « Salle ».
import type { SurfaceName } from '../pwa/update';

export const SURFACE_NAV: readonly { id: SurfaceName; label: string }[] = [
  { id: 'capture', label: 'Salle' },
  { id: 'analysis', label: 'Analyse' },
  { id: 'seances', label: 'Séances' },
  { id: 'exercises', label: 'Exos' },
  { id: 'reglages', label: 'Réglages' },
];
