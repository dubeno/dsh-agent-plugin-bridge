/**
 * MCP server registration. Loads both Agent-Plugin-bundled mcp.json
 * and standalone mcp.json paths (e.g. Cursor user-level `~/.cursor/mcp.json`).
 * @module dsh-agent-plugin-bridge/mcp
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { expandArgs, expandPlaceholders, expandRecord } from './expand.js'
import type { DiscoveredPlugin, McpManifest, McpServerConfig } from './types.js'

function sanitizeServerName(owner: string, serverKey: string): string {
  // Stable, model-friendly: keep the original serverKey. Falls back to
  // `<owner>-mcp` only if the key itself is empty.
  const trimmed = String(serverKey ?? '').trim()
  return trimmed.length > 0 ? trimmed : `${owner}-mcp`
}

async function ownerDataDir(owner: string): Promise<string> {
  const base = join(homedir(), '.dsh', 'agent-plugins', owner)
  await mkdir(base, { recursive: true })
  return base
}

function mapServer(
  owner: string,
  root: string,
  serverKey: string,
  server: McpServerConfig & { type?: string; command?: string; url?: string },
  vars: Record<string, string>,
  failOnMcpError: boolean,
) {
  const serverName = sanitizeServerName(owner, serverKey)
  const raw = server as Record<string, unknown>

  // Agent Plugins 1.0 requires type; Cursor mcp.json often omits it when command is set.
  const type = (typeof server.type === 'string' ? server.type : undefined)
    ?? (typeof raw.command === 'string' && raw.command ? 'stdio' : undefined)
    ?? (typeof raw.url === 'string' && raw.url ? 'streamable-http' : undefined)

  if (type === 'stdio') {
    const command = expandPlaceholders(String(raw.command ?? ''), vars)
    if (!command) {
      throw new Error(`mcp ${serverKey}: empty command after env expansion`)
    }
    return {
      transport: 'stdio' as const,
      serverName,
      command,
      args: expandArgs(Array.isArray(raw.args) ? raw.args as string[] : undefined, vars),
      env: expandRecord((raw.env as Record<string, string> | undefined) ?? undefined, vars),
      cwd: typeof raw.cwd === 'string' ? expandPlaceholders(raw.cwd, vars) : root,
      toolCallTimeoutMs: 60_000,
      failOnStartupError: failOnMcpError,
    }
  }

  if (type === 'streamable-http' || type === 'sse' || type === 'http') {
    const url = expandPlaceholders(String(raw.url ?? ''), vars)
    if (!url) throw new Error(`mcp ${serverKey}: empty url after env expansion`)
    return {
      transport: 'streamable-http' as const,
      serverName,
      url,
      headers: expandRecord((raw.headers as Record<string, string> | undefined) ?? undefined, vars),
      toolCallTimeoutMs: 60_000,
      failOnStartupError: failOnMcpError,
    }
  }

  throw new Error(`mcp ${serverKey}: unsupported or missing type`)
}

async function registerMcpFile(
  ctx: Context,
  opts: {
    owner: string
    root: string
    mcpPath: string
    failOnMcpError: boolean
  },
): Promise<number> {
  let manifest: McpManifest
  try {
    manifest = JSON.parse(await readFile(opts.mcpPath, 'utf8')) as McpManifest
  } catch (err) {
    const msg = `[agent-plugin-bridge] bad mcp.json ${opts.mcpPath}: ${err as Error}`
    console.warn(msg)
    ctx.logger?.warn?.(msg)
    return 0
  }

  const servers = manifest.mcpServers ?? {}
  const dataDir = await ownerDataDir(opts.owner)
  const vars: Record<string, string> = {
    PLUGIN_ROOT: opts.root,
    PLUGIN_DATA: dataDir,
  }

  let ok = 0
  for (const [key, server] of Object.entries(servers)) {
    try {
      const config = mapServer(opts.owner, opts.root, key, server, vars, opts.failOnMcpError)
      ctx.plugin(mcpClient, config)
      ok += 1
      const line = `[agent-plugin-bridge] mcp ${key} -> ${config.serverName} (${opts.owner})`
      console.log(line)
      ctx.logger?.info?.(line)
    } catch (err) {
      const msg = `[agent-plugin-bridge] skip mcp ${key} in ${opts.owner}: ${err as Error}`
      console.warn(msg)
      ctx.logger?.warn?.(msg)
      if (opts.failOnMcpError) throw err
    }
  }
  return ok
}

/** Load an Agent Plugin package mcp.json. */
export async function registerPluginMcp(
  ctx: Context,
  plugin: DiscoveredPlugin,
  failOnMcpError: boolean,
): Promise<number> {
  if (!plugin.mcpPath) return 0
  return registerMcpFile(ctx, {
    owner: plugin.manifest.name,
    root: plugin.root,
    mcpPath: plugin.mcpPath,
    failOnMcpError,
  })
}

/**
 * Load standalone mcp.json files (e.g. Cursor user-level ~/.cursor/mcp.json).
 * Same wire format as Agent Plugins / Cursor; not tied to a plugin package.
 */
export async function registerStandaloneMcpJson(
  ctx: Context,
  mcpPathInput: string,
  failOnMcpError: boolean,
): Promise<number> {
  const mcpPath = resolve(mcpPathInput)
  const root = dirname(mcpPath)
  const owner = 'cursor-mcp'
  return registerMcpFile(ctx, { owner, root, mcpPath, failOnMcpError })
}
