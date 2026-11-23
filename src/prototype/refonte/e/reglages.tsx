// PROTOTYPE JETABLE · socle E, surface Réglages.
//
// Couleur de signal : 6 prédéfinies bien distinctes, réparties sur le cercle
// des teintes (jaune par défaut, rouge à la demande de l'utilisateur), toutes
// ≥ 5,8:1 sur le fond et sur les feuilles. Plus « Autre couleur » : toutes les
// teintes et toutes les clartés, par deux règles sans clavier, en aplats (pas de
// dégradé) : la teinte sur 360° et la clarté, du sombre au clair, à l'intensité
// la plus forte que le sRGB permet pour ce couple (donc ni gris ni tons éteints :
// un signal doit ressortir ; une 3e règle « intensité » les ouvrirait) (la chroma est réduite pour
// rester dans le gamut : jamais un canal écrêté, donc jamais une teinte qui
// dérive). Une couleur libre n'est jamais refusée : sous 4,5:1 sur le fond, une
// ligne discrète dit « peu lisible sous les néons », sans chiffre ; l'utilisateur
// décide. Le choix s'applique en direct à toute l'app par `--sig` (posé sur la
// racine du shell), l'aperçu au-dessus reste à l'écran pendant qu'on règle.
// Aucun chiffre technique à l'écran (ni ratio, ni degré).
//
// Autres réglages, ceux que l'app a ou devrait avoir : pas de la règle de
// poids (0,25 à 10 kg, l'app ne connaît que le kg), réduire les animations,
// export / import des données (l'import ajoute et met à jour, ne supprime
// rien), compte (déconnexion gardée si des saisies attendent la synchro, ADR
// 0012), à propos. Pas de lexique : l'app s'adresse à des pratiquants qui
// connaissent RIR, e1RM, Référence et bloc.
import { useState, type ReactNode } from 'react';
import { fmtKg } from './format';
import {
  Rule,
  Ruler,
  Screen,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  Sign,
  Status,
  Stepper,
  Switch,
  TextLink,
} from './kit';
import { useProto } from './shell';

/* ------------------------------------------------------------------------ */
/* Couleurs                                                                   */
/* ------------------------------------------------------------------------ */

/** Ratios WCAG sur le fond #100e0c / la feuille #1a1815 (calculés le 23/11). */
export const SIG_PRESETS: { name: string; hex: string }[] = [
  { name: 'Jaune', hex: '#f6d236' }, // 13,0 / 12,0
  { name: 'Rouge', hex: '#ff5d5d' }, //  6,4 /  5,9
  { name: 'Rose', hex: '#f27ad6' }, //  7,8 /  7,2
  { name: 'Violet', hex: '#b59cff' }, //  8,4 /  7,7
  { name: 'Ciel', hex: '#6cc0ff' }, //  9,7 /  9,0
  { name: 'Vert', hex: '#5ed68f' }, // 10,5 /  9,7
];

/** OKLCH vers sRGB linéaire (non borné : hors gamut si un canal sort de [0, 1]). */
function oklchToLinear(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** Chroma la plus forte qui reste dans le sRGB pour (L, h) : recherche par dichotomie. */
function maxChroma(L: number, h: number): number {
  let lo = 0;
  let hi = 0.37;
  for (let k = 0; k < 18; k++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear(L, mid, h))) lo = mid;
    else hi = mid;
  }
  return lo;
}

function linearToHex(lin: number[]): string {
  const enc = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  return '#' + lin.map((v) => Math.round(Math.min(1, Math.max(0, enc(v))) * 255).toString(16).padStart(2, '0')).join('');
}

/** Contraste WCAG entre deux couleurs #rrggbb. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Teinte libre, crans de 2° (180 crans). Clarté : 25 crans, L de 0,30 à 0,96. */
const HUE_STEP = 2;
export const CLARTE_MAX = 24;
const L_MIN = 0.3;
const L_MAX = 0.96;
const lightOf = (l: number) => L_MIN + ((L_MAX - L_MIN) * l) / CLARTE_MAX;
/** Clarté de départ : L ≈ 0,80, proche des prédéfinies. */
const CLARTE_DEFAUT = 18;

export function freeHex(h: number, l: number): string {
  const L = lightOf(l);
  return linearToHex(oklchToLinear(L, maxChroma(L, h), h));
}

/** Sous 4,5:1 sur le fond d'écran : « peu lisible sous les néons » (sans refuser). */
const BG = '#100e0c';
export const readable = (hex: string) => contrast(hex, BG) >= 4.5;

/* ------------------------------------------------------------------------ */
/* Page                                                                       */
/* ------------------------------------------------------------------------ */

export function Reglages() {
  return (
    <Screen>
      <ScreenHeader title="Réglages" />
      <SignalSection />
      <SalleSection />
      <DonneesSection />
      <CompteSection />
      <AboutSection />
      <PrototypeSection />
      <div className="h-(--pad-bottom)" />
    </Screen>
  );
}

/** Nom affiché d'une couleur libre : pas de degré, pas de chiffre. */
export const FREE_NAME = 'Autre couleur';

function SignalSection() {
  const { settings, setSettings } = useProto();
  const [free0, setFree0] = useState(settings.sigFree ?? { h: 96, l: CLARTE_DEFAUT });
  const free = settings.sigFree !== null;
  const pick = (f: { h: number; l: number }) => {
    setFree0(f);
    setSettings({ sig: freeHex(f.h, f.l), sigName: FREE_NAME, sigFree: f });
  };
  const freeColor = freeHex(free0.h, free0.l);
  const weak = !readable(freeColor);

  return (
    <section aria-labelledby="sig-title">
      <SectionTitle aside={settings.sigName}>
        <span id="sig-title">Couleur de signal</span>
      </SectionTitle>
      <p className="px-5 text-[15px] leading-[1.45] text-(--muted)">
        La seule couleur de l'app : l'aiguille de la règle et ce qui fait mieux que la Référence.
      </p>

      <SignalPreview />

      {/* On choisit au nom et à l'aperçu, sans chiffre. */}
      <div role="radiogroup" aria-label="Couleur de signal">
        <div className="mt-5 grid grid-cols-6 gap-x-2 px-5">
          {SIG_PRESETS.map((p) => (
            <Swatch
              key={p.name}
              hex={p.hex}
              name={p.name}
              selected={!free && settings.sig === p.hex}
              onPick={() => setSettings({ sig: p.hex, sigName: p.name, sigFree: null })}
            />
          ))}
        </div>
        <button
          type="button"
          role="radio"
          aria-checked={free}
          aria-label={`${FREE_NAME}${free && weak ? ', peu lisible sous les néons' : ''}`}
          onClick={() => pick(free0)}
          className="mx-5 mt-3 flex min-h-12 w-[calc(100%-40px)] items-center gap-3 text-left"
        >
          <span className="flex-none rounded-(--r) p-[3px]" style={{ outline: free ? '2px solid var(--ink)' : 'none' }}>
            <span className="block h-9 w-[52px] rounded-[3px]" style={{ background: freeColor }} />
          </span>
          <span className={`min-w-0 flex-1 text-[16px] ${free ? 'font-semibold text-(--ink)' : 'text-(--muted)'}`}>{FREE_NAME}</span>
          <span className="flex-none text-[14px] text-(--faint)">{free ? 'choisie' : 'toutes les teintes'}</span>
        </button>
      </div>

      {free && (
        <div className="mt-1">
          <FreeRuler
            label="Teinte"
            ruler={
              <Ruler
                label="Autre couleur, teinte"
                steps={free0.h / HUE_STEP}
                max={358 / HUE_STEP}
                pxPerStep={9}
                isMajor={(s) => (s * HUE_STEP) % 30 === 0}
                isMid={() => true}
                tickColor={(s) => freeHex(s * HUE_STEP, free0.l)}
                needle="var(--ink)"
                height={44}
                format={(s) => `teinte ${s + 1} sur ${358 / HUE_STEP + 1}`}
                onChange={(s) => pick({ ...free0, h: s * HUE_STEP })}
              />
            }
          />
          <FreeRuler
            label="Clarté"
            aside="sombre à gauche, clair à droite"
            ruler={
              <Ruler
                label="Autre couleur, clarté"
                steps={free0.l}
                max={CLARTE_MAX}
                pxPerStep={14}
                isMajor={(s) => s % 6 === 0}
                isMid={() => true}
                tickColor={(s) => freeHex(free0.h, s)}
                needle="var(--ink)"
                height={44}
                format={(s) => `clarté ${s + 1} sur ${CLARTE_MAX + 1}`}
                onChange={(s) => pick({ ...free0, l: s })}
              />
            }
          />
          {/* Jamais refusée : l'utilisateur décide. Une ligne, sans chiffre. */}
          <p role="status" className="min-h-[22px] px-5 pt-2 text-[14px] text-(--muted)">
            {weak ? 'Peu lisible sous les néons.' : ''}
          </p>
        </div>
      )}
    </section>
  );
}

/** Une règle de la couleur libre, avec son nom au-dessus (une ligne). */
function FreeRuler({ label, aside, ruler }: { label: string; aside?: string; ruler: ReactNode }) {
  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between px-5 pb-1.5">
        <span className="text-[15px] font-semibold text-(--ink)">{label}</span>
        {aside && <span className="text-[13px] text-(--faint)">{aside}</span>}
      </div>
      {ruler}
    </div>
  );
}

/** Carré de couleur en aplat. Choisi : contour blanc cassé + nom en gras souligné. */
function Swatch({ hex, name, selected, onPick }: { hex: string; name: string; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={name} onClick={onPick} className="e-press min-h-11 min-w-0 text-left">
      <span className="block rounded-(--r) p-[3px]" style={{ outline: selected ? '2px solid var(--ink)' : 'none' }}>
        <span className="block h-9 rounded-[3px]" style={{ background: hex }} />
      </span>
      {/* Choisie : contour + nom en gras (le mot « choisie » ne tiendrait pas en six colonnes). */}
      <span className={`mt-1.5 block truncate text-[14px] ${selected ? 'font-semibold text-(--ink) underline decoration-2 underline-offset-[5px]' : 'text-(--muted)'}`}>{name}</span>
    </button>
  );
}

/** Aperçu en direct : aiguille, série battue, extrait de courbe avec sa pente. */
function SignalPreview() {
  const ticks = Array.from({ length: 23 }, (_, i) => i - 11);
  const pts = [96, 95.6, 97.1, 98.0, 97.4, 99.3, 100.2, 101.5, 102.1];
  const x = (i: number) => 4 + (i / (pts.length - 1)) * 132;
  const y = (v: number) => 46 - ((v - 95) / 8) * 40;
  return (
    <div aria-hidden className="mx-5 mt-4 grid grid-cols-[1fr_auto] gap-x-5 border-y border-(--line) py-4">
      <div className="min-w-0">
        <div className="relative h-[40px] overflow-hidden">
          {ticks.map((k) => (
            <span
              key={k}
              className={`absolute top-0 ${k % 4 === 0 ? 'bg-(--muted)' : 'bg-(--dim)'}`}
              style={{ left: `calc(50% + ${k * 10}px)`, width: k % 4 === 0 ? 2 : 1, height: k % 4 === 0 ? 24 : k % 2 === 0 ? 15 : 9 }}
            />
          ))}
          <span className="absolute left-1/2 top-0 h-[30px] w-[3px] -translate-x-1/2 bg-(--sig)" />
        </div>
        <div className="mt-2 flex items-center gap-3 text-[14px]">
          <span className="font-medium text-(--ink)">82,5×8</span>
          <Status v="up" word="battue" />
          <span className="flex items-center gap-1 text-(--ink)">
            <Sign v="eq" /> égalée
          </span>
        </div>
      </div>
      <div className="w-[140px]">
        <svg viewBox="0 0 140 50" className="block h-[50px] w-[140px]">
          <line x1="0" x2="140" y1="49.5" y2="49.5" stroke="var(--line)" />
          <path
            d={pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
            fill="none"
            stroke="var(--ink)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1]!)} r="3.5" fill="var(--ink)" />
        </svg>
        <div className="mt-1.5 text-[14px]">
          <Status v="up" word="+1,4 %/sem" />
        </div>
      </div>
    </div>
  );
}

function SalleSection() {
  const { settings, setSettings } = useProto();
  return (
    <section>
      <SectionTitle>En salle</SectionTitle>
      <div className="border-t border-(--line)">
        <Stepper
          label="Pas de la règle"
          value={settings.stepKg}
          min={0.25}
          max={10}
          step={0.25}
          format={(v) => `${fmtKg(v)} kg`}
          valueWidth={84}
          onChange={(v) => setSettings({ stepKg: v })}
        />
        <Switch
          label="Réduire les animations"
          checked={settings.reduceMotion}
          onChange={(v) => setSettings({ reduceMotion: v })}
        />
      </div>
    </section>
  );
}

function DonneesSection() {
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  return (
    <section>
      <SectionTitle>Données</SectionTitle>
      <p className="px-5 text-[15px] leading-[1.45] text-(--muted)">
        Tout ton historique dans un fichier : séances, séries, notes, exos perso. L'import ajoute et met à jour, ne supprime rien.
      </p>
      <div className="mt-3 flex gap-2 px-5">
        <SecondaryButton className="flex-1" ariaLabel="Exporter mes données" onClick={() => { setImportMsg(null); setExportMsg('Fichier téléchargé : croustylift-2026-11-23'); }}>
          Exporter
        </SecondaryButton>
        <SecondaryButton className="flex-1" ariaLabel="Importer un fichier" onClick={() => { setExportMsg(null); setImportMsg('Sélecteur de fichier : non branché dans le prototype'); }}>
          Importer
        </SecondaryButton>
      </div>
      {(exportMsg || importMsg) && (
        <p role="status" className="px-5 pt-2 text-[14px] text-(--muted)">
          {importMsg ?? exportMsg}
        </p>
      )}
    </section>
  );
}

function CompteSection() {
  const { account, setAccount } = useProto();
  const [guard, setGuard] = useState(false);
  const n = account.pendingSync;
  const signOut = () => {
    if (n > 0) setGuard(true);
    else setAccount({ phase: 'deconnecte' });
  };
  return (
    <section>
      <SectionTitle>Compte</SectionTitle>
      <div className="border-t border-(--line)">
        <Line label="E-mail" value={account.email} />
        <Line label="Envoi" value={n === 0 ? 'tout est envoyé' : `${n} saisie${n > 1 ? 's' : ''} en attente`} />
      </div>
      <div className="px-5 pt-3">
        {guard && n > 0 ? (
          <div role="alert" className="border-l-[3px] border-(--ink) pl-3">
            <p className="text-[15px] leading-[1.45] text-(--ink)">
              {n} saisie{n > 1 ? 's' : ''} pas encore synchronisée{n > 1 ? 's' : ''}. Se déconnecter les efface de cet appareil. Reviens en
              ligne pour te déconnecter sans rien perdre.
            </p>
            {/* L'option sûre est le bouton ; la perte, un lien discret. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4">
              <SecondaryButton onClick={() => setGuard(false)}>Rester connecté</SecondaryButton>
              <TextLink
                tone="muted"
                onClick={() => {
                  setGuard(false);
                  setAccount({ phase: 'deconnecte', pendingSync: 0 });
                }}
              >
                Me déconnecter et perdre ces saisies
              </TextLink>
            </div>
          </div>
        ) : (
          <SecondaryButton onClick={signOut}>Se déconnecter</SecondaryButton>
        )}
      </div>
    </section>
  );
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-(--line) px-5 py-2.5">
      <span className="text-[16px] text-(--muted)">{label}</span>
      <span className="min-w-0 truncate text-right text-[16px] text-(--ink)">{value}</span>
    </div>
  );
}

function AboutSection() {
  return (
    <section>
      <SectionTitle>À propos</SectionTitle>
      <div className="border-t border-(--line)">
        <Line label="Version" value="0.9.0" />
        <Line label="Sans réseau" value="tout marche, envoi au retour" />
      </div>
    </section>
  );
}

/** Commandes du prototype (simuler le réseau, comparer la règle animée ou non).
 *  Absentes de l'app réelle. */
function PrototypeSection() {
  const { account, setAccount, settings, setSettings, seance } = useProto();
  return (
    <section className="mt-6">
      <Rule strong />
      <SectionTitle aside="absent de l'app">Commandes du prototype</SectionTitle>
      <div className="border-t border-(--line)">
        <Switch
          label="Simuler hors ligne"
          meta="chaque série loggée attend la synchro"
          checked={account.offline}
          onChange={(v) => setAccount({ offline: v, pendingSync: v ? account.pendingSync : 0 })}
        />
        <Stepper
          label="Saisies en attente"
          value={account.pendingSync}
          min={0}
          max={20}
          onChange={(v) => setAccount({ pendingSync: v })}
        />
        <Switch
          label="Séance d’hier non rangée"
          meta="la Salle s’ouvre après minuit sur l’Upper A du 22 nov."
          checked={seance.state.stale}
          onChange={seance.setStale}
        />
        <Switch
          label="Règle animée au toucher"
          meta={
            settings.reduceMotion
              ? 'sans effet : Réduire les animations est activé'
              : 'Oui : glisse jusqu’au cran touché · Non : saut sec'
          }
          checked={settings.rulerTapAnim}
          onChange={(v) => setSettings({ rulerTapAnim: v })}
        />
      </div>
    </section>
  );
}
