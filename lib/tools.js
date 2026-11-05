/**
 * Native macOS capabilities used by dsh-plugin-macos tools.
 * Every function returns a string (usually pretty JSON) so tool outputs stay
 * simple to render and safe to replay.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { run, runWithInput, osascript, asStr, permissionError } from './exec.js'

const APP = 'macOS'

function json(value) {
  return JSON.stringify(value, null, 2)
}

/* ------------------------------------------------------------------ */
/* Notifications, speech, dialogs                                      */
/* ------------------------------------------------------------------ */

export async function notify({ title = 'DeepSeek Harness', message = '', subtitle = '', sound = '' }) {
  const script = [
    'on run argv',
    'set theTitle to item 1 of argv',
    'set theMessage to item 2 of argv',
    'set theSubtitle to item 3 of argv',
    'set theSound to item 4 of argv',
    'if theSound is "" then',
    'display notification theMessage with title theTitle subtitle theSubtitle',
    'else',
    'display notification theMessage with title theTitle subtitle theSubtitle sound name theSound',
    'end if',
    'end run',
  ].join('\n')
  const result = await osascript(script, { argv: [title, message, subtitle, sound] })
  if (!result.ok) return json({ ok: false, error: (result.stderr || 'notification failed').trim() })
  return json({ ok: true, title, message })
}

export async function say({ text, voice = '', rate }) {
  const args = []
  if (voice) args.push('-v', voice)
  if (typeof rate === 'number' && Number.isFinite(rate)) args.push('-r', String(Math.round(rate)))
  args.push(text)
  const result = await run('/usr/bin/say', args)
  return json({ ok: result.ok, error: result.ok ? undefined : result.stderr.trim() })
}

export async function frontmostApp() {
  const result = await osascript([
    'tell application "System Events"',
    'set frontApp to name of first application process whose frontmost is true',
    'end tell',
    'return frontApp',
  ])
  const blocked = permissionError(result, 'System Events')
  if (!result.ok || blocked) return json({ ok: false, error: blocked || (result.stderr || '').trim() })
  return json({ ok: true, app: result.stdout.trim() })
}

/* ------------------------------------------------------------------ */
/* Clipboard                                                           */
/* ------------------------------------------------------------------ */

export async function clipboardRead() {
  const result = await run('/usr/bin/pbpaste')
  return json({ ok: result.ok, text: result.stdout, error: result.ok ? undefined : result.stderr.trim() })
}

export async function clipboardWrite({ text }) {
  const result = await runWithInput('/usr/bin/pbcopy', [], String(text))
  return json({ ok: result.ok, chars: String(text).length, error: result.ok ? undefined : result.stderr.trim() })
}

/* ------------------------------------------------------------------ */
/* Open apps, files and URLs                                           */
/* ------------------------------------------------------------------ */

export async function openTarget({ target = '', app = '' }) {
  const args = []
  if (app) args.push('-a', app)
  if (target) args.push(target)
  if (args.length === 0) return json({ ok: false, error: 'Provide target and/or app.' })
  const result = await run('/usr/bin/open', args)
  return json({ ok: result.ok, app: app || undefined, target: target || undefined, error: result.ok ? undefined : result.stderr.trim() })
}

/* ------------------------------------------------------------------ */
/* Screenshot                                                          */
/* ------------------------------------------------------------------ */

export async function screenshot({ path: targetPath = '', region = '' } = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = targetPath
    ? path.resolve(String(targetPath))
    : path.join(os.tmpdir(), `dsh-screenshot-${stamp}.png`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const args = ['-x']
  const match = /^\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)\s*$/.exec(String(region || ''))
  if (match) args.push('-R', match.slice(1, 5).join(','))
  args.push(file)
  const result = await run('/usr/sbin/screencapture', args, { timeoutMs: 30000 })
  if (!result.ok) return json({ ok: false, error: (result.stderr || 'screencapture failed').trim() })
  const info = fs.statSync(file)
  return json({ ok: true, path: file, bytes: info.size, region: match ? match.slice(1, 5).join(',') : undefined })
}

/* ------------------------------------------------------------------ */
/* System information                                                  */
/* ------------------------------------------------------------------ */

function parseBattery(text) {
  const percent = /(\d+)%/.exec(text)
  const charging = /AC Power|charging/i.test(text) ? 'ac' : /discharging/i.test(text) ? 'battery' : 'unknown'
  return { percent: percent ? Number(percent[1]) : null, source: charging }
}

export async function systemInfo() {
  const [sw, arch, host, up, battery, disk, mem] = await Promise.all([
    run('/usr/bin/sw_vers', ['-productVersion']),
    run('/usr/bin/uname', ['-m']),
    run('/bin/hostname'),
    run('/usr/bin/uptime'),
    run('/usr/bin/pmset', ['-g', 'batt']),
    run('/bin/df', ['-k', '/']),
    run('/usr/sbin/sysctl', ['-n', 'hw.memsize']),
  ])
  let diskInfo = null
  const diskLines = (disk.stdout || '').trim().split('\n')
  if (diskLines.length > 1) {
    const parts = diskLines[1].trim().split(/\s+/)
    // Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted
    if (parts.length >= 4) {
      const totalKb = Number(parts[1])
      const availableKb = Number(parts[3])
      if (Number.isFinite(totalKb) && Number.isFinite(availableKb)) {
        diskInfo = {
          totalGB: Math.round((totalKb / 1024 / 1024) * 10) / 10,
          availableGB: Math.round((availableKb / 1024 / 1024) * 10) / 10,
          usedPercent: Math.round((1 - availableKb / totalKb) * 100),
        }
      }
    }
  }
  return json({
    ok: true,
    macos: (sw.stdout || '').trim(),
    arch: (arch.stdout || '').trim(),
    hostname: (host.stdout || '').trim(),
    uptime: (up.stdout || '').trim(),
    battery: battery.ok ? parseBattery(battery.stdout) : null,
    disk: diskInfo,
    memoryGB: mem.ok ? Math.round(Number(mem.stdout.trim()) / 1024 / 1024 / 1024) : null,
  })
}

/* ------------------------------------------------------------------ */
/* Volume                                                              */
/* ------------------------------------------------------------------ */

export async function volume({ action = 'get', level } = {}) {
  if (action === 'set') {
    const n = Math.max(0, Math.min(100, Math.round(Number(level))))
    if (!Number.isFinite(n)) return json({ ok: false, error: 'level must be 0-100' })
    const result = await osascript([`set volume output volume ${n}`])
    return json({ ok: result.ok, level: n, error: result.ok ? undefined : result.stderr.trim() })
  }
  const result = await osascript(['output volume of (get volume settings)'])
  return json({ ok: result.ok, level: Number(result.stdout.trim()), error: result.ok ? undefined : result.stderr.trim() })
}

/* ------------------------------------------------------------------ */
/* Keep awake                                                          */
/* ------------------------------------------------------------------ */

let awakeChild = null
let awakeSince = null

export function keepAwakeStatus() {
  return json({ ok: true, active: !!awakeChild, pid: awakeChild?.pid ?? null, since: awakeSince })
}

export function keepAwakeStart() {
  if (awakeChild) return keepAwakeStatus()
  const child = spawn('/usr/bin/caffeinate', ['-dims'], { stdio: 'ignore' })
  awakeChild = child
  awakeSince = new Date().toISOString()
  child.on('exit', () => {
    if (awakeChild === child) {
      awakeChild = null
      awakeSince = null
    }
  })
  return json({ ok: true, active: true, pid: child.pid, since: awakeSince })
}

export function keepAwakeStop() {
  if (awakeChild) {
    awakeChild.kill()
    awakeChild = null
    awakeSince = null
  }
  return json({ ok: true, active: false })
}

export function stopAll() {
  if (awakeChild) {
    awakeChild.kill()
    awakeChild = null
    awakeSince = null
  }
}

/* ------------------------------------------------------------------ */
/* AppleScript / Shortcuts                                             */
/* ------------------------------------------------------------------ */

export async function appleScript({ script, language = 'applescript', timeoutMs = 30000 }) {
  const lang = language === 'javascript' || language === 'jxa' ? 'JavaScript' : 'AppleScript'
  const result = await osascript([script], { lang, timeoutMs })
  return json({
    ok: result.ok,
    code: result.code,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim() || undefined,
  })
}

export async function shortcuts({ name = '', input = '' } = {}) {
  if (!name) {
    const list = await run('/usr/bin/shortcuts', ['list'], { timeoutMs: 30000 })
    return json({ ok: list.ok, shortcuts: list.stdout.trim().split('\n').filter(Boolean) })
  }
  const args = ['run', name]
  if (input) args.push('--input-path', input)
  const result = await run('/usr/bin/shortcuts', args, { timeoutMs: 120000 })
  return json({ ok: result.ok, name, stdout: result.stdout.trim() || undefined, stderr: result.stderr.trim() || undefined })
}

/* ------------------------------------------------------------------ */
/* Safari                                                              */
/* ------------------------------------------------------------------ */

function safariTabsScript() {
  return [
    'tell application "Safari"',
    'if (count of windows) is 0 then return ""',
    'set output to ""',
    'set winIndex to 0',
    'repeat with w in windows',
    'set winIndex to winIndex + 1',
    'set tabIndex to 0',
    'repeat with t in tabs of w',
    'set tabIndex to tabIndex + 1',
    'set output to output & winIndex & "\t" & tabIndex & "\t" & (name of t) & "\t" & (URL of t) & "\n"',
    'end repeat',
    'end repeat',
    'set activeInfo to ""',
    'try',
    'set activeInfo to "ACTIVE\t" & (index of window 1) & "\t" & (index of current tab of window 1)',
    'end try',
    'return output & activeInfo',
    'end tell',
  ].join('\n')
}

export async function safariTabs() {
  const result = await osascript(safariTabsScript())
  if (!result.ok) return json({ ok: false, error: (result.stderr || '').trim() })
  const tabs = []
  let active = null
  for (const line of (result.stdout || '').split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts[0] === 'ACTIVE') {
      active = { window: Number(parts[1]), tab: Number(parts[2]) }
      continue
    }
    if (parts.length >= 4) {
      tabs.push({
        window: Number(parts[0]),
        tab: Number(parts[1]),
        title: parts[2],
        url: parts.slice(3).join('\t'),
      })
    }
  }
  return json({ ok: true, active, count: tabs.length, tabs })
}

export async function safariOpen({ url, newTab = true, activate = true }) {
  const script = ['tell application "Safari"']
  if (activate) script.push('activate')
  script.push('if (count of windows) is 0 then', `make new document with properties {URL:${asStr(url)}}`, 'else')
  if (newTab) {
    script.push('tell front window', `set current tab to (make new tab at end of tabs with properties {URL:${asStr(url)}})`, 'end tell')
  } else {
    script.push('tell front window', `set URL of current tab to ${asStr(url)}`, 'end tell')
  }
  script.push('end if', 'end tell')
  const result = await osascript(script.join('\n'))
  const blocked = permissionError(result, 'Safari')
  return json({ ok: result.ok, url, newTab, error: result.ok ? undefined : blocked || (result.stderr || '').trim() })
}

export async function safariPageText({ window_index = 1, tab_index } = {}) {
  // Safari scripts documents in front-window tab order; select the requested tab
  // by activating it only when a tab index is given, then read the front document.
  const lines = ['tell application "Safari"']
  if (tab_index) {
    lines.push(`set current tab of window ${Number(window_index)} to tab ${Number(tab_index)} of window ${Number(window_index)}`)
  }
  lines.push('set pageText to text of document 1', 'end tell', 'return pageText')
  const result = await osascript(lines.join('\n'), { timeoutMs: 30000 })
  const blocked = permissionError(result, 'Safari')
  if (!result.ok || blocked) return json({ ok: false, error: blocked || (result.stderr || '').trim() })
  return json({ ok: true, chars: result.stdout.length, text: result.stdout })
}

export async function safariJavaScript({ script }) {
  const result = await osascript([`tell application "Safari" to do JavaScript ${asStr(script)} in current tab of front window`], { timeoutMs: 30000 })
  const blocked = permissionError(result, 'Safari')
  if (blocked) return json({ ok: false, error: blocked })
  const text = (result.stderr || '').toLowerCase()
  if (!result.ok && text.includes('allow javascript from apple events')) {
    return json({
      ok: false,
      error: 'Safari requires "Allow JavaScript from Apple Events". Enable Safari > Settings > Developer > "Allow JavaScript from Apple Events", then retry.',
    })
  }
  return json({ ok: result.ok, result: result.stdout.trim() || undefined, error: result.ok ? undefined : (result.stderr || '').trim() })
}

/* ------------------------------------------------------------------ */
/* Appearance, network, processes, Spotlight, Finder                   */
/* ------------------------------------------------------------------ */

export async function darkMode({ action = 'get', enabled } = {}) {
  if (action === 'set') {
    const value = enabled === true || enabled === 'true'
    const result = await osascript([
      'tell application "System Events" to tell appearance preferences to set dark mode to ' + (value ? 'true' : 'false'),
    ])
    const blocked = permissionError(result, 'System Events')
    return json({ ok: result.ok && !blocked, darkMode: value, error: result.ok ? undefined : blocked || (result.stderr || '').trim() })
  }
  const result = await osascript(['tell application "System Events" to tell appearance preferences to get dark mode'])
  const blocked = permissionError(result, 'System Events')
  if (!result.ok || blocked) return json({ ok: false, error: blocked || (result.stderr || '').trim() })
  return json({ ok: true, darkMode: result.stdout.trim() === 'true' })
}

export async function networkInfo() {
  const route = await run('/sbin/route', ['-n', 'get', 'default'])
  const ifaceMatch = /interface:\s*(\S+)/.exec(route.stdout || '')
  const iface = ifaceMatch ? ifaceMatch[1] : 'en0'
  const [ip, host, ports] = await Promise.all([
    run('/usr/sbin/ipconfig', ['getifaddr', iface]),
    run('/bin/hostname'),
    run('/usr/sbin/networksetup', ['-listallhardwareports']),
  ])
  let wifiDevice = ''
  const portLines = (ports.stdout || '').split('\n')
  for (let i = 0; i < portLines.length; i++) {
    if (/Hardware Port:\s*Wi-Fi/i.test(portLines[i] || '')) {
      const dev = /Device:\s*(\S+)/.exec(portLines[i + 1] || '')
      if (dev) wifiDevice = dev[1]
    }
  }
  let wifi = null
  if (wifiDevice) {
    const wifiResult = await run('/usr/sbin/networksetup', ['-getairportnetwork', wifiDevice])
    const text = (wifiResult.stdout || '').trim()
    wifi = { device: wifiDevice, ssid: text.replace(/^Current Wi-Fi Network:\s*/, '') || null }
  }
  return json({
    ok: true,
    hostname: (host.stdout || '').trim(),
    interface: iface,
    ip: (ip.stdout || '').trim() || null,
    wifi,
  })
}

export async function processes({ sort = 'cpu', limit = 10 } = {}) {
  const sortFlag = sort === 'memory' ? '-m' : '-r'
  const count = Math.max(1, Math.min(50, Math.round(Number(limit)) || 10))
  const result = await run('/bin/ps', ['-Ao', 'pcpu=,pmem=,comm=', sortFlag])
  const rows = (result.stdout || '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = /^\s*([\d.]+)\s+([\d.]+)\s+(.*)$/.exec(line)
      if (!match) return null
      return { cpu: Number(match[1]), memory: Number(match[2]), command: match[3] }
    })
    .filter(Boolean)
  return json({ ok: result.ok, sort, processes: rows.slice(0, count) })
}

export async function spotlight({ query = '', limit = 20, onlyIn = '' } = {}) {
  if (!query || !query.trim()) return json({ ok: false, error: 'query must be a non-empty string' })
  const count = Math.max(1, Math.min(100, Math.round(Number(limit)) || 20))
  const args = []
  if (onlyIn) args.push('-onlyin', onlyIn)
  args.push(query)
  const result = await run('/usr/bin/mdfind', args)
  const hits = (result.stdout || '').trim().split('\n').filter(Boolean)
  return json({ ok: result.ok, count: hits.length, results: hits.slice(0, count), error: result.ok ? undefined : (result.stderr || '').trim() })
}

export async function finderPath() {
  const result = await osascript(['tell application "Finder" to get POSIX path of (target of front window as alias)'])
  const blocked = permissionError(result, 'Finder')
  if (!result.ok || blocked) return json({ ok: false, error: blocked || (result.stderr || '').trim() })
  return json({ ok: true, path: result.stdout.trim() })
}
