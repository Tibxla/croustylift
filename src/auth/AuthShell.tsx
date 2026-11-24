// Coquille commune aux écrans d'entrée (connexion, mot de passe oublié,
// définition du mot de passe, garde d'arrivée), au kit E : un en-tête d'écran
// comme partout ailleurs (titre de 28 px, ligne grise dessous, retour nommé),
// les champs au fil du doigt, et l'action principale en bloc plein dans la barre
// collée du bas. Pas de marque à halo, pas de slogan, pas de pied « OFFLINE-FIRST
// · CHIFFRÉ » : il promettait un chiffrement que l'app ne démontre pas (registre
// U25, U2, U40).
//
// `onSubmit` : l'écran est un formulaire. La barre du bas en fait partie, si
// bien que le bouton principal y est un vrai `submit` et qu'Entrée dans un champ
// valide le formulaire, sans bouton caché.
import type { FormEvent, ReactNode } from 'react'
import { Screen, ScreenHeader } from '../ui'

export function AuthShell({
  title,
  meta,
  back,
  bottom,
  onSubmit,
  children,
}: {
  title: string
  /** Une ligne sous le titre. */
  meta?: ReactNode
  /** Retour nommé (« ‹ Connexion »). Sans retour, un blanc tient la place de la navigation. */
  back?: { label: string; onClick: () => void }
  /** L'action principale (et ce qui l'accompagne), dans la barre collée du bas. */
  bottom?: ReactNode
  onSubmit?: (e: FormEvent) => void
  children?: ReactNode
}) {
  const screen = (
    <Screen bottom={bottom}>
      {!back && <div aria-hidden="true" className="h-12" />}
      <ScreenHeader title={title} meta={meta} back={back} />
      {children}
    </Screen>
  )
  return (
    <main className="flex min-h-screen flex-col bg-bg text-ink">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        {onSubmit ? (
          <form noValidate onSubmit={onSubmit} className="flex flex-1 flex-col">
            {screen}
          </form>
        ) : (
          screen
        )}
      </div>
    </main>
  )
}
