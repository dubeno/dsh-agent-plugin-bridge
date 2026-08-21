import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerPluginSkills } from '../src/skills.js'
import { discoverPlugin } from '../src/discover.js'

let workDir: string

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'dsh-bridge-skills-'))
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function makeCtx() {
  const registered: unknown[] = []
  const effects: Array<() => void> = []
  const ctx = {
    get: (key: string) => {
      if (key === 'skills') return { register: (s: unknown) => { registered.push(s); return () => {} } }
      return undefined
    },
    effect: (fn: () => () => void) => { effects.push(fn); return fn() },
    logger: { info: () => {}, warn: () => {} },
  }
  return { ctx: ctx as never, registered, effects }
}

describe('registerPluginSkills', () => {
  it('returns 0 when the plugin has no skills directory', async () => {
    const root = path.join(workDir, 'no-skills')
    mkdirSync(root, { recursive: true })
    writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name: 'no-skills' }))
    const plugin = await discoverPlugin(root)
    expect(plugin).not.toBeNull()

    const { ctx, registered } = makeCtx()
    const count = await registerPluginSkills(ctx, plugin!, 'agent-plugin')
    expect(count).toBe(0)
    expect(registered).toHaveLength(0)
  })

  it('registers every skill folder that has a SKILL.md', async () => {
    const root = path.join(workDir, 'with-skills')
    mkdirSync(root, { recursive: true })
    writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name: 'with-skills' }))

    const a = path.join(root, 'skills', 'alpha')
    mkdirSync(a, { recursive: true })
    writeFileSync(path.join(a, 'SKILL.md'), '---\nname: alpha\ndescription: Alpha skill\n---\nAlpha body\n')

    const b = path.join(root, 'skills', 'beta')
    mkdirSync(b, { recursive: true })
    writeFileSync(path.join(b, 'SKILL.md'), '---\nname: beta\ndescription: Beta skill\n---\nBeta body\n')

    const c = path.join(root, 'skills', 'broken')
    mkdirSync(c, { recursive: true })
    // No SKILL.md inside, should be skipped.

    const plugin = await discoverPlugin(root)
    expect(plugin).not.toBeNull()

    const { ctx, registered } = makeCtx()
    const count = await registerPluginSkills(ctx, plugin!, 'agent-plugin')
    expect(count).toBe(2)
    const names = registered.map(r => (r as { name: string }).name).sort()
    expect(names).toEqual(['alpha', 'beta'])
    const provider = (registered[0] as { provider: string }).provider
    expect(provider).toBe('agent-plugin:with-skills')
  })

  it('warns and returns 0 when the skills service is missing', async () => {
    const root = path.join(workDir, 'no-service')
    mkdirSync(root, { recursive: true })
    writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name: 'no-service' }))
    mkdirSync(path.join(root, 'skills', 'x'), { recursive: true })
    writeFileSync(path.join(root, 'skills', 'x', 'SKILL.md'), '---\nname: x\n---\nbody\n')

    const plugin = await discoverPlugin(root)
    const warn = vi.fn()
    const ctx = {
      get: () => undefined,
      effect: () => undefined,
      logger: { info: () => {}, warn },
    }
    const count = await registerPluginSkills(ctx as never, plugin!, 'agent-plugin')
    expect(count).toBe(0)
    expect(warn).toHaveBeenCalled()
  })
})
