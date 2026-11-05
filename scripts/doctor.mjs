#!/usr/bin/env node
/**
 * Permission and capability health check for dsh-plugin-macos.
 *
 * Exercises every permission-dependent tool once and reports which ones macOS
 * currently allows. Run it from a checkout:
 *
 *   node scripts/doctor.mjs
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import * as mac from '../lib/tools.js'

function parse(value) {
  try {
    return JSON.parse(value)
  } catch {
    return { ok: false, error: String(value) }
  }
}

const checks = []

async function check(name, fn, hint) {
  let result
  try {
    result = parse(await fn())
  } catch (error) {
    result = { ok: false, error: error.message }
  }
  checks.push({ name, ok: result.ok === true, detail: result.ok ? '' : String(result.error || '').slice(0, 140), hint })
}

await check('system info', () => mac.systemInfo())
await check('Automation: System Events (dark mode)', () => mac.darkMode({ action: 'get' }), 'System Settings > Privacy & Security > Automation > System Events')
await check('Automation: Finder (front window path)', () => mac.finderPath(), 'System Settings > Privacy & Security > Automation > Finder')
await check('Automation: Safari (tabs)', () => mac.safariTabs(), 'System Settings > Privacy & Security > Automation > Safari')
await check('Safari JavaScript from Apple Events', () => mac.safariJavaScript({ script: '1 + 1' }), 'Safari > Settings > Developer > Allow JavaScript from Apple Events')

const shotPath = path.join(os.tmpdir(), 'dsh-plugin-macos-doctor.png')
await check('Screen Recording (screenshot)', () => mac.screenshot({ path: shotPath }), 'System Settings > Privacy & Security > Screen Recording')
try { fs.rmSync(shotPath, { force: true }) } catch {}

await check('keep-awake start', () => mac.keepAwakeStart())
await check('keep-awake stop', () => mac.keepAwakeStop())

const width = checks.reduce((max, entry) => Math.max(max, entry.name.length), 0)
let failed = 0
console.log('dsh-plugin-macos health check\n')
for (const entry of checks) {
  const mark = entry.ok ? 'OK  ' : 'FAIL'
  console.log(mark + '  ' + entry.name.padEnd(width) + (entry.ok ? '' : '  ' + entry.detail))
  if (!entry.ok) {
    failed += 1
    if (entry.hint) console.log(' '.repeat(6) + '-> ' + entry.hint)
  }
}
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed')
process.exitCode = failed === 0 ? 0 : 1
