// The entry module: the tool and the command, and the hooks that tie the
// modules together.
import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import type { KeyChange, Shown, Summary } from '../types'

import { state } from './state'
import { paneSize } from './layout'
import type { PaneProps } from './layout'
import { setUp } from './setup'
import { loadSettings } from './settings'
import { CLEAN_SH, expand, findPasted, keyOf, locate, NO_FFMPEG, noticeOf, prepare } from './media'
import type { Notice } from './media'
import { MARK, markOf, shownById, shownOf, textOf } from './marker'
import { cantDraw, draw, NoticeBox, player, sideOf, toolLine, versions, Viewer } from './player'
import type { Ui } from './player'

const PANE = 'show-your-work'
const TOOLS = ['mcp__show-your-work__show_image']
// Screenshots made only to be shown go to the temp folder, so they don't pile
// up in the project.
const SCRATCH_NOTE = 'Save screenshots you make to show here in a temporary folder, such as $TMPDIR or /tmp, not in the project. Save them in the project only when the user asks to keep them, or when the project already has a folder for them, such as one for test screenshots.'
// What can be shown at all: anything else is refused before it is read.
const IMAGE = /\.(png|jpe?g|webp|gif|tiff?|heic|heif|bmp|avif)$/i
const current = atom({ plugin: 'show-your-work', key: 'current' } as const, null)
let pastedNames: string[] = []
// Each failed show's notice, by tool call, for the box drawn in its place.
const notices = new Map<string, Notice>()
// Each window's last drawing, handed back while nothing it shows changed.
const drawn = new Map<string, { key: string; tree: unknown }>()

const IMAGE_INPUT = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Absolute path' },
    title: { type: 'string', description: 'Short caption' },
    pr: { type: 'string', description: 'PR URL or number' },
    url: { type: 'string', description: 'The page shown; adds Open page' },
    changes: {
      type: 'array',
      description: 'What changed: { title, detail?, url? }',
      items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' }, url: { type: 'string' } }, required: ['title'] },
    },
    summary: {
      type: 'array',
      description: 'QA in up to 3 lines: { label, ok, passed?, total? }',
      items: { type: 'object', properties: { label: { type: 'string' }, ok: { type: 'boolean' }, passed: { type: 'number' }, total: { type: 'number' } }, required: ['label', 'ok'] },
    },
    compare: { type: 'string', description: 'Path to the before version' },
    label: { type: 'string', description: 'Name for this side if the user asks (default "Updated")' },
    compare_label: { type: 'string', description: 'Name for the before side if the user asks (default "Original")' },
  },
  required: ['path'],
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    state.cwd = started.cwd
    state.setup = null
    await setUp($)
    state.sessionId = await $.session.id().catch(() => '')
    await loadSettings($)
    void (async () => {
      const program = (await $.env.get('TERM_PROGRAM')) ?? ''
      const term = (await $.env.get('TERM')) ?? ''
      state.terminalName = /ghostty/i.test(program + term) ? 'ghostty' : /kitty/i.test(term) ? 'kitty' : program.toLowerCase() || 'other'
      state.inTmux = !!(await $.env.get('TMUX')) || /^tmux/i.test(term)
      // tmux with passthrough off never lets a picture through: known before the first one.
      if (state.inTmux) {
        const pass = await $.process.run(['tmux', 'show', '-gv', 'allow-passthrough']).catch(() => null)
        if (pass && pass.exitCode === 0 && /^off$/i.test(pass.stdout.trim())) {
          state.canImage = false
          state.probed = true
          state.drawCause = 'tmux'
        }
      }
    })().catch(() => undefined)
    // Converted pictures and saved markers a week old go.
    void $.process.run(['sh', '-c', CLEAN_SH, state.TMP]).catch(() => undefined)
    await $.command.register({
      name: 'img',
      description: 'Show an image in the chat: /img <path>',
      argumentHint: '<path>',
    })
    await $.tool.register({
      name: 'show_image',
      description:
        `Shows an image file to the user, inline in their terminal. Accepts PNG, JPEG, WebP, GIF and TIFF.\n\nUse it without being asked when a change is visual, before you call it done. On Android, take the picture with the android-control skill's \`ad\` tool: \`ad shot\` (screen), \`ad zoom\` (element crop). For a website or web app, screenshot the page or component with headless Playwright. Don't ask the user to open a file or URL. Don't use it when nothing visual changed.\n\nWhen the image shows work you changed, pass \`changes\` (a few words each) and \`compare\` (the same view on the old build), so the user can switch between Original and Updated. For device checks, show the before and after of each check. Pass \`summary\` only for checks you ran. If a device-check report page exists (HTML under ~/reports, served over Tailscale), pass its URL as \`url\`.\n\nThe image goes to the user's screen, not to you.\n\n${SCRATCH_NOTE}`,
      inputSchema: IMAGE_INPUT,
      isDeferred: false,
    })

    return started
  })

  // While pictures draw, Claude is told up front that it can show its work,
  // so it does so without being asked. Once a draw has failed, every later
  // turn knows instead: what was "shown" was a notice, not the picture.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.some(t => TOOLS.includes(t))) return composed
    if (state.canImage) {
      return {
        sections: [...composed.sections, {
          id: 'show-your-work:show-visual-work', scope: 'session',
          text: "This terminal shows pictures inline. When a change is visual, show it with show_image before you say it's done (Android: `ad shot`, `ad zoom`; web: a headless Playwright screenshot). For a fix or a device check, show before and after, the old build or page as compare.",
        }],
      }
    }
    const why = cantDraw(state.drawCause, 'it', state.sessionId).claude.replace(/, so the person saw a notice instead of it\./, '.')
    return {
      sections: [...composed.sections, {
        id: 'show-your-work:cannot-draw', scope: 'session',
        text: `show-your-work: pictures can't draw in this session (${why}) Anything shown with show_image was not seen: the person saw a notice instead. Don't say they saw it.`,
      }],
    }
  })

  on('prompt.submit', ($, e, next) => {
    pastedNames = (e.attachments ?? []).filter(a => a.type === 'image' && a.filename).map(a => a.filename!)

    return next(e)
  })

  on('command.run', { command: 'img' }, async ($, e) => {
    await setUp($)
    let arg = e.args.trim()
    if (/^\[Image #\d+\]$/.test(arg) || (!arg && pastedNames.length > 0)) {
      const name = pastedNames.at(-1)
      const found = name ? await findPasted($, name) : null
      if (!found) {
        return {
          text: 'Pasted images reach Claude, not mods, so /img cannot read one. Drag the file into the prompt (that types its path) or type the path: /img ~/path/to/file.png',
        }
      }
      arg = found
    }
    if (!arg) return { text: 'Usage: /img <path>' }
    try {
      const shown = await prepare($, arg)
      // Drawn in the chat, in this command's own row, by the CommandOutput hook.
      const id = keyOf(`${arg}|${await $.clock.now()}`).slice(0, 10)
      shownById.set(id, shown)

      return { text: `Showing ${shown.title}.\n${MARK}#${id}` }
    } catch (err) {
      return { text: noticeOf(err, expand(arg, state.cwd, state.home), state.home).message }
    }
  })

  on('tool.call', { tool: /^mcp__show-your-work__show_image$/ }, async ($, e) => {
    const input = { ...e } as unknown as {
      path?: string; title?: string; change?: string; pr?: string; changes?: KeyChange[]; summary?: Summary[]; url?: string
      compare?: string; label?: string; compare_label?: string
    }
    if (!input.path) return { deny: 'A path is needed.' }
    await setUp($)
    try {
      input.path = await locate($, input.path)
      if (input.compare) input.compare = await locate($, input.compare)
      // Only pictures are read: never a key or a config file a model was
      // talked into naming.
      if (!IMAGE.test(input.path)) throw new Error(`not an image: ${input.path}`)
      const shown: Shown = {
        ...(await prepare($, input.path, input.title ?? input.path.split('/').pop())),
        change: input.change,
        pr: input.pr,
        url: input.url,
        changes: input.changes,
        summary: input.summary,
        label: input.label,
      }
      if (input.compare) {
        const label = input.compare_label
        shown.compare = { ...(await prepare($, input.compare, label ?? 'Original')), label }
      }
      const what = `${shown.sourceWidth ?? shown.width}×${shown.sourceHeight ?? shown.height}`
      const opening = state.canImage
        ? `Shown: ${shown.title} (${what}).`
        : `Not shown: ${cantDraw(state.drawCause, shown.title, state.sessionId).claude} Don't say it was shown.`
      // Claude gets one short line; the drawing data stays out of its context.
      return { result: `${opening}\n${await markOf($, shown)}` }
    } catch (err) {
      const n = noticeOf(err, expand(input.path ?? '', state.cwd, state.home), state.home)
      notices.set(e.tool_use_id, n)
      return { deny: `show-your-work: ${n.message}` }
    }
  }).catch(() => ({ deny: 'show-your-work: it could not be shown.' }))

  // The call's own row: one short line, not the whole input.
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    const props = e.props as { tool: string; input: unknown; isRunning: boolean }
    if (!TOOLS.includes(props.tool)) return next(e)
    const { Text } = $.ui.resolve(e) as Ui

    return <Text>{toolLine(props.input, props.isRunning)}</Text>
  })

  // Inline in the transcript: the player is the tool's result row.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const props = e.props as { tool: string; output: unknown; isErrored: boolean; onScreen?: unknown }
    if (!TOOLS.includes(props.tool)) return next(e)
    if (props.isErrored) {
      const n = notices.get((props as { tool_use_id?: string }).tool_use_id ?? '') ??
        (textOf(props.output).includes(NO_FFMPEG) ? noticeOf(new Error(NO_FFMPEG), '') : undefined)
      if (!n) return next(e)
      return NoticeBox($.ui.resolve(e) as Ui, $, (e.viewport?.columns ?? 100) - 8, { ...n, copy: n.prompt, label: 'Copy prompt', action: `copy_${n.kind}_prompt` })
    }
    const one = player(e.requestId)
    if (props.onScreen === null) {
      one.wasAway = true
    } else if (one.wasAway && props.onScreen) {
      // Back in view: draw it fresh. The terminal may have dropped the picture.
      one.wasAway = false
      versions.set(e.requestId, (versions.get(e.requestId) ?? 0) + 1)
      one.resend = true
    }
    const key = `${state.version}|${versions.get(e.requestId) ?? 0}|${e.viewport?.columns ?? 0}|${e.viewport?.rows ?? 0}`
    const kept = drawn.get(e.requestId)
    if (kept?.key === key) return kept.tree as Awaited<ReturnType<typeof Viewer>>
    const shown = await shownOf($, props.output)
    if (!shown) return next(e)
    const tree = await Viewer($, e, shown, e.requestId, false, e.viewport)
    drawn.set(e.requestId, { key, tree })
    // Send the picture on screen to the terminal again.
    if (one.resend) {
      one.resend = false
      void $.clock.sleep(120).then(() => draw($, e.requestId, sideOf(shown, e.requestId))).catch(() => undefined)
    }

    return tree
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    const shown = await read($, current)
    if (!shown) return <Text dimColor>Nothing to show yet. Run /img path/to/file</Text>

    return Viewer($, e, shown, PANE, true, paneSize(e.viewport, e.props as PaneProps))
  })

  // /img: the player, in the chat under the command.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const row = e.props as { command?: string; args?: string; text?: string; isErrored?: boolean; onScreen?: unknown }
    if (row.command !== 'img' || row.isErrored || !(row.text ?? '').includes(MARK)) return next(e)
    const shown = await shownOf($, row.text ?? '')
    if (!shown) {
      // A row from before a restart: the picture is no longer at hand.
      const { Text } = $.ui.resolve(e) as Ui
      return <Text dimColor>{(row.text ?? '').split('\n')[0]}</Text>
    }
    return Viewer($, e, shown, e.requestId, false, e.viewport)
  })
}
