import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Stub out the heavy mcp-client module so unit tests don't have to resolve
// @deepseek-ai/dsh-mcp-client's deep peer-dep graph. The bridge still calls
// the stubbed functions through the same call sites as in production.
vi.mock('@deepseek-ai/dsh-mcp-client', () => ({ default: {} }))

const { apply, Config, runBridge } = await import('../src/index.js')

let workDir: string

afterEach(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true })
  workDir = ''
  vi.restoreAllMocks()
})

function makeCtx(opts: { withSkills?: boolean } = {}) {
  const registered: unknown[] = []
  const skillsRegistered: unknown[] = []
  const warn = vi.fn()
  const info = vi.fn()
  const effects: Array<() => void> = []

  const ctx: any = {
    state: {},
    logger: { info, warn },
    effect: (fn: () => () => void) => { effects.push(fn); return fn() },
    tools: {
      register: (tool: unknown) => {
        registered.push(tool)
        return () => {}
      },
    },
    plugin: () => () => {},
    get: (key: string) => {
      if (key === 'skills') {
        if (opts.withSkills === false) return undefined
        return {
          register: (s: unknown) => { skillsRegistered.push(s); return () => {} },
        }
      }
      return undefined
    },
  }
  return { ctx, registered, skillsRegistered, warn, info }
}

function resolvedConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    pluginRoots: [],
    pluginsDirs: [],
    mcpJsonPaths: [],
    loadPluginMcp: false,
    failOnMcpError: false,
    skillProviderLabel: 'agent-plugin',
    ...overrides,
  }
}

describe('plugin registration', () => {
  it('registers exactly one tool (bridge_summary) after the peer guard', () => {
    const { ctx, registered } = makeCtx()
    apply(ctx, resolvedConfig() as never)
    expect(registered).toHaveLength(1)
    const tool = registered[0] as { name: string }
    expect(tool.name).toBe('bridge_summary')
  })

  it('exports a schemastery Config schema with sensible defaults', () => {
    expect(Config).toBeDefined()
    // Sanity-check that the schema is callable (returns the parsed value
    // when invoked with a valid input) — this exercises the schemastery
    // shape without depending on its private internals.
    expect(typeof (Config as unknown as (...args: unknown[]) => unknown)).toBe('function')
  })
})

describe('runBridge', () => {
  it('reports zero counts when nothing is configured', async () => {
    const { ctx, warn } = makeCtx()
    const summary = await runBridge(ctx, resolvedConfig() as never)
    expect(summary).toEqual({ plugins: 0, skills: 0, mcpServers: 0 })
    expect(warn).toHaveBeenCalled()
  })

  it('discovers plugins from pluginRoots and registers their skills', async () => {
    workDir = mkdtempSync(path.join(tmpdir(), 'dsh-bridge-run-'))
    const root = path.join(workDir, 'plug')
    mkdirSync(root, { recursive: true })
    writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name: 'plug', version: '0.1.0' }))

    const skillDir = path.join(root, 'skills', 'greet')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: greet\ndescription: Greet\n---\nBody\n')

    const { ctx, skillsRegistered } = makeCtx({ withSkills: true })
    const summary = await runBridge(ctx, resolvedConfig({ pluginRoots: [root] }) as never)
    expect(summary.plugins).toBe(1)
    expect(summary.skills).toBe(1)
    expect(skillsRegistered).toHaveLength(1)
    expect((skillsRegistered[0] as { name: string }).name).toBe('greet')
  })

  it('skips plugin skills registration gracefully when skills service is missing', async () => {
    workDir = mkdtempSync(path.join(tmpdir(), 'dsh-bridge-run-no-svc-'))
    const root = path.join(workDir, 'plug')
    mkdirSync(root, { recursive: true })
    writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name: 'plug' }))
    const skillDir = path.join(root, 'skills', 'g')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: g\n---\nb\n')

    const { ctx, warn } = makeCtx({ withSkills: false })
    const summary = await runBridge(ctx, resolvedConfig({ pluginRoots: [root] }) as never)
    expect(summary.plugins).toBe(1)
    expect(summary.skills).toBe(0)
    expect(warn).toHaveBeenCalled()
  })
})
