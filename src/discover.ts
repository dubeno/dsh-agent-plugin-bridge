/**
 * Plugin discovery: locate `plugin.json` either at explicit roots or as
 * immediate children of configured directories.
 * @module dsh-agent-plugin-bridge/discover
 */

import { access, readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { DiscoveredPlugin, PluginManifest } from './types.js'

const PLUGIN_SCHEMA_PREFIX = 'https://agent-plugins.org/schemas/'

export function expandHome(input: string): string {
  if (!input) return input
  if (input === '~') return homedir()
  if (input.startsWith('~/') || input.startsWith('~\\')) return join(homedir(), input.slice(2))
  return input
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readManifest(root: string): Promise<PluginManifest | null> {
  const manifestPath = join(root, 'plugin.json')
  if (!(await pathExists(manifestPath))) return null
  const raw = await readFile(manifestPath, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) return null
  // The $schema field is informational; we do not gate on it strictly because
  // many Cursor-era packages ship without the agent-plugins.org schema URL.
  if (obj.$schema && !String(obj.$schema).startsWith(PLUGIN_SCHEMA_PREFIX)) {
    // Non-conforming schema URL — still accept the manifest, the bridge is
    // tolerant by design.
  }
  return obj as unknown as PluginManifest
}

/** Discover one plugin root if it has a valid plugin.json. */
export async function discoverPlugin(rootInput: string): Promise<DiscoveredPlugin | null> {
  const root = resolve(rootInput)
  const st = await stat(root).catch(() => null)
  if (!st?.isDirectory()) return null
  const manifest = await readManifest(root)
  if (!manifest) return null
  const skillsDir = join(root, 'skills')
  const mcpPath = join(root, 'mcp.json')
  return {
    root,
    manifest,
    skillsDir: (await pathExists(skillsDir)) ? skillsDir : null,
    mcpPath: (await pathExists(mcpPath)) ? mcpPath : null,
  }
}

/**
 * Resolve configured roots + scan plugin directories.
 * Dedupes by absolute path. Invalid entries are skipped.
 */
export async function discoverPlugins(
  pluginRoots: string[],
  pluginsDirs: string[],
): Promise<DiscoveredPlugin[]> {
  const seen = new Set<string>()
  const out: DiscoveredPlugin[] = []

  const consider = async (root: string): Promise<void> => {
    const key = resolve(root).toLowerCase()
    if (seen.has(key)) return
    const plugin = await discoverPlugin(root)
    if (!plugin) return
    seen.add(key)
    out.push(plugin)
  }

  for (const root of pluginRoots) {
    await consider(expandHome(root))
  }

  for (const dir of pluginsDirs) {
    const abs = resolve(expandHome(dir))
    if (!(await pathExists(abs))) continue
    const entries = await readdir(abs, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      await consider(join(abs, entry.name))
    }
  }

  return out
}
