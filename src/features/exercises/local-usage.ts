// Ce que l'appareil sait déjà de l'usage d'un exo dans les séances, sans
// réseau : les copies de lecture du plan que la Salle garde (version courante de
// chaque séance ouverte, et son template). Sert à prévenir avant de proposer la
// suppression d'un exo perso (« Il figure dans Push A : retire-le d'abord ») ;
// la garde de la base (deletion-guard, refus du serveur) reste le filet. Une
// séance jamais ouverte sur cet appareil n'y figure pas : l'absence ne prouve
// rien.
import { cachedKeys, peekFreshRead } from '../../lib/read-cache';
import { SEANCE_TEMPLATE_PREFIX, SEANCE_VERSION_IDS_PREFIX, SEANCE_VERSION_PREFIX } from '../capture/plan-copies';

export interface LocalTemplate {
  name: string;
  exerciseIds: readonly string[];
}

/** Les noms des séances dont le template contient l'exo, sans doublon, dans l'ordre. */
export function seancesUsing(exerciseId: string, templates: readonly LocalTemplate[]): string[] {
  const names: string[] = [];
  for (const t of templates) {
    if (t.exerciseIds.includes(exerciseId) && !names.includes(t.name)) names.push(t.name);
  }
  return names;
}

/** Les templates des versions COURANTES connues de l'appareil (jamais une version
 *  d'avant, jamais une copie que l'appareil sait périmée : un exo retiré d'une
 *  séance ici ne doit pas y être annoncé). */
export function localTemplates(): LocalTemplate[] {
  const out: LocalTemplate[] = [];
  for (const key of cachedKeys(SEANCE_VERSION_PREFIX)) {
    if (key.startsWith(SEANCE_VERSION_IDS_PREFIX)) continue;
    const seanceId = key.slice(SEANCE_VERSION_PREFIX.length);
    const versionId = peekFreshRead<string>(key);
    if (typeof versionId !== 'string') continue;
    const tpl = peekFreshRead<{ name?: unknown; exercises?: unknown }>(`${SEANCE_TEMPLATE_PREFIX}${versionId}:${seanceId}`);
    if (!tpl || typeof tpl.name !== 'string' || !Array.isArray(tpl.exercises)) continue;
    const exerciseIds = (tpl.exercises as { exerciseId?: unknown }[])
      .map((e) => e.exerciseId)
      .filter((id): id is string => typeof id === 'string');
    out.push({ name: tpl.name, exerciseIds });
  }
  return out;
}
