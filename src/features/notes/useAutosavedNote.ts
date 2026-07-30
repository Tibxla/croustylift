// Auto-enregistrement d'une note en Capture (décision 2026-07-29) : plus de
// bouton « Enregistrer la note » — le brouillon part TOUT SEUL. Debounce pendant
// la frappe, flush immédiat au blur et au démontage (changement d'exo — le
// panneau est key-é —, retour à la liste). Avant ce hook, le brouillon non
// enregistré était PERDU dans ces trois cas. L'écriture réelle reste au parent
// (outbox : upsert si corps réel, delete si vidé) ; ici on décide seulement
// QUAND pousser, et on ne pousse que si le contenu réel a bougé.
import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeNoteBody } from '../../domain/notes';

/** Silence de frappe avant l'auto-save : court pour survivre à un reload en salle. */
const AUTOSAVE_DEBOUNCE_MS = 700;
/** Durée du feedback « enregistrée » avant de retomber. */
const SAVED_FEEDBACK_MS = 1600;

export function useAutosavedNote(
  initialValue: string,
  onSave: (body: string) => void,
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
