// PROTOTYPE JETABLE · socle E, surface Réglages.
//
// Couleur de signal : 7 prédéfinies sobres (ni violet, ni rouge d'alarme),
// toutes ≥ 9:1 sur le fond, plus une teinte libre réglée sans clavier sur une
// règle de teintes OKLCH à luminance 0,78 et chroma 0,11 fixées : ce couple
// reste dans le gamut sRGB sur les 360 teintes et garde ≥ 8,4:1 sur le fond
// des feuilles (#1a1815), donc ≥ 9:1 sur le fond d'écran (calcul hors app,
// scratchpad/proto/E3/scan.mjs). Le choix s'applique en direct à toute l'app
// par `--sig` (posé sur la racine du shell).
//
// Autres réglages, ceux que l'app a ou devrait avoir : pas de la règle de
// poids (1,25 ou 2,5 kg, l'app ne connaît que le kg), réduire les animations,
// export / import des données, compte (déconnexion gardée si des saisies
// attendent la synchro, ADR 0012), à propos.
import { useState, type ReactNode } from 'react';
import { fmt1, fmtKg } from './format';
import {
  Choice,
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

/** Ratios WCAG calculés sur le fond #100e0c (et ≥ 8,5:1 sur la feuille #1a1815). */
export const SIG_PRESETS: { name: string; hex: string }[] = [
  { name: 'Jaune', hex: '#f6d236' },
  { name: 'Ambre', hex: '#ffa94d' },
  { name: 'Lime', hex: '#c3e04e' },
  { name: 'Vert', hex: '#5ed68f' },
  { name: 'Turquoise', hex: '#44d1c6' },
  { name: 'Ciel', hex: '#6cc0ff' },
  { name: 'Rose', hex: '#ff94b4' },
];

const FREE_L = 0.78;
const FREE_C = 0.11;
const BG = '#100e0c';

function oklchToHex(L: number, C: number, h: number): string {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const enc = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  return '#' + lin.map((v) => Math.round(Math.min(1, Math.max(0, enc(v))) * 255).toString(16).padStart(2, '0')).join('');
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const fmtRatio = (hex: string) => `${fmt1(contrast(hex, BG))}:1`;

/** Teinte libre, crans de 2°. */
const HUE_STEP = 2;
const freeHex = (hue: number) => oklchToHex(FREE_L, FREE_C, hue);

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

function SignalSection() {
  const { settings, setSettings } = useProto();
  const [hue, setHue] = useState(settings.sigHue ?? 96);
  const free = settings.sigHue !== null;
  const pickHue = (h: number) => {
    setHue(h);
    setSettings({ sig: freeHex(h), sigName: `Teinte libre ${h}°`, sigHue: h });
  };

  return (
    <section aria-labelledby="sig-title">
      <SectionTitle aside={`${settings.sigName} · ${fmtRatio(settings.sig)}`}>
        <span id="sig-title">Couleur de signal</span>
      </SectionTitle>
      <p className="px-5 text-[15px] leading-[1.45] text-(--muted)">
        La seule couleur de l'app. Elle marque l'aiguille de la règle et ce qui fait mieux que la dernière fois, rien d'autre.
      </p>

      <SignalPreview />

      <div role="radiogroup" aria-label="Couleur de signal" className="mt-5 grid grid-cols-4 gap-x-3 gap-y-4 px-5">
        {SIG_PRESETS.map((p) => (
          <Swatch
            key={p.name}
            hex={p.hex}
            name={p.name}
            meta={fmtRatio(p.hex)}
            selected={!free && settings.sig === p.hex}
            onPick={() => setSettings({ sig: p.hex, sigName: p.name, sigHue: null })}
          />
        ))}
        <Swatch hex={freeHex(hue)} name="Libre" meta={`${hue}°`} selected={free} onPick={() => pickHue(hue)} />
      </div>

      <div className="mt-6 flex items-baseline justify-between px-5">
        <span className="text-[15px] font-semibold text-(--ink)">Teinte libre</span>
        <span className="text-[14px] text-(--muted)">
          {hue}° · {fmtRatio(freeHex(hue))}
        </span>
      </div>
      <p className="mt-0.5 px-5 text-[14px] text-(--faint)">Glisse la règle : luminance et contraste restent fixes.</p>
      <div className="mt-2">
        <Ruler
          label="Teinte libre"
          steps={Math.round(hue / HUE_STEP)}
          max={358 / HUE_STEP}
          pxPerStep={9}
          isMajor={(s) => (s * HUE_STEP) % 30 === 0}
          isMid={() => true}
          majorLabel={(s) => `${s * HUE_STEP}°`}
          tickColor={(s) => freeHex(s * HUE_STEP)}
          needle="var(--ink)"
          format={(s) => `${s * HUE_STEP} degrés`}
          onChange={(s) => pickHue(s * HUE_STEP)}
        />
      </div>
    </section>
  );
}

/** Carré de couleur en aplat. Choisi : contour blanc cassé + nom en gras + « choisie ». */
function Swatch({ hex, name, meta, selected, onPick }: { hex: string; name: string; meta: string; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={`${name}, contraste ${meta}`} onClick={onPick} className="min-h-11 text-left">
      <span className="block rounded-(--r) p-[3px]" style={{ outline: selected ? '2px solid var(--ink)' : 'none' }}>
        <span className="block h-9 rounded-[3px]" style={{ background: hex }} />
      </span>
      <span className={`mt-1.5 block text-[15px] ${selected ? 'font-semibold text-(--ink)' : 'text-(--muted)'}`}>{name}</span>
      <span className="block text-[13px] text-(--faint)">{selected ? 'choisie' : meta}</span>
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
          <Status v="up" word="+1,4 %/sem." />
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
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-(--line) py-1.5 pl-5 pr-2.5">
          <span className="min-w-0">
            <span className="block text-[17px] font-medium text-(--ink)">Pas de la règle</span>
            <span className="block text-[14px] text-(--muted)">un cran de la règle de poids</span>
          </span>
          <Choice
            label="Pas de la règle"
            value={settings.stepKg}
            onChange={(v) => setSettings({ stepKg: v })}
            options={[
              { value: 1.25, label: '1,25 kg' },
              { value: 2.5, label: '2,5 kg' },
              { value: 5, label: '5 kg' },
            ]}
          />
        </div>
        {/* Pas libre : ta salle a des disques de 0,5 kg, des haltères de 2 en 2… */}
        <Stepper
          label="Pas libre"
          meta="par 0,25 kg, de 0,25 à 10 kg"
          value={settings.stepKg}
          min={0.25}
          max={10}
          step={0.25}
          format={(v) => `${fmtKg(v)} kg`}
          onChange={(v) => setSettings({ stepKg: v })}
        />
        <Switch
          label="Réduire les animations"
          meta="la règle et les feuilles bougent sans transition"
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
        Tout ton historique dans un fichier JSON : séances, séries, notes, exercices perso.
      </p>
      <div className="mt-3 flex flex-col gap-2 px-5">
        <SecondaryButton onClick={() => setExportMsg('croustylift-2026-11-23.json téléchargé')} meta="JSON">
          Exporter mes données
        </SecondaryButton>
        {exportMsg && (
          <p role="status" className="text-[14px] text-(--muted)">
            {exportMsg}
          </p>
        )}
        <SecondaryButton onClick={() => setImportMsg("Sélecteur de fichier : non branché dans le prototype")}>
          Importer un fichier
        </SecondaryButton>
        {importMsg && (
          <p role="status" className="text-[14px] text-(--muted)">
            {importMsg}
          </p>
        )}
      </div>
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
        <Line label="Synchro" value={n === 0 ? 'tout est envoyé' : `${n} saisie${n > 1 ? 's' : ''} en attente`} />
      </div>
      <div className="px-5 pt-3">
        {guard && n > 0 ? (
          <div role="alert" className="border-l-[3px] border-(--ink) pl-3">
            <p className="text-[15px] leading-[1.45] text-(--ink)">
              {n} saisie{n > 1 ? 's' : ''} pas encore synchronisée{n > 1 ? 's' : ''}. Se déconnecter les efface de cet appareil. Reviens en
              ligne pour te déconnecter sans rien perdre.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4">
              <SecondaryButton onClick={() => setGuard(false)}>Rester connecté</SecondaryButton>
              <TextLink
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
          <TextLink onClick={signOut}>Se déconnecter</TextLink>
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
        <Line label="Version" value="0.9.0 · prototype Signal" />
        <Line label="Formule e1RM" value="Epley, RIR compté en reps" />
        <Line label="Hors ligne" value="saisie complète, envoi au retour" />
      </div>
    </section>
  );
}

/** Commandes du prototype (simuler le réseau). Absentes de l'app réelle. */
function PrototypeSection() {
  const { account, setAccount } = useProto();
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
      </div>
    </section>
  );
}
