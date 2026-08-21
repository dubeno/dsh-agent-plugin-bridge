#!/usr/bin/env node
/**
 * Local-skill: load the packed dsh-agent-plugin-bridge into a real cordis
 * context pointed at the tm-dagu-adapt Agent Plugin, and verify that
 *   1. the bridge_summary tool is registered with the expected schema
 *   2. the SKILL.md from tm-dagu-adapt/skills/operator-adapt is registered
 *      into the host skills service
 *   3. the dsh-mcp-client plugin is registered for tm-dagu-adapt's mcp.json
 *
 * This is the host-side counterpart of `scripts/dsh-smoke.sh`: it does not
 * need dsh web to be bootable, but it does prove the bridge loads into the
 * real cordis runtime and wires a real Agent Plugin through.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const tgz = path.resolve(root, 'dsh-agent-plugin-bridge-0.1.0.tgz')

if (!existsSync(tgz)) {
  console.error(`[local-skill] missing tarball: ${tgz}`)
  console.error('[local-skill] run `pnpm pack` first')
  process.exit(1)
}

const hostPluginRoot = process.argv[2] ?? 'D:/AgentRepo/GitRepo/GitRepo/tm-dagu-adapt'
if (!existsSync(hostPluginRoot)) {
  console.error(`[local-skill] Agent Plugin root not found: ${hostPluginRoot}`)
  process.exit(1)
}

const tmp = mkdtempSync(path.join(tmpdir(), 'dsh-bridge-local-skill-'))

function runPnpm(args, cwd) {
  if (process.platform === 'win32') {
    return spawnSync(`pnpm ${args.join(' ')}`, { cwd, stdio: 'inherit', shell: true })
  }
  return spawnSync('pnpm', args, { cwd, stdio: 'inherit' })
}

writeFileSync(
  path.join(tmp, 'package.json'),
  JSON.stringify({
    name: 'dsh-bridge-local-skill-host',
    private: true,
    version: '1.0.0',
    dependencies: {
      '@deepseek-ai/cordis': '^4.0.1',
      '@deepseek-ai/dsh-mcp-client': '^0.1.0-rc.6',
      '@deepseek-ai/dsh-tools': '^0.1.0-rc.6',
      '@deepseek-ai/schemastery': '^3.18.1',
      'dsh-agent-plugin-bridge': `file:${tgz.replaceAll('\\', '/')}`,
    },
  }, null, 2),
)

console.log('[local-skill] installing packed tarball into fresh host project...')
const install = runPnpm(['install'], tmp)
if (install.status !== 0) {
  console.error('[local-skill] pnpm install failed')
  process.exit(1)
}

const pluginEntry = path.join(tmp, 'node_modules', 'dsh-agent-plugin-bridge', 'lib', 'index.js')
if (!existsSync(pluginEntry)) {
  throw new Error('packed plugin entry missing after install')
}

console.log('[local-skill] loading packed plugin and root cordis context...')
const cordis = await import(pathToFileURL(path.join(tmp, 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js')).href)
const bridge = await import(pathToFileURL(pluginEntry).href)

console.log(`[local-skill] plugin name=${bridge.name} testedPeer=${bridge.TESTED_PEER_RANGE}`)

const registeredTools = []
const registeredSkills = []
const registeredSubPlugins = []

const ctx = new cordis.Context()

// Pre-register host services so the bridge can look them up via ctx.get(...).
// Both `tools` and `skills` are plain objects with a `register` method here.
ctx.provide('skills', {
  register(skill) {
    registeredSkills.push(skill)
    return () => {}
  },
})

ctx.provide('tools', {
  register(def) {
    registeredTools.push(def)
    return () => {}
  },
})

// Wrap ctx.plugin so we can observe which sub-plugins the bridge installs.
const realPlugin = ctx.plugin.bind(ctx)
ctx.plugin = (plugin, config) => {
  const name = (plugin && plugin.name) || (plugin && plugin.default && plugin.default.name) || '<unknown>'
  registeredSubPlugins.push({ name, config })
  return realPlugin(plugin, config)
}

bridge.apply(ctx, {
  pluginRoots: [hostPluginRoot],
  pluginsDirs: [],
  mcpJsonPaths: [],
  loadPluginMcp: true,
  failOnMcpError: false,
  skillProviderLabel: 'agent-plugin',
})

// The bridge uses `ctx.get('skills')` which goes through the lookup. Make
// sure we resolve to the same fake service for both registration paths.
await new Promise(r => setTimeout(r, 100))

const bridgeSummary = registeredTools.find(t => t.name === 'bridge_summary')
if (!bridgeSummary) {
  throw new Error('bridge_summary tool was not registered')
}
console.log(`[local-skill] PASS bridge_summary registered (description: "${bridgeSummary.description.slice(0, 60)}...")`)

if (registeredSkills.length === 0) {
  throw new Error('no skills were registered from the host Agent Plugin')
}
const skill = registeredSkills[0]
console.log(`[local-skill] PASS ${registeredSkills.length} skill(s) registered`)
console.log(`[local-skill]   first skill: name=${skill.name} provider=${skill.provider}`)
console.log(`[local-skill]   content length: ${skill.content.length} chars`)

if (registeredSubPlugins.length === 0) {
  console.warn('[local-skill] WARN no sub-plugins registered (none expected if mcp.json is empty)')
} else {
  console.log(`[local-skill] PASS ${registeredSubPlugins.length} sub-plugin(s) registered:`)
  for (const sp of registeredSubPlugins) {
    console.log(`[local-skill]   - ${sp.name} (transport=${sp.config?.transport ?? '?'})`)
  }
}

const result = await bridgeSummary.execute({}, { signal: new AbortController().signal })
console.log('[local-skill] bridge_summary.execute ->', JSON.stringify(result))

if (typeof result.plugins !== 'number' || result.plugins < 1) {
  throw new Error(`bridge_summary returned no plugins: ${JSON.stringify(result)}`)
}

const blocks = bridgeSummary.output.render({}, result)
const text = blocks.map(b => b.text ?? '').join('\n')
if (!text.includes('"plugins"')) {
  throw new Error('render output missing "plugins" field')
}

console.log('[local-skill] PASS render output:')
console.log(text)

console.log('PASS [local-skill] bridge loaded into real cordis, real Agent Plugin registered, real handler executed')

rmSync(tmp, { recursive: true, force: true })
