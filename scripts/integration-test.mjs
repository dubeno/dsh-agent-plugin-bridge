#!/usr/bin/env node
/**
 * Packaged integration + real runtime invocation smoke test.
 *
 * Installs the ACTUAL pnpm-packed tarball into a fresh project, loads the
 * installed plugin bundle, runs the real apply() / ctx.tools.register path,
 * invokes the `bridge_summary` tool against a host context that has the
 * `skills` service, and asserts every step.
 *
 * Two scenarios:
 *   - happy: dsh-tools ^0.1.0-rc.6 → apply succeeds, tool registers
 *   - guard: dsh-tools 0.1.0-rc.3 → apply throws the peer-version error
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tgz = path.resolve(process.argv[2] ?? path.join(root, 'dsh-agent-plugin-bridge-0.1.0.tgz'))

if (!existsSync(tgz)) {
  console.error(`[integration] missing tarball: ${tgz}`)
  process.exit(1)
}

function runPnpm(args, cwd) {
  if (process.platform === 'win32') {
    return spawnSync(`pnpm ${args.join(' ')}`, { cwd, stdio: 'inherit', shell: true })
  }
  return spawnSync('pnpm', args, { cwd, stdio: 'inherit' })
}

function makeHostProject(dir, dshToolsVersion) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'dsh-bridge-integration-host',
        private: true,
        version: '1.0.0',
        dependencies: {
          '@deepseek-ai/cordis': '^4.0.1',
          '@deepseek-ai/dsh-tools': dshToolsVersion,
          '@deepseek-ai/dsh-mcp-client': '^0.1.0-rc.6',
          '@deepseek-ai/schemastery': '^3.18.1',
          'dsh-agent-plugin-bridge': `file:${tgz.replaceAll('\\', '/')}`,
        },
      },
      null,
      2,
    ),
  )
}

async function scenarioHappy() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-bridge-happy-'))
  makeHostProject(dir, '0.1.0-rc.6')
  console.log('[integration:happy] installing packed tarball into fresh project (dsh-tools 0.1.0-rc.6)...')
  const install = runPnpm(['install'], dir)
  if (install.status !== 0) {
    console.error('[integration:happy] pnpm install failed')
    process.exit(1)
  }

  const pluginIndex = path.join(dir, 'node_modules', 'dsh-agent-plugin-bridge', 'lib', 'index.js')
  if (!existsSync(pluginIndex)) {
    throw new Error('packed plugin entry lib/index.js missing after install')
  }

  console.log('[integration:happy] loading packed plugin bundle...')
  const plugin = await import(pathToFileURL(pluginIndex).href)
  if (plugin.name !== 'dsh-agent-plugin-bridge') {
    throw new Error(`unexpected plugin name: ${plugin.name}`)
  }
  if (plugin.TESTED_PEER_RANGE !== '^0.1.0-rc.6') {
    throw new Error(`unexpected TESTED_PEER_RANGE: ${plugin.TESTED_PEER_RANGE}`)
  }

  const registered = []
  const skillsRegistered = []
  const info = []
  const warn = []
  const effects = []
  const ctx = {
    state: {},
    logger: {
      info: (...a) => info.push(a.join(' ')),
      warn: (...a) => warn.push(a.join(' ')),
    },
    effect: (fn) => { effects.push(fn); return fn() },
    tools: {
      register: (definition) => {
        registered.push(definition)
        return () => {}
      },
    },
    plugin: () => () => {},
    get: (key) => {
      if (key === 'skills') {
        return {
          register: (s) => { skillsRegistered.push(s); return () => {} },
        }
      }
      return undefined
    },
  }

  console.log('[integration:happy] calling apply(ctx, config) through the real registration path...')
  plugin.apply(ctx, {
    pluginRoots: [],
    pluginsDirs: [],
    mcpJsonPaths: [],
    loadPluginMcp: false,
    failOnMcpError: false,
    skillProviderLabel: 'agent-plugin',
  })

  const summaryTool = registered.find(d => d?.name === 'bridge_summary')
  if (summaryTool === undefined) {
    throw new Error('bridge_summary tool was not registered via apply/ctx.tools.register')
  }

  // Give the async runBridge() a tick to finish (it is awaited on event loop).
  await new Promise(r => setTimeout(r, 50))

  console.log('[integration:happy] executing the real bridge_summary handler...')
  const result = await summaryTool.execute({}, { signal: new AbortController().signal })
  if (!result || typeof result.plugins !== 'number') {
    throw new Error(`unexpected canonical result: ${JSON.stringify(result)}`)
  }

  console.log('[integration:happy] rendering through the real output.render...')
  const blocks = summaryTool.output.render({}, result)
  const text = blocks.map(b => b.text ?? '').join('\n')
  if (!text.includes('"plugins"')) {
    throw new Error(`render output missing plugins field: ${JSON.stringify(text)}`)
  }

  console.log('PASS [happy] packed artifact loaded, bridge_summary registered, handler executed, render asserted')
  console.log('PASS [happy] result:', JSON.stringify(result))
  rmSync(dir, { recursive: true, force: true })
}

async function scenarioGuard() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-bridge-guard-'))
  makeHostProject(dir, '0.1.0-rc.3')
  console.log('[integration:guard] installing packed tarball into fresh project (dsh-tools 0.1.0-rc.3)...')
  const install = runPnpm(['install'], dir)
  if (install.status !== 0) {
    console.error('[integration:guard] pnpm install failed')
    process.exit(1)
  }

  const pluginIndex = path.join(dir, 'node_modules', 'dsh-agent-plugin-bridge', 'lib', 'index.js')
  if (!existsSync(pluginIndex)) {
    throw new Error('packed plugin entry lib/index.js missing after install')
  }

  console.log('[integration:guard] loading packed plugin bundle...')
  const plugin = await import(pathToFileURL(pluginIndex).href)

  let threw = false
  const ctx = {
    state: {},
    logger: { info: () => {}, warn: () => {} },
    effect: () => undefined,
    tools: { register: () => () => {} },
    plugin: () => () => {},
    get: () => undefined,
  }
  try {
    plugin.apply(ctx, {
      pluginRoots: [],
      pluginsDirs: [],
      mcpJsonPaths: [],
      loadPluginMcp: false,
      failOnMcpError: false,
      skillProviderLabel: 'agent-plugin',
    })
  } catch (error) {
    threw = true
    if (!String(error instanceof Error ? error.message : error).includes('tested with ^0.1.0-rc.6')) {
      throw new Error(`guard threw an unexpected error: ${String(error)}`)
    }
  }
  if (!threw) {
    throw new Error('runtime guard did not reject the incompatible dsh-tools version')
  }
  console.log('PASS [guard] runtime guard rejected incompatible @deepseek-ai/dsh-tools 0.1.0-rc.3')
  rmSync(dir, { recursive: true, force: true })
}

await scenarioHappy()
await scenarioGuard()
