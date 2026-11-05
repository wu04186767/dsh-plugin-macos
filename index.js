/**
 * dsh-plugin-macos - native macOS tools for DeepSeek Harness agents.
 *
 * The plugin registers model-facing tools on ctx.tools. All shell work is done
 * through argv arrays (see lib/tools.js), so model-provided strings are never
 * interpolated into a shell command.
 */
import { defineTool } from './lib/define.js'
import * as mac from './lib/tools.js'

export const name = 'plugin-macos'
export const inject = ['tools']

/** Render any canonical value as a text block. */
function text(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
}

/** Shared output declaration: the tool returns a human/model readable string. */
function stringOutput() {
  return {
    schema: { type: 'string' },
    render: (_args, value) => text(value),
  }
}

export function apply(ctx) {
  // Stop the keep-awake helper if the plugin is unloaded or the profile shuts down.
  ctx.effect(() => () => mac.stopAll(), 'dsh-plugin-macos: stop keep-awake helper')

  const register = (definition) => ctx.tools.register(definition)

  register(defineTool({
    name: 'macos_notify',
    description:
      'Show a native macOS notification banner. Use it to ping the person who runs this agent when a long task finishes or when their decision is needed. The notification appears immediately; it does not block.',
    parameters: {
      message: { type: 'string', required: true, description: 'Body text of the notification.' },
      title: { type: 'string', description: 'Bold title. Defaults to DeepSeek Harness.' },
      subtitle: { type: 'string', description: 'Optional second line under the title.' },
      sound: { type: 'string', description: 'Optional notification sound name, for example Glass or Ping.' },
    },
    output: stringOutput(),
    async execute(args) {
      return mac.notify(args)
    },
  }))

  register(defineTool({
    name: 'macos_say',
    description: 'Speak text out loud with the built-in macOS say voice. Useful as an audible completion signal.',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to speak.' },
      voice: { type: 'string', description: 'Optional voice name.' },
      rate: { type: 'number', description: 'Optional speaking rate in words per minute.' },
    },
    output: stringOutput(),
    async execute(args) {
      return mac.say(args)
    },
  }))

  register(defineTool({
    name: 'macos_clipboard_read',
    description: 'Read the current macOS clipboard as text (pbpaste). Read-only.',
    parameters: {},
    output: stringOutput(),
    async execute() {
      return mac.clipboardRead()
    },
  }))

  register(defineTool({
    name: 'macos_clipboard_write',
    description: 'Replace the macOS clipboard with the given text (pbcopy).',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to copy.' },
    },
    output: stringOutput(),
    async execute(args) {
      return mac.clipboardWrite(args)
    },
  }))

  register(defineTool({
    name: 'macos_open',
    description:
      'Open a URL, file, folder, or application with Launch Services (open). Give a URL or path in target and/or an application name in app, for example {"app":"Safari"} or {"target":"https://deepseek.com"}.',
    parameters: {
      target: { type: 'string', description: 'URL, absolute file or folder path, or document to open.' },
      app: { type: 'string', description: 'Optional application name to open the target with, for example Visual Studio Code.' },
    },
    output: stringOutput(),
    async execute(args) {
      return mac.openTarget(args)
    },
  }))

  register(defineTool({
    name: 'macos_screenshot',
    description:
      'Capture the screen to a PNG file and return its path. Requires Screen Recording permission for the Host app the first time. Optionally capture a rectangle: region "x,y,width,height".',
    parameters: {
      path: { type: 'string', description: 'Optional absolute output path. Defaults to a new file in the system temp directory.' },
      region: { type: 'string', description: 'Optional rectangle x,y,width,height in screen points.' },
    },
    output: stringOutput(),
    async execute(args) {
      return mac.screenshot(args)
    },
  }))

  register(defineTool({
    name: 'macos_info',
    description:
      'Report the current macOS version, architecture, hostname, uptime, battery source and percentage, disk space, and memory size. Read-only.',
    parameters: {},
    output: stringOutput(),
    async execute() {
      return mac.systemInfo()
    },
  }))

  register(defineTool({
    name: 'macos_volume',
    description: 'Get or set the system output volume (0-100).',
    parameters: {
      action: { type: 'string', required: true, enum: ['get', 'set'], description: 'get reads the volume, set changes it.' },
      level: { type: 'number', description: 'Target volume 0-100 when action is set.' },
    },
    output: stringOutput(),
    async execute(args) {
      return mac.volume(args)
    },
  }))

  register(defineTool({
    name: 'macos_frontmost_app',
    description: 'Return the name of the application that is currently frontmost. Read-only.',
    parameters: {},
    output: stringOutput(),
    async execute() {
      return mac.frontmostApp()
    },
  }))

  register(defineTool({
    name: 'macos_keep_awake',
    description:
      'Keep this Mac (and its screen) awake with caffeinate, or stop it. Use action start before a long unattended run, then stop when it is no longer needed. The helper is stopped automatically when the plugin unloads.',
    parameters: {
      action: { type: 'string', required: true, enum: ['start', 'stop', 'status'], description: 'start spawns caffeinate -dims, stop kills it, status reports whether it is active.' },
    },
    output: stringOutput(),
    async execute(args) {
      if (args.action === 'start') return mac.keepAwakeStart()
      if (args.action === 'stop') return mac.keepAwakeStop()
      return mac.keepAwakeStatus()
    },
  }))

  register(defineTool({
    name: 'macos_applescript',
    description:
      'Run an AppleScript or JavaScript for Automation (JXA) snippet through osascript and return stdout. The first use may trigger a macOS Automation permission prompt for the target app. Prefer the dedicated tools above when they fit; use this for anything else macOS scripting can reach.',
    parameters: {
      script: { type: 'string', required: true, description: 'Script source to run.' },
      language: { type: 'string', enum: ['applescript', 'javascript'], description: 'Script language. Defaults to applescript.' },
      timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds. Defaults to 30000.' },
    },
    output: stringOutput(),
    async execute(args) {
      return mac.appleScript(args)
    },
  }))

  register(defineTool({
    name: 'macos_shortcuts',
    description:
      'List the Shortcuts available on this Mac, or run one of them by name with the macOS shortcuts CLI. Useful for turning an agent step into a user-authored automation.',
    parameters: {
      name: { type: 'string', description: 'Shortcut name to run. Omit to list available shortcuts.' },
      input: { type: 'string', description: 'Optional absolute path used as the shortcut input file.' },
    },
    output: stringOutput(),
    async execute(args) {
      return mac.shortcuts(args)
    },
  }))

  /* ---------------------------- Safari ---------------------------- */

  register(defineTool({
    name: 'safari_tabs',
    description: 'List every Safari window and tab (index, title, URL) plus which tab is active. Read-only. Requires Automation permission for Safari.',
    parameters: {},
    output: stringOutput(),
    async execute() {
      return mac.safariTabs()
    },
  }))

  register(defineTool({
    name: 'safari_open',
    description: 'Open a URL in Safari, either in a new tab (default) or by replacing the current tab.',
    parameters: {
      url: { type: 'string', required: true, description: 'http(s) URL to open.' },
      newTab: { type: 'boolean', description: 'Open in a new tab when true (default).' },
      activate: { type: 'boolean', description: 'Bring Safari to the front. Defaults to true.' },
    },
    output: stringOutput(),
    async execute(args) {
      return mac.safariOpen(args)
    },
  }))

  register(defineTool({
    name: 'safari_page_text',
    description:
      'Return the visible text of the front Safari document, so the agent can read the page the person is looking at. Optionally select a tab first. Requires Automation permission for Safari.',
    parameters: {
      window_index: { type: 'number', description: '1-based Safari window index. Defaults to 1.' },
      tab_index: { type: 'number', description: 'Optional 1-based tab index to select before reading.' },
    },
    output: stringOutput(),
    async execute(args) {
      return mac.safariPageText(args)
    },
  }))

  register(defineTool({
    name: 'safari_javascript',
    description:
      'Evaluate JavaScript in the front Safari tab and return the result. The user must enable Safari > Settings > Developer > Allow JavaScript from Apple Events first; the tool explains this when blocked.',
    parameters: {
      script: { type: 'string', required: true, description: 'JavaScript expression or program to evaluate in the page.' },
    },
    output: stringOutput(),
    async execute(args) {
      return mac.safariJavaScript(args)
    },
  }))

  /* ---------------------- System & search ---------------------- */

  register(defineTool({
    name: 'macos_dark_mode',
    description: 'Get or set the macOS appearance (dark mode). Requires Automation permission for System Events.',
    parameters: {
      action: { type: 'string', enum: ['get', 'set'], description: 'get reads the current appearance (default), set changes it.' },
      enabled: { type: 'boolean', description: 'For action set: true enables dark mode, false switches to light mode.' },
    },
    output: stringOutput(),
    async execute(args) {
      return mac.darkMode(args)
    },
  }))

  register(defineTool({
    name: 'macos_network',
    description: 'Report the hostname, primary network interface, IPv4 address, and current Wi-Fi SSID. Read-only.',
    parameters: {},
    output: stringOutput(),
    async execute() {
      return mac.networkInfo()
    },
  }))

  register(defineTool({
    name: 'macos_processes',
    description: 'List the top processes by CPU or memory usage. Read-only. Useful before closing apps or diagnosing a slow Mac.',
    parameters: {
      sort: { type: 'string', enum: ['cpu', 'memory'], description: 'Sort order. Defaults to cpu.' },
      limit: { type: 'number', description: 'How many processes to return (1-50). Defaults to 10.' },
    },
    output: stringOutput(),
    async execute(args) {
      return mac.processes(args)
    },
  }))

  register(defineTool({
    name: 'macos_spotlight',
    description: 'Search this Mac with Spotlight (mdfind). Optionally limit the search to one folder. Read-only.',
    parameters: {
      query: { type: 'string', required: true, description: 'Spotlight query, for example a file name, project name, or metadata query.' },
      limit: { type: 'number', description: 'Maximum results to return (1-100). Defaults to 20.' },
      onlyIn: { type: 'string', description: 'Optional absolute folder path to limit the search to.' },
    },
    output: stringOutput(),
    async execute(args) {
      return mac.spotlight(args)
    },
  }))

  register(defineTool({
    name: 'macos_finder_path',
    description: 'Return the POSIX path of the front Finder window. Read-only. Requires Automation permission for Finder.',
    parameters: {},
    output: stringOutput(),
    async execute() {
      return mac.finderPath()
    },
  }))
}
