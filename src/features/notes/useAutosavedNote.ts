// Auto-enregistrement d'une note en Capture (décision 2026-07-29) : plus de
// bouton « Enregistrer la note » — le brouillon part TOUT SEUL. Debounce pendant
// la frappe, flush immédiat au blur et au démontage (changement d'exo — le
// panneau est key-é —, retour à la liste). Avant ce hook, le brouillon non
// enregistré était PERDU dans ces trois cas. L'écriture réelle reste au parent
// (outbox : upsert si corps réel, delete si vidé) ; ici on décide seulement
// QUAND pousser, et on ne pousse que si le contenu réel a bougé.
import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeNoteBody } from '../../domain/notes';

/**
 * La valeur venue du parent a changé SANS que ce champ l'ait enregistrée : faut-il
 * la reprendre dans le champ ? Oui si elle diffère de ce que le champ tient pour
 * enregistré, et seulement si rien n'y est en cours de saisie (le brouillon vaut
 * encore la dernière valeur enregistrée). Cas visé : une note écrite ailleurs,
 * adoptée par une réponse tardive de la base pendant que le panneau est ouvert ;
 * elle n'apparaissait qu'à sa réouverture. Une saisie en cours n'est jamais
 * remplacée : elle partira à son tour, et gagnera. Les corps se comparent
 * normalisés, comme à l'enregistrement. Pur.
 */
export function shouldAdoptIncomingNote(incoming: string, lastSaved: string, draft: string): boolean {
  const saved = normalizeNoteBody(lastSaved);
  return normalizeNoteBody(incoming) !== saved && normalizeNoteBody(draft) === saved;
}

/** Silence de frappe avant l'auto-save : court pour survivre à un reload en salle. */
const AUTOSAVE_DEBOUNCE_MS = 700;
/** Durée du feedback « enregistrée » avant de retomber. */
const SAVED_FEEDBACK_MS = 1600;

export function useAutosavedNote(
  initialValue: string,
  onSave: (body: string) => void,
  /**
   * `adoptIncoming` : reprendre dans le champ une valeur du parent qui change en
   * cours de vie (cf. `shouldAdoptIncomingNote`). Activé pour la NOTE DATÉE, dont
   * la valeur ne bouge que par la saisie ou par une adoption. Laissé éteint pour
   * la note d'instructions : sa valeur vient d'une copie de lecture qui se
   * revalide, et une lecture partie avant un enregistrement ne doit jamais
   * pouvoir ramener l'ancien texte dans le champ.
   */
  options: { adoptIncoming?: boolean } = {},
): {
  draft: string;
  /** Feedback transitoire « enregistrée » (retombe seul, jamais posé par le flush de démontage). */
  saved: boolean;
  handleChange: (value: string) => void;
  /** Pousse le brouillon immédiatement (blur, repli) ; no-op si rien n'a bougé. */
  flush: () => void;
} {
  const [draft, setDraft] = useState(initialValue);
  const [saved, setSaved] = useState(false);
  // Ce que le champ tient pour enregistré, en état (le rendu en a besoin, cf.
  // ci-dessous) ; `lastSavedRef` en est le miroir pour le flush de démontage.
  const [baseline, setBaseline] = useState(initialValue);

  // La valeur du parent change en cours de vie du champ (note adoptée par une
  // réponse tardive) : elle est reprise si rien n'est en cours de saisie. Ajusté
  // PENDANT le rendu (dérivation d'état sur un changement de prop), pas dans un
  // effet : aucun rendu intermédiaire avec l'ancienne valeur.
  const [seenValue, setSeenValue] = useState(initialValue);
  if (seenValue !== initialValue) {
    setSeenValue(initialValue);
    if (options.adoptIncoming === true && shouldAdoptIncomingNote(initialValue, baseline, draft)) {
      setDraft(initialValue);
      setBaseline(initialValue);
    }
  }

  // Refs : dernière valeur PERSISTÉE (n'écrire que si le contenu réel a bougé),
  // brouillon courant et onSave frais (le parent recrée sa lambda à chaque
  // render) — lisibles depuis le flush de démontage sans closure périmée.
  const lastSavedRef = useRef(initialValue);
  const draftRef = useRef(initialValue);
  const onSaveRef = useRef(onSave);
  // Synchronisé en EFFET (pas pendant le render, règle react-hooks/refs) : le
  // flush lit toujours le onSave du dernier render commité.
  useEffect(() => {
    onSaveRef.current = onSave;
  });
  // Miroirs du brouillon et de la valeur enregistrée, pour le flush (démontage
  // compris). Posés en effet : après une reprise ci-dessus, ils suivent l'état.
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    lastSavedRef.current = baseline;
  }, [baseline]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const flush = useCallback(() => {
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    // Corps NORMALISÉ (espaces de bord, \r\n) : resaver à l'identique ou ne
    // toucher que des espaces n'appelle ni l'outbox ni le réseau — même
    // sémantique que l'ancien `resolveExerciseNoteSave`. Un corps vidé EST un
    // changement (= suppression, tranchée par les ops d'outbox côté parent).
    const body = normalizeNoteBody(draftRef.current);
    if (body === normalizeNoteBody(lastSavedRef.current)) return;
    lastSavedRef.current = body;
    onSaveRef.current(body);
    if (!mountedRef.current) return; // flush de démontage : pas de feedback
    setBaseline(body);
    setSaved(true);
    if (savedTimerRef.current != null) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS);
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      draftRef.current = value;
      setDraft(value);
      setSaved(false);
      if (debounceRef.current != null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // Flush au DÉMONTAGE : le brouillon en cours part au lieu d'être perdu.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      flush();
      if (savedTimerRef.current != null) clearTimeout(savedTimerRef.current);
    };
  }, [flush]);

  return { draft, saved, handleChange, flush };
}
