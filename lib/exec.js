/**
 * Process and AppleScript execution helpers for dsh-plugin-macos.
 * All invocations use argv arrays (never a shell string) so tool arguments
 * cannot inject shell syntax.
 */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const MAX_BUFFER = 8 * 1024 * 1024

/** Run a command and resolve a uniform result object. Never rejects. */
export async function run(file, args = [], { timeoutMs = 20000, input } = {}) {
  if (input !== undefined) return runWithInput(file, args, input, timeoutMs)
  try {
    const { stdout, stderr } = await execFileP(file, args, {
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
    })
    return { ok: true, code: 0, stdout: stdout ?? '', stderr: stderr ?? '' }
  } catch (error) {
    return {
      ok: false,
      code: typeof error.code === 'number' ? error.code : -1,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' && error.stderr ? error.stderr : error.message,
      timedOut: error.killed === true,
    }
  }
}

/** Run a command that reads stdin, then resolves a uniform result object. */
export function runWithInput(file, args, input, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, timeoutMs)
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (stdout.length > MAX_BUFFER) child.kill('SIGKILL')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => finish({ ok: false, code: -1, stdout, stderr: error.message }))
    child.on('close', (code, signal) => finish({ ok: code === 0, code: code ?? -1, stdout, stderr, signal: signal ?? undefined }))
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

/** AppleScript string literal from a JS string. */
export function asStr(value) {
  return JSON.stringify(String(value ?? ''))
}

/**
 * Run osascript with one or more -e script fragments and optional argv.
 * `lines` are concatenated program lines; `argv` is available as `item n of argv`.
 */
export async function osascript(lines, { argv = [], lang = 'AppleScript', timeoutMs = 20000 } = {}) {
  const fragments = Array.isArray(lines) ? lines : [lines]
  const args = []
  if (lang === 'JavaScript') args.push('-l', 'JavaScript')
  for (const fragment of fragments) args.push('-e', fragment)
  if (argv.length > 0) args.push('--', ...argv.map(String))
  return run('/usr/bin/osascript', args, { timeoutMs })
}

/** True when an osascript result reports a missing Automation permission. */
export function permissionError(result, appName) {
  const text = (result.stderr || '') + (result.stdout || '')
  if (/not authori[sz]ed|not permitted|isn.t allowed|-1743|-25211/i.test(text)) {
    return `macOS blocked automation of ${appName}. Allow "DeepSeek Harness" (or your terminal) to control ${appName} in System Settings > Privacy & Security > Automation, then retry.`
  }
  return null
}
