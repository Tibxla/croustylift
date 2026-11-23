// Garde des polices embarquées : chaque fichier déclaré dans `src/fonts.css` est
// émis par le build puis précaché par le service worker, qu'un glyphe en soit
// affiché ou non. Une police hors pile, ou un sous-ensemble dont le français n'a
// pas l'usage, pèse donc sur chaque installation sans jamais servir.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const faces = [...read('../src/fonts.css').matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
  family: /font-family:\s*"([^"]+)"/.exec(body)?.[1],
  file: /url\("([^"]+)"\)/.exec(body)?.[1],
}))
const stacks = [...read('../src/index.css').matchAll(/--font-(?:sans|mono):\s*([^;]+);/g)].map(([, stack]) => stack)

describe('polices embarquées', () => {
  it('déclare au moins une police, toutes lisibles', () => {
    expect(faces.length).toBeGreaterThan(0)
    for (const face of faces) {
      expect(face.family).toBeTruthy()
      expect(face.file).toBeTruthy()
    }
  })

  it('ne déclare que des polices présentes en tête d’une pile', () => {
    const heads = stacks.map((stack) => /^"([^"]+)"/.exec(stack.trim())?.[1])
    for (const face of faces) expect(heads).toContain(face.family)
  })

  it('n’embarque que le sous-ensemble latin, un fichier par police', () => {
    for (const face of faces) expect(face.file).toMatch(/-latin-wght-normal\.woff2$/)
    expect(new Set(faces.map((face) => face.family)).size).toBe(faces.length)
  })

  it('ne dépend d’aucun paquet de police sans déclaration', () => {
    const { dependencies } = JSON.parse(read('../package.json'))
    const packages = Object.keys(dependencies).filter((name) => name.startsWith('@fontsource'))
    for (const name of packages) expect(faces.some((face) => face.file.startsWith(`${name}/`))).toBe(true)
  })
})
