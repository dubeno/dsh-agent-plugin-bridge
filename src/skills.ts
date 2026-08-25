/**
 * Skill discovery: every subdirectory of `plugin.skills/` containing
 * a `SKILL.md` is registered into the host `skills` service.
 * @module dsh-agent-plugin-bridge/skills
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { DiscoveredPlugin, ParsedSkill } from './types.js'

/** Minimal YAML-ish frontmatter: key: value and folded `>-` / `>` blocks. */
export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const trimmed = raw.replace(/^\uFEFF/, '')
  if (!trimmed.startsWith('---')) {
    return { meta: {}, body: trimmed }
  }
  const end = trimmed.indexOf('\n---', 3)
  if (end < 0) return { meta: {}, body: trimmed }
  const fm = trimmed.slice(3, end).replace(/^\r?\n/, '')
  // After the closing `---` line: skip one optional blank line, then trim any
  // trailing newline so callers don't have to.
  const body = trimmed.slice(end + 4).replace(/^\r?\n/, '').replace(/\r?\n$/, '')
  const meta: Record<string, string> = {}
  const lines = fm.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) {
      i += 1
      continue
    }
    const key = m[1]
    let val = m[2].trim()
    if (val === '>' || val === '>-' || val === '|' || val === '|-') {
      const parts: string[] = []
      i += 1
      while (i < lines.length && (/^\s+/.test(lines[i]) || lines[i].trim() === '')) {
        parts.push(lines[i].replace(/^\s+/, ''))
        i += 1
      }
      meta[key] = parts.join(' ').trim()
      continue
    }
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    meta[key] = val
    i += 1
  }
  return { meta, body }
}

async function loadSkillFile(skillDir: string, skillFolder: string): Promise<ParsedSkill | null> {
  const path = join(skillDir, skillFolder, 'SKILL.md')
  try {
    const raw = await readFile(path, 'utf8')
    const { meta, body } = parseFrontmatter(raw)
    const name = (meta.name || skillFolder).trim()
    const description = (meta.description || name).trim()
    if (!name) return null
    return {
      name,
      description,
      content: body.trim() || description,
      path,
      directory: join(skillDir, skillFolder),
    }
  } catch {
    return null
  }
}

export interface SkillsServiceLike {
  register(skill: {
    name: string
    description: string
    content: string
    source: string
    provider: string
    path: string
    resourceBase: { kind: 'directory'; path: string }
  }): () => void
}

/** Register every skill folder from one Agent Plugin into the host skills service. */
export async function registerPluginSkills(
  ctx: Context,
  plugin: DiscoveredPlugin,
  providerLabel: string,
): Promise<number> {
  if (!plugin.skillsDir) return 0
  const skills = ctx.get('skills') as SkillsServiceLike | undefined
  if (!skills) {
    const msg = `[agent-plugin-bridge] skills service missing; skip ${plugin.manifest.name}`
    console.warn(msg)
    ctx.logger?.warn?.(msg)
    return 0
  }

  const entries = await readdir(plugin.skillsDir, { withFileTypes: true })
  let count = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skill = await loadSkillFile(plugin.skillsDir, entry.name)
    if (!skill) continue

    const dispose = skills.register({
      name: skill.name,
      description: skill.description,
      content: skill.content,
      source: 'agent-plugin-bridge',
      provider: `${providerLabel}:${plugin.manifest.name}`,
      path: skill.path,
      resourceBase: { kind: 'directory', path: skill.directory },
    })
    ctx.effect(() => dispose, `agent-plugin-skill:${plugin.manifest.name}:${skill.name}`)
    count += 1
    const line = `[agent-plugin-bridge] skill ${skill.name} <- ${plugin.manifest.name}`
    console.log(line)
    ctx.logger?.info?.(line)
  }
  return count
}
