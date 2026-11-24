// L'écran d'erreur d'une surface et sa sortie vers la Salle. Sans DOM (tests en
// Node) : la frontière est instanciée à la main, l'écran rendu en HTML statique,
// et le clic réel se vérifie au navigateur.
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary, RecoveryScreen } from './ErrorBoundary';
import type { SurfaceName } from './pwa/update';
import { leaveToSalle, salleExit } from './recovery-exit';
import { SurfaceNavigationContext } from './shell/navigation';

function screen(surface: SurfaceName, error = new Error('boom')): string {
  return renderToStaticMarkup(
    <SurfaceNavigationContext.Provider value={() => {}}>
      <RecoveryScreen error={error} surface={surface} onReset={() => {}} />
    </SurfaceNavigationContext.Provider>,
  );
}

/** Le clic sur la sortie (le geste que l'écran câble sur son bouton). */
function clickExit(surface: SurfaceName) {
  const goTo = vi.fn();
  const reset = vi.fn();
  leaveToSalle(surface, { goTo, reset });
  return { goTo, reset };
}

describe('sortie de secours vers la Salle', () => {
  it('depuis une autre surface : « Retour à la Salle » y va (la clé de la frontière change)', () => {
    expect(salleExit('analysis')).toEqual({ label: 'Retour à la Salle', remount: false });
    const { goTo, reset } = clickExit('seances');
    expect(goTo).toHaveBeenCalledWith('capture');
    expect(reset).not.toHaveBeenCalled();
    expect(screen('reglages')).toContain('Retour à la Salle');
  });

  it('depuis la Salle elle-même : « Réafficher la Salle » remonte la frontière au lieu d’un goTo sans effet', () => {
    expect(salleExit('capture')).toEqual({ label: 'Réafficher la Salle', remount: true });
    const { goTo, reset } = clickExit('capture');
    expect(reset).toHaveBeenCalledOnce();
    expect(goTo).not.toHaveBeenCalled();
    const html = screen('capture');
    expect(html).toContain('Réafficher la Salle');
    expect(html).not.toContain('Retour à la Salle');
  });

  it('la remise à zéro de la frontière rend à nouveau les enfants', () => {
    const child = <p>la Salle</p>;
    const boundary = new ErrorBoundary({ children: child, surface: 'capture' });
    // Pas de moteur de rendu : setState appliqué directement.
    boundary.setState = (patch) => Object.assign(boundary.state, patch);
    boundary.state = ErrorBoundary.getDerivedStateFromError(new Error('boom'));
    const fallback = boundary.render() as ReactElement<{ onReset: () => void; surface?: SurfaceName }>;
    expect(fallback.type).toBe(RecoveryScreen);
    expect(fallback.props.surface).toBe('capture');
    fallback.props.onReset();
    expect(boundary.render()).toBe(child);
  });

  it('le message technique de l’erreur, souvent en anglais, n’est pas à l’écran (il reste en console)', () => {
    const html = screen('analysis', new Error('Failed to fetch dynamically imported module: /assets/AnalysisScreen.js'));
    expect(html).not.toContain('Failed to fetch');
    expect(html).not.toContain('AnalysisScreen.js');
    expect(screen('capture', new Error('Cannot read properties of undefined'))).not.toContain('Cannot read');
  });
});
