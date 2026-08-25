/**
 * dsh-agent-plugin-bridge — generic Agent Plugins 1.0 → DeepSeek Harness bridge.
 *
 * Discovers any package with `plugin.json` and loads its `skills/` folders
 * into the host `skills` service and its `mcp.json` (or any standalone mcp.json)
 * into the host MCP client. No per-business branching.
 *
 * Forked from zoahdev/dsh-plugin-template; carries its runtime peer-version
 * guard and its verification posture.
 * @module dsh-agent-plugin-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createRequire } from 'node:module'
import { satisfiesCaret } from './version.js'
import { discoverPlugins } from './discover.js'
import { registerPluginMcp, registerStandaloneMcpJson } from './mcp.js'
import { registerPluginSkills } from './skills.js'

export const name = 'dsh-agent-plugin-bridge'

export const inject = ['skills', 'tools']

/** Peer range this plugin is tested against and guards at runtime. */
export const TESTED_PEER_RANGE = '^0.1.0-rc.6'

const require = createRequire(import.meta.url)

/** Resolve the dsh-tools version the plugin is actually linked against. */
export function resolvedDshToolsVersion(): string {
  try {
    const pkg = require('@deepseek-ai/dsh-tools/package.json') as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unresolved'
  }
}

/**
 * Turn a silent peer mismatch into a loud, actionable load error.
 *
 * pnpm (default config) and some npm setups can link an older RC into the
 * plugin's peer slot without failing the install (see README Troubleshooting).
 * The plugin refuses to load in that case instead of failing at runtime later.
 */
export function assertPeerCompatible(): void {
  const version = resolvedDshToolsVersion()
  if (!satisfiesCaret(version, TESTED_PEER_RANGE)) {
    throw new Error(
      `dsh-agent-plugin-bridge: resolved @deepseek-ai/dsh-tools ${version}, but this plugin is tested with `
      + `${TESTED_PEER_RANGE}. Upgrade DeepSeek Harness to 0.1.0-rc.6 or later, then reinstall this plugin. `
      + 'See the Troubleshooting section in the README.',
    )
  }
}

/** Plugin configuration supplied through cordis.yml. */
export interface Config {
  /** Explicit Agent Plugin package roots (directories containing plugin.json). */
  pluginRoots: string[]
  /** Directories whose immediate children are scanned for plugin.json. */
  pluginsDirs: string[]
  /**
   * Extra standalone mcp.json files outside Agent Plugin packages.
   * Typical: `~/.cursor/mcp.json`.
   */
  mcpJsonPaths: string[]
  /** Load each discovered plugin's own mcp.json (often env-templated). */
  loadPluginMcp: boolean
  /** Abort bridge activation on the first MCP failure. */
  failOnMcpError: boolean
  /** Provider label prefix written into the skills registry. */
  skillProviderLabel: string
}

/** Schemastery schema with defaults. */
export const Config: Schema<Config> = Schema.object({
  pluginRoots: Schema.array(String).default([]),
  pluginsDirs: Schema.array(String).default([]),
  mcpJsonPaths: Schema.array(String).default([]),
  loadPluginMcp: Schema.boolean().default(true),
  failOnMcpError: Schema.boolean().default(false),
  skillProviderLabel: Schema.string().default('agent-plugin'),
})

export interface BridgeSummary {
  plugins: number
  skills: number
  mcpServers: number
}

/**
 * The core loader, exported for tests and integration scripts so they can
 * exercise it without a full dsh host context.
 */
export async function runBridge(ctx: Context, config: Config): Promise<BridgeSummary> {
  const plugins = await discoverPlugins(config.pluginRoots, config.pluginsDirs)

  let skills = 0
  let mcps = 0

  for (const plugin of plugins) {
    const line = `[agent-plugin-bridge] load ${plugin.manifest.name}@${plugin.manifest.version ?? '?'} from ${plugin.root}`
    console.log(line)
    ctx.logger?.info?.(line)
    skills += await registerPluginSkills(ctx, plugin, config.skillProviderLabel)
    if (config.loadPluginMcp) {
      mcps += await registerPluginMcp(ctx, plugin, config.failOnMcpError)
    }
  }

  for (const mcpPath of config.mcpJsonPaths) {
    mcps += await registerStandaloneMcpJson(ctx, mcpPath, config.failOnMcpError)
  }

  if (plugins.length === 0 && config.mcpJsonPaths.length === 0) {
    const msg = '[agent-plugin-bridge] no Agent Plugins or mcpJsonPaths configured'
    console.warn(msg)
    ctx.logger?.warn?.(msg)
  }

  const summary = `[agent-plugin-bridge] done: plugins=${plugins.length} skills=${skills} mcpServers=${mcps}`
  console.log(summary)
  ctx.logger?.info?.(summary)

  return { plugins: plugins.length, skills, mcpServers: mcps }
}

/**
 * Cordis entrypoint. Awaits `runBridge` so ctx.effect / ctx.plugin calls
 * inside it land while the cordis fiber is still active.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  assertPeerCompatible()

  const summary = await runBridge(ctx, config)

  ctx.tools.register(defineTool({
    name: 'bridge_summary',
    description:
      'Return a summary of what dsh-agent-plugin-bridge loaded on startup: '
      + 'discovered Agent Plugins, registered skills, and registered MCP servers.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          plugins: { type: 'number', required: true },
          skills: { type: 'number', required: true },
          mcpServers: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, _exec) {
      return summary
    },
    presentCall: () => ({
      card: 'generic',
      title: 'Bridge load summary',
      kind: 'other',
      rawInput: {},
    }),
  }))
}
