// Champ de saisie d'une note (texte libre, issue #26).
//
// Une note EST du texte : le ban du clavier OS (DESIGN.md) ne vise QUE les
// chiffres mesurés (poids/reps/RIR via Stepper), pas la prose. Un <textarea>
// natif est donc légitime ici, comme le <input text> des noms d'exos.
//
// Conventions DESIGN.md tenues : surface plate, bordure 1px, focus en accent
// (seule tache de couleur), encre pleine (pas de gris délavé), tap-target
// confortable. Aucun tiret long dans les libellés.
interface NoteFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  /** Texte d'aide sous le label (le pourquoi de la note), optionnel. */
  hint?: string;
  /** Hauteur initiale en lignes (le champ reste redimensionnable verticalement). */
  rows?: number;
  /** Plafond de saisie : une note reste brève, pas un journal. */
  maxLength?: number;
  onChange: (value: string) => void;
}

export function NoteField({
  id,
  label,
  value,
  placeholder,
  hint,
  rows = 3,
  maxLength = 500,
  onChange,
}: NoteFieldProps) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {hint && <span className="mb-1.5 block text-xs text-ink-muted">{hint}</span>}
      <textarea
        id={id}
        value={value}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded-xl border border-line bg-bg px-3 py-2.5 text-base leading-relaxed text-ink placeholder:text-ink-muted/85 focus:border-accent focus:outline-none"
      />
    </label>
  );
}
