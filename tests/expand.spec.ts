import { describe, expect, it } from 'vitest'
import { expandArgs, expandPlaceholders, expandRecord } from '../src/expand.ts'

describe('expandPlaceholders', () => {
  it('substitutes values from the injected vars map', () => {
    expect(expandPlaceholders('hello ${WHO}', { WHO: 'world' })).toBe('hello world')
  })

  it('falls back to process.env for unknown vars', () => {
    const key = `BRIDGE_TEST_${Date.now()}_${Math.random().toString(36).slice(2)}`
    process.env[key] = 'from-env'
    try {
      expect(expandPlaceholders('value=${' + key + '}', {})).toBe('value=from-env')
    } finally {
      delete process.env[key]
    }
  })

  it('expands missing values to empty string', () => {
    const key = `BRIDGE_TEST_MISSING_${Date.now()}_${Math.random().toString(36).slice(2)}`
    delete process.env[key]
    expect(expandPlaceholders('x=${' + key + '}', {})).toBe('x=')
  })

  it('leaves text without placeholders untouched', () => {
    expect(expandPlaceholders('plain text', { WHO: 'world' })).toBe('plain text')
  })
})

describe('expandRecord', () => {
  it('returns empty object for undefined', () => {
    expect(expandRecord(undefined, {})).toEqual({})
  })

  it('expands every value', () => {
    const out = expandRecord({ A: '${X}', B: 'static' }, { X: 'expanded' })
    expect(out).toEqual({ A: 'expanded', B: 'static' })
  })
})

describe('expandArgs', () => {
  it('returns empty array for undefined', () => {
    expect(expandArgs(undefined, {})).toEqual([])
  })

  it('expands each entry', () => {
    expect(expandArgs(['${A}', 'b'], { A: 'aa' })).toEqual(['aa', 'b'])
  })
})
