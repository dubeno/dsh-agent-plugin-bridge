import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { discoverPlugin, discoverPlugins } from '../src/discover.js'

let workDir: string

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'dsh-bridge-discover-'))
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function writePlugin(root: string, name: string, withSkills = true, withMcp = true) {
  mkdirSync(root, { recursive: true })
  writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name, version: '0.1.0' }))
  if (withSkills) {
    const skillDir = path.join(root, 'skills', 'demo')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: Demo skill\n---\nBody\n')
  }
  if (withMcp) {
    writeFileSync(
      path.join(root, 'mcp.json'),
      JSON.stringify({ mcpServers: { stub: { type: 'stdio', command: 'echo' } } }),
    )
  }
}

describe('discoverPlugin', () => {
  it('returns null for a directory without plugin.json', async () => {
    const dir = path.join(workDir, 'empty')
    mkdirSync(dir, { recursive: true })
    expect(await discoverPlugin(dir)).toBeNull()
  })

  it('returns null when manifest lacks name', async () => {
    const dir = path.join(workDir, 'no-name')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ version: '0.1.0' }))
    expect(await discoverPlugin(dir)).toBeNull()
  })

  it('resolves skills and mcp paths when present', async () => {
    const root = path.join(workDir, 'plug')
    writePlugin(root, 'sample')
    const discovered = await discoverPlugin(root)
    expect(discovered).not.toBeNull()
    expect(discovered?.manifest.name).toBe('sample')
    expect(discovered?.skillsDir).not.toBeNull()
    expect(existsSync(discovered!.skillsDir!)).toBe(true)
    expect(discovered?.mcpPath).not.toBeNull()
  })

  it('returns null skills/mcp when absent', async () => {
    const root = path.join(workDir, 'bare')
    writePlugin(root, 'bare', false, false)
    const discovered = await discoverPlugin(root)
    expect(discovered).not.toBeNull()
    expect(discovered?.skillsDir).toBeNull()
    expect(discovered?.mcpPath).toBeNull()
  })
})

describe('discoverPlugins', () => {
  it('merges pluginRoots and children of pluginsDirs, deduped', async () => {
    const a = path.join(workDir, 'a')
    const b = path.join(workDir, 'b')
    writePlugin(a, 'alpha')
    writePlugin(b, 'beta')

    const hosts = path.join(workDir, 'hosts')
    mkdirSync(hosts, { recursive: true })
    writePlugin(path.join(hosts, 'c'), 'gamma')
    writeFileSync(path.join(hosts, 'not-a-dir.txt'), 'ignore me')

    const out = await discoverPlugins([a, b], [hosts])
    const names = out.map(p => p.manifest.name).sort()
    expect(names).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('skips non-existent directories and non-directory entries', async () => {
    const out = await discoverPlugins([], [path.join(workDir, 'does-not-exist')])
    expect(out).toEqual([])
  })
})
