// Clés de stockage de la Capture partagées entre modules qui ne peuvent pas
// s'importer l'un l'autre (`state.ts` importe `cache-eviction.ts`). Sans
// dépendance.

/** Préfixe des clés d'état de capture : `croustylift:capture:<séance>:<date>`. */
export const CAPTURE_STATE_PREFIX = 'croustylift:capture:';
