// Getting pictures ready to draw: finding the file, converting it to PNG at
// the width the player needs, and the notice when that fails.
import type { EngineInterface } from 'claude-code'

import type { Shown } from '../types'

import { state } from './state'
import { frameWidth } from './layout'

// Deletes anything in the temp folder older than a week, without following links.
export const CLEAN_SH = [
  '[ -d "$0" ] && [ ! -L "$0" ] && [ -O "$0" ] || exit 0',
  'find -P "$0" -mindepth 1 -maxdepth 1 -mtime +7 -exec rm -rf {} + 2>/dev/null; true',
].join('\n')

// A typed or dragged-in path: quotes, backslash-escaped spaces and ~ allowed.
export function expand(path: string, base: string, homeDir: string): string {
  let p = path.trim().replace(/^(['"])(.*)\1$/, '$2').replace(/\\(.)/g, '$1')
  if (p === '~' || p.startsWith('~/')) p = homeDir + p.slice(1)
  if (p.startsWith('/')) return p

  return `${base.replace(/\/$/, '')}/${p}`
}

// A name with its look-alike spaces made plain: macOS writes a narrow
// no-break space before AM/PM in screenshot names, which a typed path lacks.
export const looseName = (name: string) =>
  name.normalize('NFC').replace(/[  -   　]/g, ' ')

// The file a path means: as given when it exists, else the one entry in its
// folder whose name matches once spaces are made plain.
export async function locate($: EngineInterface, raw: string): Promise<string> {
  const path = expand(raw, state.cwd, state.home)
  if (await $.fs.stat(path).then(() => true, () => false)) return path
  const cut = path.lastIndexOf('/')
  const dir = path.slice(0, cut) || '/'
  const want = looseName(path.slice(cut + 1))
  const hit = (await $.fs.list(dir).catch(() => [])).find(f => looseName(f.name) === want)

  return hit ? `${dir.replace(/\/$/, '')}/${hit.name}` : path
}

// A PNG's size from its header (bytes 16 to 24), without any tool.
export function pngDims(base64: string): { width: number; height: number } | null {
  const b = Uint8Array.from(atob(base64.slice(0, 44)), c => c.charCodeAt(0))
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null
  const at = (i: number) => (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0

  return { width: at(16), height: at(20) }
}

// Finds a pasted image's original file by name with Spotlight (macOS).
export async function findPasted($: EngineInterface, name: string): Promise<string | null> {
  if (name.startsWith('/')) return name
  if (!state.isMac) return null
  const found = await $.process.run(['mdfind', '-name', name])

  return found.stdout.split('\n').find(line => line.endsWith(`/${name}`)) ?? null
}

export async function pngSize($: EngineInterface, png: string) {
  if (!state.isMac) {
    const d = pngDims(String((await $.fs.read(png, { as: 'bytes' }) as unknown as { base64: string }).base64 ?? ''))
    if (!d || !d.width || !d.height) throw new Error(`not an image: ${png}`)
    return d
  }
  const dims = await $.process.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', png])
  const width = Number(/pixelWidth:\s*(\d+)/.exec(dims.stdout)?.[1] ?? 0)
  const height = Number(/pixelHeight:\s*(\d+)/.exec(dims.stdout)?.[1] ?? 0)
  if (!width || !height) throw new Error(`not an image: ${png}`)

  return { width, height }
}

// On Linux ffmpeg turns pictures other than PNG into PNG (macOS uses sips).
export const NO_FFMPEG =
  "pictures other than PNG need ffmpeg, and it isn't installed. Install it with your package manager, " +
  'for example `sudo apt install ffmpeg` or `sudo dnf install ffmpeg` (Claude can run that for you), then restart Claude Code.'
// What the person pastes back so Claude installs ffmpeg and tries again.
export const FFMPEG_PROMPT =
  "Install ffmpeg for me with this machine's package manager (for example `sudo apt install ffmpeg`). Then show it again."

// A failure as the person and Claude see it: a box in place of the picture,
// one plain message for Claude, and a prompt to paste back. Never raw tool
// output, never the plugin's internal copy of a file.
export type NoticeKind = 'missing' | 'not_image' | 'no_ffmpeg' | 'other'
export type Notice = { kind: NoticeKind; title: string; text: string; message: string; prompt: string }

// How a failure reads, from whatever the tools said; `path` is the person's own.
export function noticeOf(err: unknown, path: string, homeDir = ''): Notice {
  const raw = String((err as Error)?.message ?? err)
  const shown = homeDir && path.startsWith(`${homeDir}/`) ? `~${path.slice(homeDir.length)}` : path
  const name = path.split('/').pop() || path
  if (raw.includes(NO_FFMPEG)) return {
    kind: 'no_ffmpeg', title: 'This needs ffmpeg', message: NO_FFMPEG, prompt: FFMPEG_PROMPT,
    text: "ffmpeg isn't installed, so pictures other than PNG can't show here. Copy the prompt and paste it to Claude to install it, or install it yourself, for example `sudo apt install ffmpeg`.",
  }
  if (/could not convert|not an image|Cannot extract image|sips/i.test(raw)) return {
    kind: 'not_image', title: "This isn't a picture",
    text: `${name} isn't a picture, so it can't be shown. Pictures can be PNG, JPEG, WebP, GIF or TIFF.`,
    message: `${shown} isn't a picture (show_image opens PNG, JPEG, WebP, GIF and TIFF). Show an image file instead.`,
    prompt: `${shown} isn't a picture. Show me the right file instead.`,
  }
  if (/ENOENT|no such file|not found/i.test(raw)) return {
    kind: 'missing', title: 'File not found',
    text: `There's no file at ${shown}.`,
    message: `There's no file at ${shown}. Check the path (it may have moved or not been saved yet), then show it again.`,
    prompt: `There's no file at ${shown}. Find the right file and show it to me again.`,
  }
  const detail = (raw.split('\n')[0] ?? '').replace(/\/(?:private\/)?tmp\/\S+/g, name).slice(0, 160)
  return {
    kind: 'other', title: "Couldn't show it",
    text: `${name} couldn't be shown: ${detail}`,
    message: `${shown} couldn't be shown: ${detail}`,
    prompt: `${shown} couldn't be shown (${detail}). Look into it and show it to me again.`,
  }
}

// A short key for a text: a temp copy's name, a shown item's marker id.
export function keyOf(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0') + text.length.toString(16)
}
export function exists($: EngineInterface, file: string) {
  return $.fs.stat(file).then(() => true, () => false)
}
// Gone only when the disk says so; no answer at all (no fs here) is not gone.
export function isGone($: EngineInterface, file: string) {
  return $.fs.stat(file).then(() => false, (e: unknown) => /ENOENT|not found|no such file/i.test(String((e as Error)?.message ?? e)))
}

// The largest still kept whole.
export const MAX_STILL = 3200

// Resolves a path to something the terminal can draw: a PNG (other image
// formats converted with macOS `sips`, or ffmpeg on Linux).
export async function prepare($: EngineInterface, raw: string, title?: string): Promise<Shown> {
  const path = expand(raw, state.cwd, state.home)
  const stat = await $.fs.stat(path, { resolve: true })
  const real = stat.realPath ?? path
  const name = title ?? real.split('/').pop()!
  let png = real
  if (!/\.png$/i.test(real)) {
    state.generation += 1
    png = `${state.TMP}/${real.split('/').pop()!.replace(/\.[^.]+$/, '')}-${state.generation}.png`
    await $.process.run(['mkdir', '-p', state.TMP])
    if (!state.isMac && !(await exists($, state.ffmpeg))) throw new Error(NO_FFMPEG)
    const conv = state.isMac
      ? await $.process.run(['sips', '-s', 'format', 'png', real, '--out', png])
      : await $.process.run([state.ffmpeg, '-v', 'error', '-y', '-i', real, '-frames:v', '1', png])
    if (conv.exitCode !== 0) throw new Error(`could not convert ${real}: ${conv.stderr.trim()}`)
  }
  // The terminal reads the file itself, so only a picture past what any
  // screen shows is shrunk.
  const dims = await pngSize($, png)
  if (Math.max(dims.width, dims.height) > MAX_STILL) {
    state.generation += 1
    const small = `${state.TMP}/${png.split('/').pop()!.replace(/\.png$/i, '')}-${state.generation}-small.png`
    await $.process.run(['mkdir', '-p', state.TMP])
    const shrunk = state.isMac
      ? await $.process.run(['sips', '-Z', String(MAX_STILL), png, '--out', small])
      : await $.process.run([state.ffmpeg, '-v', 'error', '-y', '-i', png, '-vf', `scale='if(gt(iw,ih),min(${MAX_STILL},iw),-2)':'if(gt(iw,ih),-2,min(${MAX_STILL},ih))'`, small]).catch(() => ({ exitCode: 1 }))
    if (state.isMac || shrunk.exitCode === 0) png = small
  }
  // A picture narrower than the window shows it is drawn that wide.
  // Never past twice its own width: a small icon stays small.
  const now = await pngSize($, png)
  const wide = Math.min(frameWidth(now.width, now.height, state.termSize, state.cell), now.width * 2)
  if (wide > now.width) {
    state.generation += 1
    const big = `${state.TMP}/${png.split('/').pop()!.replace(/\.png$/i, '')}-${state.generation}-w${wide}.png`
    await $.process.run(['mkdir', '-p', state.TMP])
    const grown = state.isMac
      ? await $.process.run(['sips', '--resampleWidth', String(wide), png, '--out', big]).catch(() => ({ exitCode: 1 }))
      : await $.process.run([state.ffmpeg, '-v', 'error', '-y', '-i', png, '-vf', `scale=${wide}:-2:flags=lanczos`, big]).catch(() => ({ exitCode: 1 }))
    if (grown.exitCode === 0) png = big
  }
  state.generation += 1

  return { kind: 'image', path: png, source: real, ...(await pngSize($, png)), sourceWidth: dims.width, sourceHeight: dims.height, title: name, generation: state.generation }
}
