/**
 * Wire types shared across the bridge modules.
 * @module dsh-agent-plugin-bridge/types
 */

/** Agent Plugins 1.0 plugin.json (subset used by the bridge). */
export interface PluginManifest {
  $schema?: string
  name: string
  version?: string
  description?: string
}

/** mcp.json server entry (agent-plugins.org). */
export type McpServerConfig =
  | {
      type: 'stdio'
      command: string
      args?: string[]
      env?: Record<string, string>
      cwd?: string
    }
  | {
      type: 'streamable-http' | 'sse' | 'http'
      url: string
      headers?: Record<string, string>
    }

export interface McpManifest {
  $schema?: string
  mcpServers: Record<string, McpServerConfig>
}

export interface DiscoveredPlugin {
  root: string
  manifest: PluginManifest
  skillsDir: string | null
  mcpPath: string | null
}

export interface ParsedSkill {
  name: string
  description: string
  content: string
  path: string
  directory: string
}
