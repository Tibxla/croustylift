// Surface Réglages : une ligne par réglage, sans jargon.
//
// Couleur de signal : six prédéfinies bien distinctes, réparties sur le cercle
// des teintes (jaune par défaut), toutes à 5,9:1 au moins sur le fond et sur les
// feuilles. Plus « Autre couleur » : toutes les teintes et toutes les clartés,
// par deux règles sans clavier, en aplats (pas de dégradé), à l'intensité la plus
// forte que l'écran sait afficher (src/settings/signal-color.ts). Une couleur
// libre n'est jamais refusée : sous 4,5:1 sur le fond, une ligne discrète dit
// « Peu lisible sous les néons », sans chiffre ; l'utilisateur décide. Le choix
// s'applique en direct à toute l'app (`--sig` sur :root), l'aperçu au-dessus reste
// à l'écran pendant qu'on règle. Aucun chiffre technique à l'écran (ni ratio, ni
// degré).
//
// Réduire les animations : par défaut la préférence du système, un choix ici
// l'emporte (src/settings/reglages.ts).
//
// Pas de la règle : de 0,25 à 10 kg par 0,25, en une ligne. Il réglera la règle
// de poids de la Salle (refonte E, lot Capture) ; la Capture actuelle garde ses
// boutons + et − à pas fixe.
//
// Données : la sauvegarde de tout le compte dans un fichier (issue #8) et sa
// restauration (issue #35), deux boutons secondaires côte à côte. L'import
// upserte chaque ligne par son id, en une transaction : il ajoute et met à jour,
// ne supprime rien (features/export/import.ts).
//
// Compte : l'e-mail et la Déconnexion, gardée tant que des saisies attendent la
// synchro (ADR 0012) : l'option sûre est le bouton, la perte un lien discret.
// À propos : la version qui tourne (le déploiement est manuel, c'est ici qu'on la
// vérifie depuis le téléphone), la mise à jour si une attend, et le relevé
// d'affichage (diagnostic des barres basses de l'iPhone, aussi par un appui long
// sur la navigation).
import { useRef, useState, type ReactNode } from 'react';
import { PendingWritesError } from '../../auth/auth-context';
import { captureInProgress, requestReload, useUpdateReady } from '../../pwa/register';
import {
  effectiveReduceMotion,
  signalHex,
  signalName,
  STEP_INC,
  STEP_MAX,
  STEP_MIN,
  updateReglages,
  useReglages,
} from '../../settings/reglages';
import { CLARTE_DEFAUT, CLARTE_MAX, FREE_NAME, freeHex, HUE_MAX, HUE_STEP, readable, SIG_PRESETS } from '../../settings/signal-color';
import { Alert, Ruler, Screen, ScreenHeader, SecondaryButton, SectionTitle, Sign, Status, Stepper, Switch, TextLink } from '../../ui';
import { errorMessage } from '../../lib/error-message';
import { signOutRefusalLabel } from '../capture/sync-label';
import { downloadUserData, exportFilename } from '../export/data';
import { restoreFromFile } from '../export/data-import';
import { formatWeight } from '../capture/format';
import { APP_VERSION_LABEL } from '../../version';
import { openDiag } from '../../viewport/watch';
import { useSyncState } from '../../shell/useSyncState';
import { useOpenRefusedWrites } from '../../shell/refused-context';

export function ReglagesScreen({
  email,
  onSignOut,
}: {
  email: string | undefined;
  onSignOut: (options?: { force?: boolean }) => Promise<void>;
}) {
  return (
    <Screen>
      <ScreenHeader title="Réglages" />
      <SignalSection />
      <SalleSection />
      <DonneesSection />
      <CompteSection email={email} onSignOut={onSignOut} />
      <AboutSection />
      <div className="h-[calc(1.5rem+var(--safe-bottom))]" />
    </Screen>
  );
}

/* ------------------------------------------------------------------------ */
/* Couleur de signal                                                          */
/* ------------------------------------------------------------------------ */

function SignalSection() {
  const { signal } = useReglages();
  const free = signal.kind === 'free';
  // Dernière couleur libre réglée, gardée quand on repasse par une prédéfinie.
  const [free0, setFree0] = useState(signal.kind === 'free' ? { h: signal.h, l: signal.l } : { h: 96, l: CLARTE_DEFAUT });
  const pick = (f: { h: number; l: number }) => {
    setFree0(f);
    updateReglages({ signal: { kind: 'free', h: f.h, l: f.l } });
  };
  const freeColor = freeHex(free0.h, free0.l);
  const weak = !readable(freeColor);
  const current = signalHex(signal);

  return (
    <section aria-labelledby="reglages-signal">
      <SectionTitle id="reglages-signal" aside={signalName(signal)}>
        Couleur de signal
      </SectionTitle>
      <p className="px-5 text-[15px] leading-[1.45] text-muted">
        La seule couleur de l’app : l’aiguille de la règle et ce qui fait mieux que la Référence.
      </p>

      <SignalPreview />

      {/* On choisit au nom et à l'aperçu, sans chiffre. */}
      <div role="radiogroup" aria-label="Couleur de signal">
        {/* Sous 350 px, trois par ligne : six colonnes y laissaient 40 px par
            pastille et coupaient les noms (« Jau… »). */}
        <div className="mt-5 grid grid-cols-6 gap-x-2 px-5 max-[349px]:grid-cols-3 max-[349px]:gap-x-4 max-[349px]:gap-y-3">
          {SIG_PRESETS.map((p) => (
            <Swatch
              key={p.name}
              hex={p.hex}
              name={p.name}
              selected={!free && current === p.hex}
              onPick={() => updateReglages({ signal: { kind: 'preset', name: p.name } })}
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
          <span className={`flex-none rounded-block p-[3px] ${free ? 'outline-2 outline-solid outline-ink' : ''}`}>
            <span className="ui-swatch block h-9 w-[52px] rounded-[3px]" style={{ background: freeColor }} />
          </span>
          <span className={`min-w-0 flex-1 text-[16px] ${free ? 'font-semibold text-ink' : 'text-muted'}`}>{FREE_NAME}</span>
          <span className="flex-none text-[14px] text-faint">{free ? 'choisie' : 'toutes les teintes'}</span>
        </button>
      </div>

      {free && (
        <div className="mt-1">
          <FreeRuler label="Teinte">
            <Ruler
              label="Autre couleur, teinte"
              steps={free0.h / HUE_STEP}
              max={HUE_MAX / HUE_STEP}
              pxPerStep={9}
              isMajor={(s) => (s * HUE_STEP) % 30 === 0}
              isMid={() => true}
              tickColor={(s) => freeHex(s * HUE_STEP, free0.l)}
              needle="var(--color-ink)"
              height={44}
              format={(s) => `teinte ${s + 1} sur ${HUE_MAX / HUE_STEP + 1}`}
              onChange={(s) => pick({ ...free0, h: s * HUE_STEP })}
            />
          </FreeRuler>
          <FreeRuler label="Clarté" aside="sombre à gauche, clair à droite">
            <Ruler
              label="Autre couleur, clarté"
              steps={free0.l}
              max={CLARTE_MAX}
              pxPerStep={14}
              isMajor={(s) => s % 6 === 0}
              isMid={() => true}
              tickColor={(s) => freeHex(free0.h, s)}
              needle="var(--color-ink)"
              height={44}
              format={(s) => `clarté ${s + 1} sur ${CLARTE_MAX + 1}`}
              onChange={(s) => pick({ ...free0, l: s })}
            />
          </FreeRuler>
          {/* Jamais refusée : l'utilisateur décide. Une ligne, sans chiffre. */}
          <p role="status" className="min-h-[22px] px-5 pt-2 text-[14px] text-muted">
            {weak ? 'Peu lisible sous les néons.' : ''}
          </p>
        </div>
      )}
    </section>
  );
}

/** Une règle de la couleur libre, avec son nom au-dessus (une ligne). L'aiguille
 *  est blanc cassé : la règle porte elle-même les couleurs. */
function FreeRuler({ label, aside, children }: { label: string; aside?: string; children: ReactNode }) {
  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between px-5 pb-1.5">
        <span className="text-[15px] font-semibold text-ink">{label}</span>
        {aside && <span className="text-[13px] text-faint">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

/** Carré de couleur en aplat. Choisi : contour blanc cassé + nom en gras souligné
 *  (le mot « choisie » ne tiendrait pas en six colonnes). */
function Swatch({ hex, name, selected, onPick }: { hex: string; name: string; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={name} onClick={onPick} className="ui-press min-h-11 min-w-0 text-left">
      <span className={`block rounded-block p-[3px] ${selected ? 'outline-2 outline-solid outline-ink' : ''}`}>
        <span className="ui-swatch block h-9 rounded-[3px]" style={{ background: hex }} />
      </span>
      <span
        className={`mt-1.5 block truncate text-[14px] ${selected ? 'font-semibold text-ink underline decoration-2 underline-offset-[5px]' : 'text-muted'}`}
      >
        {name}
      </span>
    </button>
  );
}

/** Aperçu en direct : aiguille, série battue, extrait de courbe avec sa pente. */
function SignalPreview() {
  const ticks = Array.from({ length: 23 }, (_, i) => i - 11);
  const pts = [96, 95.6, 97.1, 98.0, 97.4, 99.3, 100.2, 101.5, 102.1];
  const x = (i: number) => 4 + (i / (pts.length - 1)) * 132;
  const y = (v: number) => 36 - ((v - 95) / 8) * 32;
  // Règle et courbe ont la même hauteur (40 px) : leurs statuts tombent sur la
  // même ligne. Sous 380 px, la courbe passe sous la règle, sans quoi « égalée »
  // chevauchait la pente.
  return (
    <div aria-hidden className="ui-note mx-5 mt-4 grid grid-cols-[1fr_auto] gap-x-5 gap-y-4 border-y border-line py-4 max-[379px]:grid-cols-1">
      <div className="min-w-0">
        <div className="relative h-[40px] overflow-hidden">
          {ticks.map((k) => (
            <span
              key={k}
              className={`absolute top-0 ${k % 4 === 0 ? 'bg-muted' : 'bg-dim'}`}
              style={{ left: `calc(50% + ${k * 10}px)`, width: k % 4 === 0 ? 2 : 1, height: k % 4 === 0 ? 24 : k % 2 === 0 ? 15 : 9 }}
            />
          ))}
          <span className="absolute left-1/2 top-0 h-[30px] w-[3px] -translate-x-1/2 bg-sig" />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
          <span className="tnum font-medium text-ink">82,5×8</span>
          <Status v="up" word="battue" />
          <span className="flex items-center gap-1 text-ink">
            <Sign v="eq" /> égalée
          </span>
        </div>
      </div>
      <div className="w-[140px]">
        <svg viewBox="0 0 140 40" className="block h-[40px] w-[140px]">
          <line x1="0" x2="140" y1="39.5" y2="39.5" stroke="var(--color-line)" />
          <path
            d={pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1]!)} r="3.5" fill="var(--color-ink)" />
        </svg>
        <div className="mt-2 text-[14px]">
          <Status v="up" word="+1,4 %/sem" className="whitespace-nowrap" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* En salle                                                                   */
/* ------------------------------------------------------------------------ */

function SalleSection() {
  const reglages = useReglages();
  const { stepKg } = reglages;
  return (
    <section>
      <SectionTitle>En salle</SectionTitle>
      <div className="ui-list border-t border-line">
        <Stepper
          label="Pas de la règle"
          value={stepKg}
          min={STEP_MIN}
          max={STEP_MAX}
          step={STEP_INC}
          format={(v) => `${formatWeight(v)} kg`}
          valueWidth={92}
          onChange={(v) => updateReglages({ stepKg: v })}
        />
        {/* Défaut : la préférence du système ; un choix ici l'emporte. */}
        <Switch
          label="Réduire les animations"
          checked={effectiveReduceMotion(reglages)}
          onChange={(v) => updateReglages({ reduceMotion: v })}
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Données                                                                    */
/* ------------------------------------------------------------------------ */

type DataStatus =
  | { phase: 'idle' }
  | { phase: 'busy'; what: 'export' | 'import' }
  | { phase: 'done'; message: string }
  | { phase: 'error'; message: string };

function DonneesSection() {
  const [status, setStatus] = useState<DataStatus>({ phase: 'idle' });
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = status.phase === 'busy';

  const exportData = async () => {
    setStatus({ phase: 'busy', what: 'export' });
    const filename = exportFilename();
    try {
      await downloadUserData();
      setStatus({ phase: 'done', message: `${filename} téléchargé. Range-le en lieu sûr.` });
    } catch (err) {
      setStatus({ phase: 'error', message: errorMessage(err) });
    }
  };

  const importData = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Réinitialisé pour que le même fichier puisse être choisi à nouveau.
    e.target.value = '';
    if (!file) return;
    setStatus({ phase: 'busy', what: 'import' });
    try {
      await restoreFromFile(file);
      setStatus({ phase: 'done', message: 'Données importées. Recharge l’app pour voir les changements.' });
    } catch (err) {
      setStatus({ phase: 'error', message: errorMessage(err) });
    }
  };

  return (
    <section>
      <SectionTitle>Données</SectionTitle>
      <RefusedEntry />
      <p className="px-5 text-[15px] leading-[1.45] text-muted">
        Tout ton historique dans un fichier : routines, séances, séries, notes, exos perso. L’import ajoute et met à
        jour, ne supprime rien.
      </p>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        onChange={(e) => void importData(e)}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />
      <div className="mt-3 flex gap-2 px-5">
        <SecondaryButton className="flex-1" ariaLabel="Exporter mes données" disabled={busy} onClick={() => void exportData()}>
          {status.phase === 'busy' && status.what === 'export' ? 'Export…' : 'Exporter'}
        </SecondaryButton>
        <SecondaryButton
          className="flex-1"
          ariaLabel="Importer un fichier de sauvegarde"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {status.phase === 'busy' && status.what === 'import' ? 'Import…' : 'Importer'}
        </SecondaryButton>
      </div>
      {status.phase === 'done' && (
        <p role="status" className="px-5 pt-2 text-[14px] text-muted">
          {status.message}
        </p>
      )}
      {status.phase === 'error' && (
        <Alert className="mx-5 mt-3">{status.message}</Alert>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Compte                                                                     */
/* ------------------------------------------------------------------------ */

type SignOutIssue = { kind: 'pending'; pending: number; refused: number } | { kind: 'error'; message: string };

/** Saisies refusées par le serveur : l'entrée vers leur écran, seulement s'il y en a. */
function RefusedEntry() {
  const { refused } = useSyncState();
  const open = useOpenRefusedWrites();
  if (refused === 0 || !open) return null;
  return (
    <div className="px-5 pb-4">
      <SecondaryButton className="w-full" meta={String(refused)} onClick={open}>
        {refused > 1 ? 'Saisies refusées' : 'Saisie refusée'}
      </SecondaryButton>
      <p className="mt-1.5 text-[14px] leading-[1.4] text-muted">
        Le serveur les a refusées : elles attendent sur cet appareil que tu les renvoies ou les abandonnes.
      </p>
    </div>
  );
}

function CompteSection({
  email,
  onSignOut,
}: {
  email: string | undefined;
  onSignOut: (options?: { force?: boolean }) => Promise<void>;
}) {
  // Déconnexion refusée (ADR 0012) : le choix explicite s'affiche sous le bouton,
  // revenir en ligne pour ne rien perdre, ou forcer en connaissance de cause.
  const [issue, setIssue] = useState<SignOutIssue | null>(null);
  const signOut = () => {
    void (async () => {
      try {
        await onSignOut();
      } catch (err) {
        if (err instanceof PendingWritesError) {
          setIssue({ kind: 'pending', pending: err.pending, refused: err.refused });
          return;
        }
        setIssue({ kind: 'error', message: errorMessage(err) });
      }
    })();
  };
  return (
    <section>
      <SectionTitle>Compte</SectionTitle>
      <div className="ui-list border-t border-line">
        <Line label="E-mail" value={email ?? 'sur cet appareil'} />
      </div>
      <div className="px-5 pt-3">
        {issue?.kind === 'pending' ? (
          <div role="alert" className="ui-note border-y border-line py-3">
            <p className="text-[15px] leading-[1.45] text-ink">{signOutRefusalLabel({ held: issue.pending, refused: issue.refused })}</p>
            {/* L'option sûre est le bouton ; la perte, un lien discret. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4">
              <SecondaryButton onClick={() => setIssue(null)}>Rester connecté</SecondaryButton>
              <TextLink
                tone="muted"
                onClick={() => {
                  // Forçage explicite (ADR 0012) : la seule porte de purge, la perte
                  // est nommée sur le lien.
                  setIssue(null);
                  void onSignOut({ force: true }).catch(() => {});
                }}
              >
                Me déconnecter et perdre ces saisies
              </TextLink>
            </div>
          </div>
        ) : (
          <>
            {issue?.kind === 'error' && (
              <div role="alert" className="ui-note mb-3 border-y border-line py-3">
                <p className="break-words text-[15px] leading-[1.45] text-ink">
                  <span className="font-semibold">Déconnexion impossible : </span>
                  {issue.message}
                </p>
                <TextLink tone="muted" onClick={() => setIssue(null)}>
                  Fermer
                </TextLink>
              </div>
            )}
            <SecondaryButton onClick={signOut}>Se déconnecter</SecondaryButton>
          </>
        )}
      </div>
    </section>
  );
}

/** Une ligne libellé · valeur. `whole` : la valeur ne se coupe jamais ; faute de
 *  place, elle passe sous le libellé (la version, à 320 px). */
function Line({ label, value, whole = false }: { label: string; value: ReactNode; whole?: boolean }) {
  return (
    <div className={`ui-row flex min-h-12 items-center justify-between gap-x-4 border-b border-line px-5 py-2.5 ${whole ? 'flex-wrap gap-y-0.5' : ''}`}>
      {/* Le libellé ne se coupe jamais (« E- / mail ») : c'est la valeur qui cède. */}
      <span className="flex-none whitespace-nowrap text-[16px] text-muted">{label}</span>
      <span className={`text-right text-[16px] text-ink ${whole ? 'whitespace-nowrap' : 'min-w-0 truncate'}`}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* À propos                                                                   */
/* ------------------------------------------------------------------------ */

function AboutSection() {
  const updateReady = useUpdateReady();
  const inSession = captureInProgress();
  return (
    <section>
      <SectionTitle>À propos</SectionTitle>
      <div className="ui-list border-t border-line">
        <Line label="Version" whole value={<span className="tnum">{APP_VERSION_LABEL}</span>} />
        {updateReady && (
          <div className="ui-row flex min-h-14 items-center justify-between gap-4 border-b border-line px-5 py-2">
            <span className="text-[16px] text-ink">{inSession ? 'Mise à jour prête, installée après ta séance' : 'Mise à jour prête'}</span>
            {!inSession && (
              <SecondaryButton size="sm" onClick={() => requestReload('manual', 'reglages')}>
                Mettre à jour
              </SecondaryButton>
            )}
          </div>
        )}
      </div>
      <div className="px-5 pt-1">
        <TextLink tone="muted" onClick={openDiag}>
          Relevé d’affichage
        </TextLink>
      </div>
    </section>
  );
}
