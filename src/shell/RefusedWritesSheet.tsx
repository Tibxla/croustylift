// Écran des saisies refusées par le serveur (quarantaine de la file, ADR 0018),
// en feuille basse, ouvert depuis la ligne de synchro ou Réglages.
//
// Chaque saisie se lit en clair (quoi, quand, pourquoi : refused-writes.ts) et
// se règle une à une : « Renvoyer » la remet en file et lance un envoi (elle
// revient ici si le serveur la refuse encore) ; « Abandonner » la retire pour
// de bon, après confirmation (ADR 0012 : rien ne se perd sans geste explicite).
// Les fonctions viennent de la file (`listRefused`, `retryRefused`,
// `abandonRefused`), intouchée. Elles ne voient que les saisies du compte
// reconnu.
import { useCallback, useEffect, useState } from 'react';
import { abandonRefused, listRefused, OUTBOX_CHANGED_EVENT, readQueue, retryRefused, type RefusedWrite } from '../features/capture/outbox';
import { listExercisesForCapture } from '../features/capture/data';
import { flushOutbox } from '../features/capture/sync';
import { Confirm, EmptyState, SecondaryButton, Sheet, TextLink } from '../ui';
import { describeRefusal, fmtWhen } from './refused-writes';

type Outcome = { id: string; text: string };

export function RefusedWritesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Le contenu n'existe que feuille ouverte : il relit la file à chaque ouverture.
  return (
    <Sheet open={open} title="Saisies refusées" onClose={onClose}>
      {open && <RefusedList />}
    </Sheet>
  );
}

function RefusedList() {
  const [entries, setEntries] = useState<RefusedWrite[]>(() => listRefused());
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const refresh = useCallback(() => setEntries(listRefused()), []);

  // La liste suit la file : un envoi, un autre onglet, un nouvel essai.
  useEffect(() => {
    const events = [OUTBOX_CHANGED_EVENT, 'storage', 'online'] as const;
    for (const e of events) window.addEventListener(e, refresh);
    return () => {
      for (const e of events) window.removeEventListener(e, refresh);
    };
  }, [refresh]);

  // Les noms d'exos, depuis la copie locale du catalogue (hors ligne compris).
  useEffect(() => {
    let active = true;
    listExercisesForCapture()
      .then((rows) => {
        if (active) setNames(new Map(rows.map((r) => [r.id, r.name])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function resend(entry: RefusedWrite) {
    setBusy(entry.refusalId);
    setOutcome(null);
    if (!retryRefused(entry.refusalId)) {
      // Une correction de la même série attend déjà en file : elle reconstituera
      // la série à partir de ce refus, rien à renvoyer. Sinon, le stockage.
      // Elle n'est plus là : réglée depuis un autre onglet.
      const stillThere = listRefused().some((r) => r.refusalId === entry.refusalId);
      const queued = entry.op.type === 'insertSet' && readQueue().some((op) => op.type === 'insertSet' && op.id === entry.op.id);
      setOutcome({
        id: entry.refusalId,
        text: !stillThere
          ? 'Cette saisie a déjà été réglée, depuis un autre onglet.'
          : queued
            ? 'Une correction de cette série attend déjà l’envoi : elle partira avec. Rien à renvoyer.'
            : 'L’appareil n’a pas pu l’enregistrer : son stockage est peut-être plein. Libère de la place puis réessaie.',
      });
      setBusy(null);
      refresh();
      return;
    }
    refresh();
    try {
      await flushOutbox();
    } catch {
      // Hors ligne ou serveur muet : elle reste en file et partira au retour.
    }
    const back = listRefused().some((r) => r.refusalId === entry.refusalId);
    setOutcome({
      id: entry.refusalId,
      text: back ? 'Le serveur la refuse encore.' : 'Renvoyée. Elle part dès que le réseau le permet.',
    });
    setBusy(null);
    refresh();
  }

  function abandon(entry: RefusedWrite) {
    setOutcome(null);
    if (!abandonRefused(entry.refusalId)) {
      const stillThere = listRefused().some((r) => r.refusalId === entry.refusalId);
      setOutcome({
        id: entry.refusalId,
        text: stillThere ? 'L’appareil n’a pas pu la retirer. Réessaie.' : 'Cette saisie a déjà été réglée, depuis un autre onglet.',
      });
    }
    setConfirming(null);
    refresh();
  }

  const lookup = { exerciseName: (id: string) => names.get(id) };
  const gone = outcome && !entries.some((e) => e.refusalId === outcome.id) ? outcome.text : null;

  return (
    <>
      {entries.length === 0 ? (
        <>
          {gone && (
            <p role="status" className="px-5 pb-2 text-[15px] text-ink">
              {gone}
            </p>
          )}
          <EmptyState title="Aucune saisie refusée" body="Tout ce qui est sur cet appareil a été accepté par le serveur ou attend l’envoi." />
        </>
      ) : (
        <>
          <p className="px-5 pb-3 text-[15px] leading-[1.45] text-muted">
            Le serveur a refusé ces saisies. Elles restent sur cet appareil et ne repartiront pas seules : renvoie-les si la cause est
            levée, ou abandonne-les.
          </p>
          {gone && (
            <p role="status" className="px-5 pb-3 text-[15px] text-ink">
              {gone}
            </p>
          )}
          <ul aria-label="Saisies refusées" className="border-t border-line">
            {entries.map((entry) => {
              const t = describeRefusal(entry, lookup);
              const when = fmtWhen(entry.at);
              return (
                <li key={entry.refusalId} className="border-b border-line px-5 py-3">
                  <p className="break-words text-[17px] font-medium leading-[1.3] text-ink">{t.what}</p>
                  {t.detail && <p className="mt-0.5 text-[14px] text-muted">{t.detail}</p>}
                  <p className="mt-0.5 text-[14px] text-faint">Refusée {when}</p>
                  <p className="mt-2 text-[15px] leading-[1.4] text-ink">
                    <span className="font-semibold">Motif : </span>
                    {t.reason}
                  </p>
                  {confirming === entry.refusalId ? (
                    <Confirm
                      className="mt-3"
                      destructive
                      keepLabel="Garder"
                      confirmLabel="Abandonner définitivement"
                      onCancel={() => setConfirming(null)}
                      onConfirm={() => abandon(entry)}
                    >
                      <p className="font-medium">Abandonner cette saisie ?</p>
                      <p className="mt-1 text-muted">Elle ne sera jamais envoyée et quittera cet appareil.</p>
                    </Confirm>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                      {t.retryable && (
                        <SecondaryButton size="sm" disabled={busy !== null} onClick={() => void resend(entry)} ariaLabel={`Renvoyer : ${t.what}`}>
                          {busy === entry.refusalId ? 'Envoi…' : 'Renvoyer'}
                        </SecondaryButton>
                      )}
                      <TextLink tone="muted" onClick={busy ? undefined : () => setConfirming(entry.refusalId)} ariaLabel={`Abandonner : ${t.what}`}>
                        Abandonner
                      </TextLink>
                    </div>
                  )}
                  {outcome?.id === entry.refusalId && (
                    <p role="status" className="mt-2 text-[15px] text-ink">
                      {outcome.text}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
