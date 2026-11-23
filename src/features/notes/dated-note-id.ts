// Id DÉTERMINISTE d'une note datée NEUVE : UUID v5 (RFC 4122, SHA-1) de son
// couple (exécution, exercice). Deux appareils qui notent le même exo de la même
// exécution calculent le même id : leurs écritures convergent sur une ligne.
//
// Ce n'est pas l'identité de la note pour autant : une note écrite par un ancien
// client porte un id aléatoire. L'identité est le COUPLE, résolu à l'écriture et
// à l'effacement (`upsertDatedNote`, `deleteDatedNoteByCouple`, data.ts) ; cet id
// ne sert qu'à créer la ligne quand le couple n'en a pas encore.
//
// NE JAMAIS changer l'espace de noms ni la forme du nom : les ids déjà écrits
// en dépendent.

/** Espace de noms des notes datées de Croustylift (UUID fixe, tiré une fois). */
export const DATED_NOTE_NAMESPACE = '6f1d7c52-9a3e-4b8f-8d21-5c0e7a94b3d6';

/**
 * Id de la note datée d'un exo dans une exécution.
 * Nom haché : `<execution_id>:<exercise_id>`, les deux UUID en minuscules, forme
 * canonique à tirets, séparés par un deux-points, encodé en UTF-8 (ASCII ici).
 */
export function datedNoteId(executionId: string, exerciseId: string): string {
  return uuidV5(`${executionId.toLowerCase()}:${exerciseId.toLowerCase()}`, DATED_NOTE_NAMESPACE);
}

/** UUID v5 : SHA-1(octets de l'espace de noms ++ octets UTF-8 du nom), version et variante posées. */
export function uuidV5(name: string, namespace: string): string {
  const ns = namespace.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(ns)) throw new Error('Espace de noms UUID invalide.');
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(16 + nameBytes.length);
  for (let i = 0; i < 16; i++) input[i] = parseInt(ns.slice(i * 2, i * 2 + 2), 16);
  input.set(nameBytes, 16);

  const hash = sha1(input);
  hash[6] = (hash[6]! & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8]! & 0x3f) | 0x80; // variante RFC 4122
  const hex = Array.from(hash.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** SHA-1 synchrone (FIPS 180-4). `crypto.subtle` est asynchrone, l'id doit naître dans le geste. */
function sha1(message: Uint8Array): Uint8Array {
  const bitLength = message.length * 8;
  const padded = new Uint8Array(((message.length + 8) >> 6 << 6) + 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20 ? [(b & c) | (~b & d), 0x5a827999]
        : i < 40 ? [b ^ c ^ d, 0x6ed9eba1]
        : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
        : [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + f! + e + k! + w[i]!) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => outView.setUint32(i * 4, h >>> 0));
  return out;
}
