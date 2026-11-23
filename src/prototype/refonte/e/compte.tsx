// PROTOTYPE JETABLE · socle E, surface Compte (d'après LoginScreen.tsx,
// AuthShell.tsx, ForgotPasswordScreen.tsx, ResetPasswordScreen.tsx et
// FirstLaunchScreen.tsx de l'app). Affichée par le shell, sans barre de
// navigation, quand account.phase vaut 'deconnecte' ou 'premier-lancement'.
//
// Pages :
//   index                connexion (ou premier lancement si phase le dit) ;
//   inscription          créer un compte ;
//   verifier             l'e-mail d'activation est parti ;
//   mot-de-passe         mot de passe oublié, puis « lien envoyé » ;
//   nouveau-mot-de-passe arrivée par le lien de l'e-mail ;
//   premier-lancement    nommer sa routine et sa première séance, partir du
//                        modèle (4 exos de base prescrits) ou d'une séance vierge.
//
// Pas de marque à halo, pas de slogan, pas de pied « OFFLINE-FIRST · CHIFFRÉ » :
// un titre d'écran comme partout ailleurs, des champs, l'action en bas.
// Erreurs : une phrase sous le champ fautif, sur un trait blanc cassé.
//
// Hors ligne (ADR 0012) : la Connexion exige le réseau ; une Session locale
// reconnue ouvre l'app sans serveur. Dans le prototype, l'écran de connexion
// montre l'un ou l'autre selon ses commandes (en bas, absentes de l'app) :
// simuler hors ligne, session locale sur l'appareil, saisies en attente d'un
// compte dont la session a été retirée (seule porte de purge : changer de compte).
//
// Règles du prototype : un mot de passe de moins de 8 caractères est refusé
// (« E-mail ou mot de passe incorrect ») pour montrer l'erreur du serveur.
import { useState, useSyncExternalStore } from "react";
import {
  ImplicitSubmit,
  Notice,
  PasswordField,
  RadioMark,
  TextField,
  FieldError,
} from "./exercices-champs";
import { range } from "./format";
import {
  PrimaryButton,
  Rule,
  Screen,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  Stepper,
  Switch,
  TextLink,
} from "./kit";
import { Pages, useNav, useProto } from "./shell";

export function Compte() {
  const { account } = useProto();
  // Monté = on vient d'arriver ici, donc d'une Déconnexion (qui retire la
  // Session locale) ou d'un premier lancement : l'appareil ne connaît personne.
  useState(() => setDevice({ localSession: false }));
  // Chiffres tabulaires coupés ici : ils espacent les traits d'union (« E-mail »).
  return (
    <div className="flex flex-1 flex-col [font-variant-numeric:normal]">
      <Pages
        pages={{
          index: () =>
            account.phase === "premier-lancement" ? (
              <PremierLancement />
            ) : (
              <Connexion />
            ),
          inscription: () => <Inscription />,
          verifier: (p) => <Verifier email={p.email ?? ""} />,
          "mot-de-passe": (p) => <MotDePasseOublie email={p.email ?? ""} />,
          "nouveau-mot-de-passe": () => <NouveauMotDePasse />,
          "premier-lancement": () => <PremierLancement />,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* État de l'appareil (commandes du prototype)                                */
/* ------------------------------------------------------------------------ */

interface Device {
  /** Un marqueur d'identité est posé : l'app peut s'ouvrir sans réseau. */
  localSession: boolean;
  /** Saisies d'un compte dont la session a été retirée, pas encore envoyées. */
  pending: number;
}
let device: Device = { localSession: false, pending: 0 };
const deviceListeners = new Set<() => void>();
const setDevice = (p: Partial<Device>) => {
  device = { ...device, ...p };
  deviceListeners.forEach((l) => l());
};
function useDevice(): Device {
  return useSyncExternalStore(
    (l) => {
      deviceListeners.add(l);
      return () => deviceListeners.delete(l);
    },
    () => device,
  );
}

/** Entrer dans l'app : pile du compte remise à zéro, arrivée sur la Salle. */
function useEnter() {
  const nav = useNav();
  const { setAccount } = useProto();
  return (patch: Parameters<typeof setAccount>[0] = {}) => {
    nav.reset();
    nav.go("salle");
    setAccount({ phase: "connecte", ...patch });
  };
}

const MIN_PASSWORD = 10;

function emailError(v: string): string | null {
  const t = v.trim();
  if (!t) return "Saisis ton adresse e-mail.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t))
    return "Adresse incomplète : vérifie le @ et le domaine.";
  return null;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

/* ------------------------------------------------------------------------ */
/* Connexion                                                                  */
/* ------------------------------------------------------------------------ */

function Connexion() {
  const nav = useNav();
  const { account } = useProto();
  const dev = useDevice();
  const enter = useEnter();
  const offline = account.offline;
  // Pré-rempli tant qu'on n'y a pas touché, si l'appareil connaît déjà le compte.
  const [typed, setEmail] = useState<string | null>(null);
  const email = typed ?? (dev.pending > 0 ? account.email : "");
  const [password, setPassword] = useState("");
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [otherAccount, setOtherAccount] = useState(false);
  const [purge, setPurge] = useState(false);

  const eErr = tried ? emailError(email) : null;
  const pErr = tried && !password ? "Saisis ton mot de passe." : null;
  const resumable = offline && dev.localSession && !otherAccount;

  const submit = () => {
    if (resumable) return enter({ pendingSync: dev.pending });
    setTried(true);
    setServerErr(null);
    if (emailError(email) || !password || offline || busy) return;
    if (dev.pending > 0 && email.trim().toLowerCase() !== account.email) {
      setServerErr(
        `Des saisies de ${account.email} attendent encore l’envoi. Connecte-toi avec ce compte, ou efface-les d’abord.`,
      );
      return;
    }
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      if (password.length < 8) {
        setServerErr("E-mail ou mot de passe incorrect.");
        return;
      }
      const pending = dev.pending;
      setDevice({ pending: 0 });
      enter({ email: email.trim().toLowerCase(), pendingSync: pending });
    }, 500);
  };

  return (
    <form
      className="flex flex-1 flex-col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <ImplicitSubmit />
      <Screen
        bottom={
          <>
            {offline && !resumable && (
              <p
                role="status"
                className="text-[14px] leading-[1.4] text-(--muted)"
              >
                <span className="font-semibold text-(--ink)">Hors ligne</span> ·
                la connexion demande le réseau.
              </p>
            )}
            {resumable ? (
              <PrimaryButton
                onClick={submit}
                over="Hors ligne"
                meta={
                  dev.pending
                    ? plural(dev.pending, "saisie", "saisies")
                    : undefined
                }
              >
                Continuer sur cet appareil
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={submit} disabled={offline || busy}>
                {busy ? "Connexion…" : "Se connecter"}
              </PrimaryButton>
            )}
          </>
        }
      >
        <div className="h-12" />
        <ScreenHeader
          title="Connexion"
          meta="Une fois par appareil. Ensuite l’app s’ouvre même sans réseau."
        />

        {resumable && (
          <div className="px-5 pb-2">
            <Notice
              title="Session locale reconnue"
              actions={
                <TextLink tone="muted" onClick={() => setOtherAccount(true)}>
                  Utiliser un autre compte
                </TextLink>
              }
            >
              <span className="text-(--ink)">{account.email}</span> est déjà
              connecté sur cet appareil. La salle et tes séances s’ouvrent sans
              réseau ; tes saisies partent au retour. Le journal et l’Analyse
              attendent le réseau.
            </Notice>
          </div>
        )}

        {!resumable && dev.pending > 0 && (
          <div className="px-5 pb-2">
            {purge ? (
              <Notice
                title={`Effacer ${plural(dev.pending, "saisie", "saisies")} ?`}
                actions={
                  <>
                    <SecondaryButton onClick={() => setPurge(false)}>
                      Garder
                    </SecondaryButton>
                    <TextLink
                      onClick={() => {
                        setDevice({ pending: 0, localSession: false });
                        setPurge(false);
                        setServerErr(null);
                        setEmail(null);
                      }}
                    >
                      Effacer et changer de compte
                    </TextLink>
                  </>
                }
              >
                Elles ne sont jamais arrivées sur le serveur : changer de compte
                les efface de l’appareil pour de bon.
              </Notice>
            ) : (
              <Notice
                title={`${plural(dev.pending, "saisie attend", "saisies attendent")} l’envoi`}
                actions={
                  <TextLink tone="muted" onClick={() => setPurge(true)}>
                    Changer de compte
                  </TextLink>
                }
              >
                Elles appartiennent à{" "}
                <span className="text-(--ink)">{account.email}</span>, dont la
                session a été retirée. Reconnecte-toi avec ce compte pour les
                envoyer.
              </Notice>
            )}
          </div>
        )}

        {!resumable && (
          <>
            <TextField
              label="E-mail"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(v) => {
                setEmail(v);
                setServerErr(null);
              }}
              error={eErr}
              placeholder="toi@exemple.fr"
              enterKeyHint="next"
            />
            <PasswordField
              label="Mot de passe"
              autoComplete="current-password"
              value={password}
              onChange={(v) => {
                setPassword(v);
                setServerErr(null);
              }}
              error={pErr}
              enterKeyHint="go"
            />
            {serverErr && (
              <div className="px-5">
                <FieldError>{serverErr}</FieldError>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-4 px-5 pt-2">
              <TextLink
                tone="muted"
                onClick={() =>
                  nav.push(
                    "mot-de-passe",
                    email.trim() ? { email: email.trim() } : {},
                  )
                }
              >
                Mot de passe oublié
              </TextLink>
              <TextLink onClick={() => nav.push("inscription")}>
                Créer un compte
              </TextLink>
            </div>
          </>
        )}

        <PrototypeCommands />
      </Screen>
    </form>
  );
}

/** Commandes du prototype (réseau, état de l'appareil). Absentes de l'app. */
function PrototypeCommands() {
  const { account, setAccount } = useProto();
  const dev = useDevice();
  return (
    <section className="mt-10">
      <Rule strong />
      <SectionTitle aside="absent de l'app">
        Commandes du prototype
      </SectionTitle>
      <div className="border-t border-(--line)">
        <Switch
          label="Simuler hors ligne"
          meta="la connexion devient impossible"
          checked={account.offline}
          onChange={(v) => setAccount({ offline: v })}
        />
        <Switch
          label="Session locale sur l’appareil"
          meta="déjà connecté ici, ouverture sans réseau"
          checked={dev.localSession}
          onChange={(v) => setDevice({ localSession: v })}
        />
        <Stepper
          label="Saisies en attente"
          meta="session retirée par le serveur"
          value={dev.pending}
          min={0}
          max={9}
          onChange={(v) => setDevice({ pending: v })}
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Inscription                                                                */
/* ------------------------------------------------------------------------ */

function Inscription() {
  const nav = useNav();
  const { account } = useProto();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tried, setTried] = useState(false);
  const eErr = tried ? emailError(email) : null;
  const short = password.length < MIN_PASSWORD;
  const pErr =
    tried && short
      ? password
        ? `Trop court : ${MIN_PASSWORD} caractères minimum, il en manque ${MIN_PASSWORD - password.length}.`
        : "Choisis un mot de passe."
      : null;
  const submit = () => {
    setTried(true);
    if (emailError(email) || short || account.offline) return;
    nav.push("verifier", { email: email.trim().toLowerCase() });
  };
  return (
    <form
      className="flex flex-1 flex-col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <ImplicitSubmit />
      <Screen
        bottom={
          <>
            {account.offline && (
              <p role="status" className="text-[14px] text-(--muted)">
                <span className="font-semibold text-(--ink)">Hors ligne</span> ·
                créer un compte demande le réseau.
              </p>
            )}
            <PrimaryButton onClick={submit} disabled={account.offline}>
              Créer mon compte
            </PrimaryButton>
          </>
        }
      >
        <ScreenHeader
          title="Créer un compte"
          meta="Ton compte relie tes appareils. Tes séances restent à toi seul."
          back={{ label: "Connexion", onClick: nav.back }}
        />
        <TextField
          label="E-mail"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={eErr}
          placeholder="toi@exemple.fr"
          enterKeyHint="next"
          hint="Un lien d’activation y sera envoyé."
        />
        <PasswordField
          label="Mot de passe"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={pErr}
          enterKeyHint="go"
          hint={
            password && short
              ? `${password.length} sur ${MIN_PASSWORD} caractères minimum`
              : password
                ? `${password.length} caractères, c’est bon`
                : `${MIN_PASSWORD} caractères minimum`
          }
        />
        <div className="px-5 pt-2">
          <TextLink tone="muted" onClick={nav.back}>
            Déjà un compte ? Se connecter
          </TextLink>
        </div>
        <div className="h-(--pad-bottom)" />
      </Screen>
    </form>
  );
}

function Verifier({ email }: { email: string }) {
  const nav = useNav();
  const { setAccount } = useProto();
  const [resent, setResent] = useState(false);
  return (
    <Screen
      bottom={
        <PrimaryButton
          onClick={() => {
            setAccount({ phase: "premier-lancement", email });
            nav.reset();
          }}
        >
          J’ai ouvert le lien
        </PrimaryButton>
      }
    >
      <ScreenHeader
        title="Vérifie ta boîte"
        back={{ label: "Créer un compte", onClick: nav.back }}
      />
      <div className="px-5">
        <p className="text-[16px] leading-[1.5] text-(--ink)">
          Un lien d’activation est parti à{" "}
          <span className="font-semibold">{email}</span>.
        </p>
        <p className="mt-2 text-[15px] leading-[1.5] text-(--muted)">
          Ouvre-le sur ce téléphone : l’app reprend ici, sur ta première
          routine. Rien reçu ? Regarde dans les indésirables.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5">
          <TextLink onClick={() => setResent(true)}>Renvoyer l’e-mail</TextLink>
          <TextLink tone="muted" onClick={nav.back}>
            Changer d’adresse
          </TextLink>
        </div>
        {resent && (
          <p role="status" className="mt-1 text-[14px] text-(--muted)">
            Renvoyé à {email}.
          </p>
        )}
        <p className="mt-8 text-[14px] text-(--faint)">
          Prototype : le bouton du bas fait comme si le lien était ouvert.
        </p>
      </div>
    </Screen>
  );
}

/* ------------------------------------------------------------------------ */
/* Mot de passe                                                               */
/* ------------------------------------------------------------------------ */

function MotDePasseOublie({ email: initial }: { email: string }) {
  const nav = useNav();
  const { account } = useProto();
  const [email, setEmail] = useState(initial);
  const [tried, setTried] = useState(false);
  const [sent, setSent] = useState(false);
  const eErr = tried ? emailError(email) : null;
  const submit = () => {
    setTried(true);
    if (emailError(email) || account.offline) return;
    setSent(true);
  };

  if (sent) {
    return (
      <Screen
        bottom={
          <PrimaryButton onClick={nav.back}>
            Retour à la connexion
          </PrimaryButton>
        }
      >
        <ScreenHeader
          title="Lien envoyé"
          back={{ label: "Connexion", onClick: nav.back }}
        />
        <div className="px-5">
          <p className="text-[16px] leading-[1.5] text-(--ink)">
            Si un compte existe pour{" "}
            <span className="font-semibold">{email.trim()}</span>, un lien de
            réinitialisation arrive dans quelques minutes.
          </p>
          <p className="mt-2 text-[15px] leading-[1.5] text-(--muted)">
            Il ouvre l’écran du nouveau mot de passe. Il ne sert qu’une fois.
          </p>
          <div className="mt-8">
            <TextLink
              tone="muted"
              onClick={() => nav.push("nouveau-mot-de-passe")}
            >
              Prototype : ouvrir le lien
            </TextLink>
          </div>
        </div>
      </Screen>
    );
  }

  return (
    <form
      className="flex flex-1 flex-col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <ImplicitSubmit />
      <Screen
        bottom={
          <>
            {account.offline && (
              <p role="status" className="text-[14px] text-(--muted)">
                <span className="font-semibold text-(--ink)">Hors ligne</span> ·
                l’envoi demande le réseau.
              </p>
            )}
            <PrimaryButton onClick={submit} disabled={account.offline}>
              Envoyer le lien
            </PrimaryButton>
          </>
        }
      >
        <ScreenHeader
          title="Mot de passe oublié"
          meta="Un lien par e-mail pour en choisir un nouveau."
          back={{ label: "Connexion", onClick: nav.back }}
        />
        <TextField
          label="E-mail"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={eErr}
          placeholder="toi@exemple.fr"
          enterKeyHint="send"
          autoFocus={!initial}
        />
      </Screen>
    </form>
  );
}

function NouveauMotDePasse() {
  const nav = useNav();
  const enter = useEnter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [tried, setTried] = useState(false);
  const short = password.length < MIN_PASSWORD;
  const pErr =
    tried && short
      ? password
        ? `Trop court : il manque ${MIN_PASSWORD - password.length} caractère${MIN_PASSWORD - password.length > 1 ? "s" : ""}.`
        : "Choisis un mot de passe."
      : null;
  const cErr =
    tried && !short && confirm !== password
      ? "Les deux saisies ne correspondent pas."
      : null;
  const submit = () => {
    setTried(true);
    if (short || confirm !== password) return;
    enter();
  };
  return (
    <form
      className="flex flex-1 flex-col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <ImplicitSubmit />
      <Screen
        bottom={
          <PrimaryButton onClick={submit}>Enregistrer et entrer</PrimaryButton>
        }
      >
        <ScreenHeader
          title="Nouveau mot de passe"
          meta={`${MIN_PASSWORD} caractères minimum, différent de l’ancien.`}
          back={{ label: "Connexion", onClick: () => nav.reset() }}
        />
        <PasswordField
          label="Nouveau mot de passe"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={pErr}
          enterKeyHint="next"
        />
        <PasswordField
          label="Encore une fois"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
          error={cErr}
          enterKeyHint="go"
        />
      </Screen>
    </form>
  );
}

/* ------------------------------------------------------------------------ */
/* Premier lancement                                                          */
/* ------------------------------------------------------------------------ */

/** Modèle de départ de l'app réelle (onboarding/template.ts). */
const STARTER: {
  name: string;
  sets: [number, number];
  reps: [number, number];
  rir: [number, number];
}[] = [
  { name: "Développé couché", sets: [3, 4], reps: [8, 12], rir: [1, 2] },
  { name: "Tirage horizontal", sets: [3, 4], reps: [10, 12], rir: [1, 2] },
  { name: "Développé militaire", sets: [3, 3], reps: [6, 8], rir: [2, 2] },
  { name: "Curl biceps haltères", sets: [3, 4], reps: [10, 15], rir: [0, 1] },
];

function PremierLancement() {
  const enter = useEnter();
  const [routine, setRoutine] = useState("Ma routine");
  const [seance, setSeance] = useState("Upper A");
  const [start, setStart] = useState<"modele" | "vierge">("modele");
  const [tried, setTried] = useState(false);
  const rErr = tried && !routine.trim() ? "Donne un nom à ta routine." : null;
  const sErr =
    tried && !seance.trim() ? "Donne un nom à ta première séance." : null;
  const submit = () => {
    setTried(true);
    if (!routine.trim() || !seance.trim()) return;
    enter();
  };

  const option = (value: "modele" | "vierge", title: string, meta: string) => {
    const on = start === value;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => setStart(value)}
        className="flex min-h-16 w-full items-start gap-4 border-b border-(--line) px-5 py-3.5 text-left active:bg-(--line)"
      >
        <span className="pt-0.5">
          <RadioMark checked={on} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block text-[17px] ${on ? "font-semibold text-(--ink)" : "font-medium text-(--ink)"}`}
          >
            {title}
          </span>
          <span className="mt-0.5 block text-[14px] leading-[1.4] text-(--muted)">
            {meta}
          </span>
        </span>
      </button>
    );
  };

  return (
    <form
      className="flex flex-1 flex-col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <ImplicitSubmit />
      <Screen
        bottom={
          <PrimaryButton onClick={submit}>Créer ma routine</PrimaryButton>
        }
      >
        <div className="h-12" />
        <ScreenHeader
          title="Ta première routine"
          meta="Les séances que tu tournes. Tout se change ensuite dans Séances."
        />
        <TextField
          label="Nom de la routine"
          value={routine}
          onChange={setRoutine}
          error={rErr}
          enterKeyHint="next"
        />
        <TextField
          label="Première séance"
          value={seance}
          onChange={setSeance}
          error={sErr}
          enterKeyHint="done"
          hint="C’est par ce nom que tu la choisis en arrivant à la salle."
        />

        <SectionTitle>Point de départ</SectionTitle>
        <div
          role="radiogroup"
          aria-label="Point de départ"
          className="border-t border-(--line)"
        >
          {option(
            "modele",
            "Modèle de départ",
            `${STARTER.length} exos de base déjà prescrits, jouable dès la première séance.`,
          )}
          {start === "modele" && (
            <ol
              aria-label="Exercices du modèle"
              className="border-b border-(--line) py-1.5 pl-[62px] pr-5"
            >
              {STARTER.map((x) => (
                <li
                  key={x.name}
                  className="flex items-baseline justify-between gap-3 py-1 text-[15px] leading-[1.3]"
                >
                  <span className="min-w-0 text-(--ink)">{x.name}</span>
                  <span className="flex-none whitespace-nowrap text-[14px] text-(--muted)">
                    {range(x.sets)} × {range(x.reps)} · RIR {range(x.rir)}
                  </span>
                </li>
              ))}
              <li className="pt-1.5 text-[14px] leading-[1.4] text-(--faint)">
                Séries × reps · RIR : les reps en réserve, celles que tu aurais encore pu faire.
              </li>
            </ol>
          )}
          {option(
            "vierge",
            "Séance vierge",
            "Tu ajoutes les exos et leurs prescriptions dans Séances.",
          )}
        </div>
        <div className="h-4" />
      </Screen>
    </form>
  );
}
