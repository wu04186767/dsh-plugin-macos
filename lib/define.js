/**
 * Minimal zero-dependency tool builder for dsh-plugin-macos.
 *
 * It produces the same raw ToolDefinition shape the dsh-tools registry accepts:
 * a raw JSON Schema subset for parameters, an output schema plus renderer, and
 * an execute function. Keeping the builder local means the plugin has no
 * runtime dependencies and installs from any checkout without a build step.
 */

const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean'])

function toJsonSchema(spec) {
  const properties = {}
  const required = []
  for (const [key, def] of Object.entries(spec)) {
    if (!SCALAR_TYPES.has(def.type)) throw new Error('unsupported parameter type for ' + key + ': ' + def.type)
    const node = { type: def.type }
    if (def.description) node.description = def.description
    if (def.enum) node.enum = [...def.enum]
    properties[key] = node
    if (def.required) required.push(key)
  }
  const schema = { type: 'object', properties, additionalProperties: false }
  if (required.length > 0) schema.required = required
  return schema
}

function validateArgs(spec, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('invalid arguments: expected a JSON object')
  }
  const problems = []
  for (const [key, def] of Object.entries(spec)) {
    const value = args[key]
    if (value === undefined) {
      if (def.required) problems.push('missing required property "' + key + '"')
      continue
    }
    const typeOk =
      def.type === 'string' ? typeof value === 'string'
      : def.type === 'boolean' ? typeof value === 'boolean'
      : def.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : Number.isInteger(value)
    if (!typeOk) problems.push('property "' + key + '" must be a ' + def.type)
    else if (def.enum && !def.enum.includes(value)) problems.push('property "' + key + '" must be one of ' + def.enum.join(', '))
  }
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(spec, key)) problems.push('unknown property "' + key + '"')
  }
  if (problems.length > 0) throw new Error('invalid arguments: ' + problems.join('; '))
}

export function defineTool(options) {
  const spec = options.parameters ?? {}
  return {
    name: options.name,
    description: options.description,
    parameters: toJsonSchema(spec),
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const normalized = args ?? {}
      validateArgs(spec, normalized)
      return options.execute(normalized, exec)
    },
  }
}
