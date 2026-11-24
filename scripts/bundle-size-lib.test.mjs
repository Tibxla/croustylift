import { describe, expect, it } from 'vitest'
import { evaluateBudgets, logicalName } from './bundle-size-lib.mjs'

describe('logicalName', () => {
  it('retire le hash de contenu', () => {
    expect(logicalName('assets/index-DB2gw0h3.js')).toBe('index.js')
    expect(logicalName('assets/AnalysisScreen-BzKqgRw5.js')).toBe('AnalysisScreen.js')
    expect(logicalName('assets/index-CmBFUH32.css')).toBe('index.css')
    expect(logicalName('assets/workbox-window.prod.es5-B9K5rw8f.js')).toBe('workbox-window.prod.es5.js')
    expect(logicalName('assets/geist-latin-wght-normal-BgDaEnEv.woff2')).toBe('geist-latin-wght-normal.woff2')
  })

  it('laisse un nom sans hash intact', () => {
    expect(logicalName('sw.js')).toBe('sw.js')
  })
})

describe('evaluateBudgets', () => {
  const budgets = { 'index.js': 100, 'react.js': 60 }

  it('tout sous budget', () => {
    const { ok, rows } = evaluateBudgets({ 'index.js': 90, 'react.js': 60 }, budgets)
    expect(ok).toBe(true)
    expect(rows.map((r) => r.status)).toEqual(['ok', 'ok'])
  })

  it('un dépassement fait échouer', () => {
    const { ok, rows } = evaluateBudgets({ 'index.js': 101, 'react.js': 10 }, budgets)
    expect(ok).toBe(false)
    expect(rows[0]).toMatchObject({ name: 'index.js', status: 'dépassé' })
  })

  it('un chunk budgété absent ou un chunk sans budget font échouer', () => {
    expect(evaluateBudgets({ 'index.js': 1 }, budgets).ok).toBe(false)
    const extra = evaluateBudgets({ 'index.js': 1, 'react.js': 1, 'nouveau.js': 1 }, budgets)
    expect(extra.ok).toBe(false)
    expect(extra.rows.at(-1)).toMatchObject({ name: 'nouveau.js', status: 'sans budget' })
  })
})
