// PROTOTYPE JETABLE · socle E « Signal », l'app entière.
//
// NAVIGATION (elle fait partie du design)
// Une ligne de cinq mots en haut de chaque écran : Salle · Analyse · Séances ·
// Exos · Réglages. Le mot actif est en gras souligné, les autres en gris.
// Pourquoi en haut : en salle on ne change presque jamais de surface, et le bas
// de l'écran (la zone du pouce) appartient en entier à l'action du moment
// (logger, exo suivant, sommaire). Pourquoi des mots : cinq surfaces tiennent
// en une ligne lisible sans icône à deviner, et rien ne se cache derrière un
// menu. Chaque surface garde sa pile de sous-pages ; retoucher le mot de la
// surface active la ramène à sa racine.
//
// Le contrat pour les surfaces (useNav, useProto, Pages) est dans shell.tsx,
// les primitives dans kit.tsx, l'état de la séance dans seance.ts.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SessionFixture } from '../fixtures';
import { Analyse } from './analyse';
import { Compte } from './compte';
import { Exercices } from './exercices';
import { BASE_CSS, SheetSlotContext, SIG_DEFAULT, SyncBanner, rootStyle } from './kit';
import { Reglages } from './reglages';
import { Salle } from './salle';
import { useSeanceStore } from './seance';
import { Seances } from './seances';
import {
  NavContext,
  ProtoContext,
  SURFACES,
  type Account,
  type Nav,
  type Proto,
  type Route,
  type Settings,
  type SurfaceId,
} from './shell';

export const name = 'Signal · app';

const SURFACE_VIEW: Record<SurfaceId, () => React.ReactNode> = {
  salle: () => <Salle />,
  analyse: () => <Analyse />,
  seances: () => <Seances />,
  exercices: () => <Exercices />,
  reglages: () => <Reglages />,
  compte: () => <Compte />,
};

const ROOT: Route = { page: 'index', params: {} };

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** `session` : signature commune des variantes du prototype ; la séance du
 *  socle vient de ../fixtures.ts via seance.ts. */
export function AppE(_props: { session?: SessionFixture }) {
  const [settings, setSettingsState] = useState<Settings>(() => ({
    sig: SIG_DEFAULT,
    sigName: 'Jaune',
    sigHue: null,
    stepKg: 1.25,
    reduceMotion: prefersReducedMotion(),
    rulerTapAnim: false,
  }));
  const [account, setAccountState] = useState<Account>({
    phase: 'connecte',
    email: 'thibaud@exemple.fr',
    pendingSync: 0,
    offline: false,
  });
  const store = useSeanceStore();

  // Hors ligne, chaque série loggée s'ajoute à l'outbox (bandeau de synchro).
  const seance = useMemo(
    () => ({
      ...store,
      log: () => {
        store.log();
        if (account.offline) setAccountState((a) => ({ ...a, pendingSync: a.pendingSync + 1 }));
      },
    }),
    [store, account.offline],
  );

  // Piles de navigation, une par surface.
  const [surface, setSurface] = useState<SurfaceId>('salle');
  const [stacks, setStacks] = useState<Record<SurfaceId, Route[]>>({
    salle: [ROOT],
    analyse: [ROOT],
    seances: [ROOT],
    exercices: [ROOT],
    reglages: [ROOT],
    compte: [ROOT],
  });
  const top = useRef<HTMLDivElement>(null);
  const shown: SurfaceId = account.phase === 'connecte' ? surface : 'compte';
  const stack = stacks[shown];
  const route = stack[stack.length - 1]!;

  // Changement de page : on remonte en haut (le cadre défile sur bureau, la page sur mobile).
  useLayoutEffect(() => {
    top.current?.scrollIntoView({ block: 'start' });
  }, [shown, stack.length, route]);

  const setStack = useCallback((s: SurfaceId, f: (r: Route[]) => Route[]) => setStacks((m) => ({ ...m, [s]: f(m[s]) })), []);

  const nav: Nav = useMemo(
    () => ({
      surface: shown,
      route,
      depth: stack.length - 1,
      go: (s, page, params) => {
        if (page) setStack(s, () => [ROOT, { page, params: params ?? {} }]);
        else if (s === shown) setStack(s, () => [ROOT]);
        setSurface(s === 'compte' ? surface : s);
      },
      push: (page, params) => setStack(shown, (r) => [...r, { page, params: params ?? {} }]),
      back: () => setStack(shown, (r) => (r.length > 1 ? r.slice(0, -1) : r)),
      reset: (page = 'index', params) => setStack(shown, () => (page === 'index' ? [ROOT] : [ROOT, { page, params: params ?? {} }])),
    }),
    [shown, route, stack.length, setStack, surface],
  );

  const proto: Proto = useMemo(
    () => ({
      settings,
      setSettings: (patch) => setSettingsState((s) => ({ ...s, ...patch })),
      account,
      setAccount: (patch) => setAccountState((a) => ({ ...a, ...patch })),
      seance,
    }),
    [settings, account, seance],
  );

  const [slot, setSlot] = useState<HTMLElement | null>(null);

  return (
    <div
      ref={top}
      data-e-root
      data-motion={settings.reduceMotion ? 'reduite' : 'normale'}
      className="flex min-h-full flex-1 flex-col bg-(--bg) text-(--ink) antialiased"
      style={rootStyle(settings.sig)}
    >
      <style>{BASE_CSS}</style>
      <ProtoContext.Provider value={proto}>
        <NavContext.Provider value={nav}>
          <SheetSlotContext.Provider value={slot}>
            {shown !== 'compte' && (
              <>
                <SurfaceNav current={shown} onSelect={(s) => nav.go(s)} />
                {/* Sur l'instrument, l'état de synchro tient dans le bouton Sommaire :
                    une ligne de plus pousserait la rangée RIR sous la barre du pouce. */}
                {!(shown === 'salle' && route.page === 'index' && store.state.phase === 'en-cours') && (
                  <SyncBanner pending={account.pendingSync} offline={account.offline} />
                )}
              </>
            )}
            <div className="flex flex-1 flex-col">{SURFACE_VIEW[shown]()}</div>
          </SheetSlotContext.Provider>
        </NavContext.Provider>
      </ProtoContext.Provider>
      {/* Emplacement des feuilles basses : collé en bas de la zone visible, dans
          la racine (les feuilles héritent des tokens et de --sig). */}
      <div ref={setSlot} className="sticky bottom-0 z-40 h-0" />
    </div>
  );
}

/** Les cinq surfaces en mots. 44 px de haut, le mot actif en gras souligné. */
function SurfaceNav({ current, onSelect }: { current: SurfaceId; onSelect: (s: SurfaceId) => void }) {
  return (
    <nav aria-label="Surfaces" className="flex h-12 flex-none items-center justify-between px-2">
      {SURFACES.map((s) => {
        const active = s.id === current;
        return (
          <button
            key={s.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect(s.id)}
            className={`h-11 px-[9px] text-[15px] ${
              active
                ? 'font-semibold text-(--ink) underline decoration-2 underline-offset-[7px]'
                : 'text-(--muted) active:text-(--ink)'
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
