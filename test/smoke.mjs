/**
 * Local smoke test: registers every tool with a mock registry, then exercises
 * the read-only tools against this Mac. Run with: node test/smoke.mjs
 */
import { apply } from '../index.js'

const tools = new Map()
const ctx = {
  tools: { register: (definition) => tools.set(definition.name, definition) },
  effect: (fn) => { const dispose = fn(); return dispose },
}

apply(ctx)

const names = [...tools.keys()]
console.log('registered tools:', names.length)
console.log(names.join(', '))

const expected = [
  'macos_notify', 'macos_say', 'macos_clipboard_read', 'macos_clipboard_write',
  'macos_open', 'macos_screenshot', 'macos_info', 'macos_volume', 'macos_frontmost_app',
  'macos_keep_awake', 'macos_applescript', 'macos_shortcuts',
  'safari_tabs', 'safari_open', 'safari_page_text', 'safari_javascript',
  'macos_dark_mode', 'macos_network', 'macos_processes', 'macos_spotlight', 'macos_finder_path',
]
const missing = expected.filter((n) => !tools.has(n))
if (missing.length) {
  console.error('MISSING TOOLS:', missing)
  process.exit(1)
}
for (const [name, definition] of tools) {
  if (!definition.description || !definition.parameters || !definition.output || typeof definition.execute !== 'function') {
    console.error('INVALID DEFINITION:', name)
    process.exit(1)
  }
}

async function check(name, args = {}) {
  const value = await tools.get(name).execute(args, {})
  const parsed = JSON.parse(value)
  console.log('  ' + name + ' ->', JSON.stringify(parsed).slice(0, 220))
  return parsed
}

console.log('\n-- live checks --')
await check('macos_info')
await check('macos_volume', { action: 'get' })
await check('macos_frontmost_app')
const clip = await check('macos_clipboard_read')
console.log('  clipboard chars:', String(clip.text ?? '').length)
await check('macos_shortcuts')
await check('safari_tabs')
await check('safari_page_text')
await check('macos_keep_awake', { action: 'start' })
await check('macos_keep_awake', { action: 'status' })
await check('macos_keep_awake', { action: 'stop' })
await check('macos_applescript', { script: 'return 1 + 1' })
await check('macos_dark_mode')
await check('macos_network')
await check('macos_processes', { sort: 'cpu', limit: 3 })
await check('macos_spotlight', { query: 'README.md', limit: 3 })
await check('macos_finder_path')
const shot = await check('macos_screenshot')
console.log('screenshot exists:', shot.ok, shot.path)
console.log('\nSMOKE OK')
