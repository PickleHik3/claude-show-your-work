// Getting pictures ready to draw: finding the file, converting it to PNG at
// the width the player needs, and the notice when that fails.
import type { EngineInterface } from 'claude-code'

import type { Shown } from '../types'

import { state } from './state'
import { frameWidth, saverWidth } from './layout'
import { dataSaverOf, settings } from './settings'

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
  // With data saver on it is never enlarged (Show full size sends the file as
  // it is), and the small copy is made beside it, from the same PNG.
  const now = await pngSize($, png)
  const isSaving = isDataSaver()
  const saving = isSaving ? saverCopy($, png, now.width, real).catch(() => null) : Promise.resolve(null)
  const wide = isSaving ? now.width : Math.min(frameWidth(now.width, now.height, state.termSize, state.cell), now.width * 2)
  if (wide > now.width) {
    state.generation += 1
    const big = `${state.TMP}/${png.split('/').pop()!.replace(/\.png$/i, '')}-${state.generation}-w${wide}.png`
    await $.process.run(['mkdir', '-p', state.TMP])
    const grown = state.isMac
      ? await $.process.run(['sips', '--resampleWidth', String(wide), png, '--out', big]).catch(() => ({ exitCode: 1 }))
      : await $.process.run([state.ffmpeg, '-v', 'error', '-y', '-i', png, '-vf', `scale=${wide}:-2:flags=lanczos`, big]).catch(() => ({ exitCode: 1 }))
    if (grown.exitCode === 0) png = big
  }
  const saver = await saving
  state.generation += 1

  return {
    kind: 'image', path: png, source: real, ...(await pngSize($, png)), sourceWidth: dims.width, sourceHeight: dims.height, title: name, generation: state.generation,
    ...(saver ? { saver } : {}),
    ...(isSaving ? { isSaving } : {}),
  }
}

// Data saver: for a slow link (ssh from a phone), each picture also gets a
// small copy, sent in place of the full one until the person asks for it.
export const isDataSaver = () => dataSaverOf(state.link, settings.dataSaver, state.sendBytes)
// The data saver copy as Claude reads it in the result's first line.
export const saverNote = (saver?: Shown['saver']) =>
  saver ? `data saver, ${saver.width}×${saver.height}, ${Math.max(1, Math.round(saver.bytes / 1000))} KB` : ''

// About what a data saver copy aims for, in bytes. Width wins: nothing
// shrinks a copy below the pane's width to meet it.
export const SAVER_BYTES = 150_000
// Whether a small copy can pay off: the picture is wider than the copy would
// be, or over SAVER_BYTES. One within both goes as it is, with no copy and no
// Show full size.
export const isSaverWorth = (bytes: number, own: number, width: number) => width < own || bytes > SAVER_BYTES

// The small copy: scaled down to the terminal's width (saverWidth, never up),
// then cut to 256 colours with pngquant, dithered. On Linux the scaled picture
// goes uncompressed down a pipe into pngquant, with no file between
// (ImageMagick, else ffmpeg); sips (macOS) scales into a file first.
// `--speed 8` took half the time of 3 on noise and a quarter to a third less
// on a screenshot, for a few percent more bytes. ImageMagick when pngquant is
// missing or fails; the plain scaled PNG when both do. A copy that isn't
// smaller than what it was made from is dropped (ImageMagick's dither can
// grow a flat screenshot). Kept in the temp folder by the original's path
// and the width, and made again only when the original is newer.
// No rm: the copies being made are emptied once used, and CLEAN_SH takes them.
// Prints the copy's size in bytes.
export const SAVER_SH = [
  'f="$0"; out="$1"; w="$2"; ff="$3"; orig="$4"',
  'size() { wc -c < "$1" | tr -d " "; }',
  'has() { command -v "$1" >/dev/null 2>&1; }',
  'for x in "$out" "$out.r.png" "$out.q.png"; do [ -L "$x" ] && exit 1; done',
  '[ -s "$out" ] && [ "$out" -nt "$orig" ] && { size "$out"; exit 0; }',
  'r="$out.r.png"; q="$out.q.png"; src="$f"',
  'pq() { pngquant 256 --speed 8 --strip - > "$q" 2>/dev/null && [ -s "$q" ]; }',
  ': > "$q"',
  'if [ "$w" -gt 0 ] && has pngquant && ! has sips; then',
  '  { has magick && magick "$f" -resize "${w}x" -define png:compression-level=0 png:- 2>/dev/null | pq; } ||',
  '    { [ -x "$ff" ] && "$ff" -v error -i "$f" -frames:v 1 -vf "scale=$w:-2:flags=lanczos" -c:v png -compression_level 0 -f image2pipe - </dev/null 2>/dev/null | pq; } || : > "$q"',
  'fi',
  'if [ ! -s "$q" ]; then',
  '  if [ "$w" -gt 0 ]; then',
  '    if has sips; then sips -s format png --resampleWidth "$w" "$f" --out "$r" >/dev/null 2>&1 && src="$r"',
  '    elif [ -x "$ff" ]; then "$ff" -v error -y -i "$f" -frames:v 1 -vf "scale=$w:-2:flags=lanczos" "$r" </dev/null 2>/dev/null && src="$r"',
  '    elif has magick; then magick "$f" -resize "${w}x" "$r" 2>/dev/null && src="$r"',
  '    elif has convert; then convert "$f" -resize "${w}x" "$r" 2>/dev/null && src="$r"',
  '    fi',
  '  fi',
  '  if has pngquant && pngquant 256 --speed 8 --strip --force --output "$q" "$src" 2>/dev/null; then :',
  '  elif has magick && magick "$src" -dither FloydSteinberg -colors 256 "PNG8:$q" 2>/dev/null; then :',
  '  elif has convert && convert "$src" -dither FloydSteinberg -colors 256 "PNG8:$q" 2>/dev/null; then :',
  '  fi',
  'fi',
  'if [ -s "$q" ] && [ "$(size "$q")" -lt "$(size "$src")" ]; then mv -f "$q" "$out"',
  'elif [ "$src" = "$r" ]; then mv -f "$r" "$out"',
  'else : > "$q"; exit 1; fi',
  'for x in "$r" "$q"; do [ -f "$x" ] && : > "$x"; done',
  'size "$out"',
].join('\n')
export async function saverCopy($: EngineInterface, png: string, ownWidth: number, real: string): Promise<Shown['saver'] | null> {
  const width = saverWidth(ownWidth, state.saverPx, state.cell, state.termSize)
  // A size that can't be read counts as big: the copy is made.
  const size = await Promise.resolve().then(() => $.fs.stat(png)).then(s => Number((s as { size?: unknown }).size) || Number.POSITIVE_INFINITY, () => Number.POSITIVE_INFINITY)
  if (!isSaverWorth(size, ownWidth, width)) return null
  const out = `${state.TMP}/s-${keyOf(real)}-${width}.png`
  const made = await Promise.resolve().then(() => $.process.run(['sh', '-c', SAVER_SH, png, out, String(width < ownWidth ? width : 0), state.ffmpeg, real])).catch(() => null)
  const bytes = made?.exitCode === 0 ? Number(made.stdout.trim()) : 0
  if (!bytes) return null
  const dims = await pngSize($, out).catch(() => null)

  return dims ? { path: out, ...dims, bytes } : null
}
