// Champ de saisie d'une note (texte libre, issue #26).
//
// Une note EST du texte : le ban du clavier OS (DESIGN.md) ne vise QUE les
// chiffres mesurés (poids, reps, RIR : règle et rangées de chiffres), pas la prose. Un <textarea>
// natif est donc légitime ici, comme le <input text> des noms d'exos.
//
// Rendu : la zone de texte du kit (src/ui/fields.tsx), un seul indicateur de
// focus, texte de 17 px. Aucun tiret long dans les libellés.
import { TextArea } from '../../ui';

interface NoteFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  /** Texte d'aide sous le label (le pourquoi de la note), optionnel. */
  hint?: string;
  /**
   * Masque visuellement le label (sr-only) quand le conteneur porte déjà le
   * titre (ex. carte repliable « Note de l'exercice ») — l'a11y le garde.
   */
  labelHidden?: boolean;
  /** Hauteur initiale en lignes (le champ reste redimensionnable verticalement). */
  rows?: number;
  /** Plafond de saisie : une note reste brève, pas un journal. */
  maxLength?: number;
  onChange: (value: string) => void;
  /** Perte de focus — utilisé pour flusher l'auto-enregistrement (décision 2026-07-29). */
  onBlur?: () => void;
}

export function NoteField({
  id,
  label,
  value,
  placeholder,
  hint,
  labelHidden = false,
  rows = 3,
  maxLength = 500,
  onChange,
  onBlur,
}: NoteFieldProps) {
  return (
    <TextArea
      id={id}
      label={label}
      hideLabel={labelHidden}
      hint={labelHidden ? undefined : hint}
      value={value}
      placeholder={placeholder}
      rows={rows}
      maxLength={maxLength}
      onChange={onChange}
      onBlur={onBlur}
    />
  );
}
