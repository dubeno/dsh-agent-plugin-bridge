import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Stub the real MCP client so tests can observe the config shape the bridge
// hands to it without spinning up a stdio subprocess.
const calls: unknown[] = []
vi.mock('@deepseek-ai/dsh-mcp-client', () => ({
  default: {},
}))

const { registerStandaloneMcpJson } = await import('../src/mcp.js')

let workDir: string

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'dsh-bridge-mcp-'))
  calls.length = 0
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function writeMcp(rel: string, body: unknown): string {
  const abs = path.join(workDir, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, JSON.stringify(body))
  return abs
}

function makeCtx() {
  const warnings: string[] = []
  const ctx = {
    plugin: vi.fn((_mod: unknown, cfg: unknown) => {
      calls.push(cfg)
      return () => {}
    }),
    logger: {
      info: vi.fn(),
      warn: vi.fn((m: string) => warnings.push(m)),
    },
  }
  return { ctx, warnings }
}

describe('registerStandaloneMcpJson', () => {
  it('expands ${VAR} placeholders from process.env in stdio commands', async () => {
    const file = writeMcp('user/mcp.json', {
      mcpServers: {
        sample: { type: 'stdio', command: '${SHELL_BIN}', args: ['${SHELL_BIN}', '-c', 'echo hi'] },
      },
    })
    process.env.SHELL_BIN = '/bin/sh'
    try {
      const { ctx } = makeCtx()
      const ok = await registerStandaloneMcpJson(ctx as never, file, false)
      expect(ok).toBe(1)
      const cfg = calls[0] as { command: string; args: string[]; cwd: string }
      expect(cfg.command).toBe('/bin/sh')
      expect(cfg.args).toEqual(['/bin/sh', '-c', 'echo hi'])
      // Standalone files must not inject PLUGIN_ROOT — cwd defaults to the
      // mcp.json directory, so $PLUGIN_ROOT is undefined and falls back to "".
      expect(cfg.cwd).toBe(path.dirname(file))
    } finally {
      delete process.env.SHELL_BIN
    }
  })

  it('does not register a server whose ${VAR} expands to empty', async () => {
    const file = writeMcp('user/mcp.json', {
      mcpServers: {
        bad: { type: 'stdio', command: '${UNSET_VAR_XYZ_123}' },
      },
    })
    delete process.env.UNSET_VAR_XYZ_123
    const { ctx, warnings } = makeCtx()
    const ok = await registerStandaloneMcpJson(ctx as never, file, false)
    expect(ok).toBe(0)
    expect(warnings.some(w => w.includes('empty command after env expansion'))).toBe(true)
  })

  it('reports a warning and returns 0 when the mcp.json file is missing', async () => {
    const { ctx, warnings } = makeCtx()
    const ok = await registerStandaloneMcpJson(ctx as never, path.join(workDir, 'nope.json'), false)
    expect(ok).toBe(0)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('names the owner after the mcp.json basename so two files do not collide', async () => {
    const a = writeMcp('dir-a/mcp.json', {
      mcpServers: { foo: { type: 'stdio', command: 'a' } },
    })
    const b = writeMcp('dir-b/mcp.json', {
      mcpServers: { foo: { type: 'stdio', command: 'b' } },
    })
    const { ctx } = makeCtx()
    await registerStandaloneMcpJson(ctx as never, a, false)
    await registerStandaloneMcpJson(ctx as never, b, false)
    // Both files register a server called "foo" but each lands in its own
    // owner-scoped data dir. Owner is the mcp.json basename; for a Cursor
    // user-level file the owner is just "mcp" (the file's stem).
    expect(calls).toHaveLength(2)
    const infoLines = (ctx.logger.info as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((l: string) => l.includes('mcp foo'))
    expect(infoLines).toHaveLength(2)
    // Different cwd per file -> different data dir -> owners do not collide.
    const cwdA = (calls[0] as { cwd: string }).cwd
    const cwdB = (calls[1] as { cwd: string }).cwd
    expect(cwdA).not.toBe(cwdB)
  })
})
