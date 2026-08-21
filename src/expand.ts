/**
 * Expand `${VAR}` placeholders per Agent Plugins env rules.
 * PLUGIN_ROOT and PLUGIN_DATA are injected by the caller.
 * Unknown vars fall back to the process environment; missing values expand to "".
 * @module dsh-agent-plugin-bridge/expand
 */

export function expandPlaceholders(value: string, vars: Record<string, string>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return vars[name] ?? ''
    }
    return process.env[name] ?? ''
  })
}

export function expandRecord(
  record: Record<string, string> | undefined,
  vars: Record<string, string>,
): Record<string, string> {
  if (!record) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(record)) {
    out[k] = expandPlaceholders(v, vars)
  }
  return out
}

export function expandArgs(args: string[] | undefined, vars: Record<string, string>): string[] {
  return (args ?? []).map(a => expandPlaceholders(a, vars))
}
