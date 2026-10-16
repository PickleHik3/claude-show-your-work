// The player: the picture, the Original/Updated switch, the report beside it,
// and the swaps that send a picture to the terminal.
import type { EngineInterface } from 'claude-code'

import type { Shown, Summary } from '../types'

import { state } from './state'
import { drawBox, layoutOf, pagesOf, pixelsFor, remeasure, SIDE, SIDEBAR, tabLabel, targetBox, wrapWords } from './layout'
import { isDataSaver, isGone, keyOf, MAX_STILL, pngDims, pngSize } from './media'
import { isLinkForced, saveSetting } from './settings'

// What each drawn site (a transcript row's tool_use_id, or the pane) shows.
type Player = {
  isCompare?: boolean
  // scrolled out of view since it was last drawn
  wasAway?: boolean
  // back in view: send the picture on screen again after drawing
  resend?: boolean
  // which page of key changes the sidebar shows
  changesPage?: number
  // the picture's size in cells as last drawn, for repaints
  box?: { columns: number; rows: number }
  // Show full size pressed: the full picture in place of its data saver copy
  isFull?: boolean
  // the copy each picture (viewKey) was drawn with; a swap changes what is
  // on screen, not this, so the redraw after it sends nothing again
  drawnAs?: Record<string, Mode | undefined>
}
export const players = new Map<string, Player>()
// Each window's own repaint count, beside state.version for all of them.
export const versions = new Map<string, number>()

// A change to one window bumps only its own count, so the others hand back
// their kept drawing when the repaint reaches them.
export function redraw($: EngineInterface, site?: string) {
  if (site) versions.set(site, (versions.get(site) ?? 0) + 1)
  else state.version += 1
  $.ui.invalidate('ui.render')
}
export const player = (site: string): Player => {
  let one = players.get(site)
  if (!one) players.set(site, (one = {}))

  return one
}

// Opens a file or URL with the desktop's default app.
const openCommand = () => (state.isMac ? 'open' : 'xdg-open')

// The narrowest the button row gets, in columns: room for the action buttons
// on one line.
const CONTROLS_MIN = 64

// A player whose box needs more pixels than its picture has (a bigger
// window, a pane, no report beside it) gets a sharper copy, made once in the
// background from the original file and swapped into the same object. It
// stops at twice the picture's own width (an icon stays small) and MAX_STILL.
const sharpKey = (m: Shown) => `${m.kind}|${m.source ?? m.path}`
// Never a picture shown with data saver on: its point is fewer bytes.
export const mayWiden = (m: Shown) => !m.saver && !m.isSaving
const sharpening = new Map<string, number>()
const sharpest = new Map<string, Pick<Shown, 'path' | 'width' | 'height' | 'generation'>>()
function useSharpest(m: Shown) {
  const better = sharpest.get(sharpKey(m))
  if (better && better.width > m.width) Object.assign(m, better)
}
function sharpen($: EngineInterface, m: Shown, need: number) {
  const source = m.source
  const limit = Math.min(MAX_STILL, (m.sourceWidth ?? m.width) * 2)
  const want = Math.min(limit, need)
  const key = sharpKey(m)
  if (!source || want < m.width * 1.15 || (sharpening.get(key) ?? 0) >= want) return
  sharpening.set(key, want)
  void (async () => {
    const made = await widenStill($, source, want)
    if (!made) return
    sharpest.set(key, { path: made.path, width: made.width, height: made.height, generation: made.generation })
    useSharpest(m)
    redraw($)
  })().catch(() => undefined)
}
async function widenStill($: EngineInterface, source: string, width: number): Promise<Shown | null> {
  const out = `${state.TMP}/w-${keyOf(source)}-${width}.png`
  const made = state.isMac
    ? await $.process.run(['sips', '-s', 'format', 'png', '--resampleWidth', String(width), source, '--out', out]).catch(() => null)
    : await $.process.run([state.ffmpeg, '-v', 'error', '-y', '-i', source, '-frames:v', '1', '-vf', `scale=${width}:-2:flags=lanczos`, out]).catch(() => null)
  if (!made || made.exitCode !== 0) return null
  state.generation += 1
  return { kind: 'image', path: out, source, ...(await pngSize($, out)), title: '', generation: state.generation }
}
// The window size the cell was last measured at (see Viewer).
let cellFor = ''

export const sideOf = (shown: Shown, site: string): Shown =>
  player(site).isCompare && shown.compare ? shown.compare : shown
// Each side draws in a picture of its own: one side swapped into the other's
// picture would keep that one's size and place.
const viewKey = (site: string) => (player(site).isCompare ? 'view-original' : 'view')

export type Source = { png: string } | { file: string; format: 'png'; generation?: number }

// Which copy of a picture is sent: its data saver copy, or the full one.
export type Mode = 'saver' | 'full'
export type Pick = { file: string; mode: Mode; width: number; height: number }
const modeNow = (site: string, media: Shown): Mode => (media.saver && !player(site).isFull ? 'saver' : 'full')
const pickOf = (media: Shown, mode: Mode): Pick =>
  mode === 'saver' && media.saver
    ? { file: media.saver.path, mode, width: media.saver.width, height: media.saver.height }
    : { file: media.path, mode: 'full', width: media.width, height: media.height }

// Claude Code takes at most 2 MiB of picture as bytes: a bigger one is sent as
// a smaller copy, made once with whatever the machine has (sips, ffmpeg or
// ImageMagick) and kept in the temp folder.
const BYTES_MAX = 2_000_000
export const SHRINK_SH = [
  'f="$0"; out="$1"; ff="$2"; max="$3"',
  'size() { wc -c < "$1" | tr -d " "; }',
  '[ "$(size "$f")" -le "$max" ] && { echo "$f"; exit 0; }',
  '[ -s "$out" ] && [ "$(size "$out")" -le "$max" ] && { echo "$out"; exit 0; }',
  'w=1600',
  'while [ "$w" -ge 200 ]; do',
  '  rm -f "$out"',
  '  if command -v sips >/dev/null 2>&1; then sips -s format png --resampleWidth "$w" "$f" --out "$out" >/dev/null 2>&1',
  '  elif [ -x "$ff" ]; then "$ff" -v error -y -i "$f" -vf "scale=$w:-2" "$out" </dev/null 2>/dev/null',
  '  elif command -v magick >/dev/null 2>&1; then magick "$f" -resize "${w}x" "$out" 2>/dev/null',
  '  elif command -v convert >/dev/null 2>&1; then convert "$f" -resize "${w}x" "$out" 2>/dev/null',
  '  else exit 1; fi',
  '  [ -s "$out" ] && [ "$(size "$out")" -le "$max" ] && { echo "$out"; exit 0; }',
  '  w=$((w * 3 / 4))',
  'done',
  'exit 1',
].join('\n')
const fitted = new Map<string, string>()
// The last few pictures read, so a button press that redraws the player
// doesn't read and send its picture from disk again.
const recentBytes = new Map<string, string>()
async function bytesOf($: EngineInterface, file: string): Promise<string | null> {
  const known = recentBytes.get(file)
  if (known) return known
  const png = await readBytes($, file)
  if (png) {
    recentBytes.set(file, png)
    if (recentBytes.size > 6) recentBytes.delete(recentBytes.keys().next().value!)
  }
  return png
}
async function readBytes($: EngineInterface, file: string): Promise<string | null> {
  // Most files are under the limit: read them as they are, with no process
  // started.
  if (!fitted.has(file)) {
    const direct = await Promise.resolve().then(() => $.fs.read(file, { as: 'bytes' })).catch(() => null)
    if (direct?.base64 && direct.base64.length * 0.75 <= BYTES_MAX) return direct.base64
  }
  let small = fitted.get(file)
  if (!small) {
    const r = await Promise.resolve().then(() => $.process.run(['sh', '-c', SHRINK_SH, file, `${state.TMP}/b-${keyOf(file)}.png`, state.ffmpeg, String(BYTES_MAX)])).catch(() => null)
    small = r?.exitCode === 0 ? r.stdout.trim() : ''
    if (!small) return null
    fitted.set(file, small)
  }
  const loaded = await Promise.resolve().then(() => $.fs.read(small!, { as: 'bytes' })).catch(() => null)
  return loaded?.base64 ?? null
}
export async function pngSource($: EngineInterface, file: string): Promise<Source> {
  if (state.sendBytes) {
    const png = await bytesOf($, file)
    if (png) return { png }
  }
  return { file, format: 'png' as const }
}

// What draws a picture: the Image's source.
type Pic = { src: Source }

async function picFor($: EngineInterface, file: string, _box: { columns: number; rows: number }): Promise<Pic> {
  return { src: await pngSource($, file) }
}

// Every picture sent to the terminal is a line in the temp folder's
// send.log: when, the site, which copy, its pixels and bytes, how long
// $.ui.blit took ('-' for a render's own send, which isn't timed) and what
// sent it. A file source crosses as a path ('file'). Kept under a megabyte.
export function sendLine(at: number, site: string, pick: { mode: Mode | 'dot'; width: number; height: number }, src: Source, ms: number | null, via: 'render' | 'blit' | 'probe') {
  const dims = 'png' in src ? pngDims(src.png) : null
  const bytes = 'png' in src ? (src.png.length / 4) * 3 - (src.png.match(/=*$/)?.[0].length ?? 0) : 'file'
  return `${new Date(at).toISOString()} ${site} ${pick.mode} ${dims?.width ?? pick.width}x${dims?.height ?? pick.height} ${bytes} ${ms === null ? '-' : Math.round(ms)} ${via}`
}
const LOG_SH = '[ -L "$0" ] && exit 1; [ -f "$0" ] && [ "$(wc -c < "$0")" -gt 1000000 ] && : > "$0"; printf "%s\\n" "$1" >> "$0"'
function logSend($: EngineInterface, line: string) {
  void Promise.resolve().then(() => $.process.run(['sh', '-c', LOG_SH, `${state.TMP}/send.log`, line])).catch(() => undefined)
}
// A render sends its picture when the picture or its box is new to the Image.
const lastDrawn = new Map<string, string>()
function noteDrawn($: EngineInterface, site: string, key: string, pick: Pick, src: Source, box: Box) {
  const id = `${site}|${key}`, what = `${pick.file}|${box.columns}x${box.rows}`
  if (lastDrawn.get(id) === what) return
  lastDrawn.set(id, what)
  void $.clock.now().then(at => logSend($, sendLine(at, site, pick, src, null, 'render')), () => undefined)
}

// After a first draw, asks whether the picture really drew; if the terminal
// can only show the alt text, every player shows a notice instead.
// A blit's answer depends on the terminal and on the kind of source (a path
// or bytes), never on the picture, and a blit that is allowed sends what it
// was given. So a picture sent as bytes is asked about with a one-cell clear
// dot of its own (DOT, 68 bytes), drawn beside the title until the answer
// comes, instead of with the picture again. A path costs only the path: the
// picture on screen is asked about itself.
export const DOT = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII='
export const DOT_KEY = 'probe-dot'
export const probesWithDot = (src: Source) => 'png' in src
function probe($: EngineInterface, site: string, key: string, pic: Pic, pick: Pick) {
  if (!state.canImage || state.probed) return
  state.probed = true
  const isDot = probesWithDot(pic.src)
  if (isDot) state.dotSite = site
  void $.clock.sleep(250).then(async () => {
    try {
      // Asked with the picture itself: one swapped in since then is the one on screen.
      const shownNow = isDot ? undefined : swaps.get(`${site}|${key}`)?.last
      const source: Source = isDot ? { png: DOT } : shownNow ? await pngSource($, shownNow.file) : pic.src
      const started = await $.clock.now()
      const r = await $.ui.blit({ requestId: site, key: isDot ? DOT_KEY : key, source })
      logSend($, sendLine(started, site, isDot ? { mode: 'dot', width: 1, height: 1 } : shownNow ?? pick, source, (await $.clock.now()) - started, 'probe'))
      if (r.deny && /alt/i.test(r.deny)) {
        state.canImage = false
        state.drawCause = causeOf(state.inTmux, state.terminalName)
        $.ui.toast("Pictures can't show here: see the notice in the chat.")
      }
    } finally {
      // The dot goes once answered: a redraw that sends nothing else.
      if (isDot) state.dotSite = ''
      if (!state.canImage) redraw($)
      else if (isDot) redraw($, site)
    }
  }).catch(() => undefined)
}

// Swaps a site's picture in place, one swap at a time per picture, the newest
// winning: a slow swap is never overtaken by the next (pictures drawn out of
// order) and never queues up behind it.
// Each draw takes a ticket; one whose picture was ready later than a newer
// draw's is stale and skipped.
const swaps = new Map<string, { isBusy: boolean; ticket: number; next?: Pick; last?: Pick }>()
let tickets = 0
async function blit($: EngineInterface, site: string, key: string, file: Pick, ticket = ++tickets) {
  if (!state.canImage) return
  const id = `${site}|${key}`
  let lane = swaps.get(id)
  if (!lane) swaps.set(id, (lane = { isBusy: false, ticket: 0 }))
  if (ticket < lane.ticket) return
  lane.ticket = ticket
  if (lane.isBusy) {
    lane.next = file
    return
  }
  lane.isBusy = true
  let job: Pick | undefined = file
  try {
    while (job) {
      const source = await pngSource($, job.file)
      const started = await $.clock.now()
      await $.ui.blit({ requestId: site, key, source })
      logSend($, sendLine(started, site, job, source, (await $.clock.now()) - started, 'blit'))
      lane.last = job
      job = lane.next
      lane.next = undefined
    }
  } finally {
    lane.isBusy = false
  }
}

// Sends the side on screen to the terminal again, in place: the copy the
// site shows now (data saver's or the full one).
export function draw($: EngineInterface, site: string, media: Shown) {
  void blit($, site, viewKey(site), pickOf(media, modeNow(site, media))).catch(() => undefined)
}

// Show full size / Show small: the other copy is swapped into the same
// picture in place. The full one is read and sent only when first asked for.
// The redraw only relabels the button: the Image keeps the source it was
// drawn with (drawnAs), so the picture isn't sent a second time.
function toggleFull($: EngineInterface, site: string, shown: Shown) {
  const one = player(site)
  const media = sideOf(shown, site)
  if (!media.saver) return
  one.isFull = !one.isFull
  void blit($, site, viewKey(site), pickOf(media, modeNow(site, media))).catch(() => undefined)
  redraw($, site)
}

// The data saver switch, remembered across sessions; it applies to pictures
// shown from now on. SHOW_YOUR_WORK_LINK overrides it: then the button only
// says so (a Button can't be disabled).
async function switchSaver($: EngineInterface, isOn: boolean) {
  await saveSetting($, 'dataSaver', isOn)
  $.ui.toast(isOn ? 'Data saver on: pictures shown from now on are sent small.' : 'Data saver off: pictures shown from now on are sent full size.')
  redraw($)
}
function SaverSwitch(ui: Ui, $: EngineInterface) {
  const { Button } = ui
  const isOn = isDataSaver()
  const label = `Data saver: ${isOn ? 'on' : 'off'}`
  if (isLinkForced(state.link)) {
    return <Button key="data-saver" plain dimColor label={`${label} (env)`} onPress={() => void $.ui.toast(`SHOW_YOUR_WORK_LINK=${state.link} sets this. Unset it to choose here.`)} />
  }
  return <Button key="data-saver" plain dimColor label={label} onPress={() => void switchSaver($, !isOn).catch(() => $.ui.toast('Could not save the data saver setting'))} />
}

function flip($: EngineInterface, site: string, shown: Shown, toCompare: boolean) {
  const one = player(site)
  if (!shown.compare || !!one.isCompare === toCompare) return
  one.isCompare = toCompare
  // The side switched to is a new Image: drawn with the copy the site shows
  // now, and only now, so the side not on screen sends nothing until then.
  const key = viewKey(site)
  if (one.drawnAs) one.drawnAs[key] = undefined
  lastDrawn.delete(`${site}|${key}`)
  // A still is drawn by the redraw at its own size; a swap would put it in
  // the other side's box first.
  redraw($, site)
}

// The engine's UI components come untyped through $.ui.resolve.
// biome-ignore lint/suspicious/noExplicitAny: the engine gives its UI components no types
export type Ui = any
type Box = { columns: number; rows: number }

// The picture.
function Picture(ui: Ui, $: EngineInterface, site: string, shown: Shown, media: Shown, box: Box, pic: Pic, frame: Box = box) {
  const { Box, Text, Image } = ui
  if (!Image) return <Text dimColor>This surface cannot draw images.</Text>

  // The picture stands alone: no wrapper, nothing laid over it and no fill
  // behind it. Each of those kept the picture from drawing in Ghostty.
  // The same file in a box of another size (a resized window) is sent again:
  // the terminal keeps a picture at the size it was last sent at.
  const source = 'file' in pic.src ? { ...pic.src, generation: box.columns * 1000 + box.rows } : pic.src
  const image = (
    <Image
      key={viewKey(site)}
      source={source}
      columns={box.columns}
      rows={box.rows}
      alt={`[${media.kind ?? 'image'}: ${shown.title}]`}
    />
  )
  if (frame.columns === box.columns && frame.rows === box.rows) return image
  // A side smaller than the frame it shares sits centred in it, unfilled.
  return <Box width={frame.columns} height={frame.rows} justifyContent="center" alignItems="center">{image}</Box>
}

// The player's zones, the same in every view:
//   TitleBar  the title (only it gives way), a PR link, the tabs
//   stage     the picture and the buttons under it
//   Report    what changed, then QA: beside the stage when wide, else under it
function TitleBar(ui: Ui, $: EngineInterface, site: string, shown: Shown, at: { width?: number; pr?: Ui }) {
  const { Box, Text, Image } = ui
  return (
    <Box key="title-bar" flexDirection="row" justifyContent="space-between" gap={2} width={at.width}>
      <Box flexDirection="row" gap={2} flexShrink={1} flexGrow={1}>
        <Text bold wrap="truncate-end">{shown.title}</Text>
        {/* The first draw's probe asks with this dot (see probe): clear, one cell, gone once answered. */}
        {Image && state.dotSite === site && <Image key={DOT_KEY} source={{ png: DOT }} columns={1} rows={1} alt=" " />}
      </Box>
      <Box flexDirection="row" gap={2} flexShrink={0}>
        {at.pr}
        {Tabs(ui, $, site, shown)}
      </Box>
    </Box>
  )
}

// The tab row's width: each Button draws as "[ label ]", one apart.
export function tabsWidth(shown: Shown) {
  if (!shown.compare) return 0
  const labels = [tabLabel(shown.compare.label ?? 'Original'), tabLabel(shown.label ?? 'Updated')]
  return labels.reduce((n, l) => n + l.length + 4, 0) + labels.length - 1
}
// Original / Updated: the side shown is the accent button.
function Tabs(ui: Ui, $: EngineInterface, site: string, shown: Shown) {
  const { Box, Button } = ui
  if (!shown.compare) return null
  const isCompare = !!player(site).isCompare

  return (
    <Box flexDirection="row" gap={1}>
      <Button key="side-before" variant={isCompare ? 'primary' : 'secondary'} label={tabLabel(shown.compare.label ?? 'Original')} onPress={() => flip($, site, shown, true)} />
      <Button key="side-after" variant={isCompare ? 'secondary' : 'primary'} label={tabLabel(shown.label ?? 'Updated')} onPress={() => flip($, site, shown, false)} />
    </Box>
  )
}

// The QA line on top: how many checks passed, from the summary.
export function qaTotals(summary: Summary[] = []) {
  if (summary.some(s => s.total !== undefined)) {
    const total = summary.reduce((n, s) => n + (s.total ?? 0), 0)
    const passed = summary.reduce((n, s) => n + (s.passed ?? (s.ok ? s.total ?? 0 : 0)), 0)
    return { passed, total }
  }
  // Plain lines, a label and a tick each: one apiece.
  return { passed: summary.filter(s => s.ok).length, total: summary.length }
}

// Room for a change's title and a QA line, in a column this wide.
const titleWidth = (column: number) => column - 4 /* "12. " */
const labelWidth = (column: number) => column - 4 /* card border + padding */ - 2 /* "✓ " */ - 5 /* " 11/11" */
// Under the player, what changed and the QA sit side by side from this width.
const TWO_COLUMNS = 72

// Rows the sidebar spends on everything but the change rows.
export function changesThatFit(height: number, summaryRows: number, hasPr: boolean) {
  const qa = summaryRows >= 0 ? 1 /* gap */ + 1 /* label */ + 2 /* card border */ + 1 /* verdict */ + summaryRows : 0
  const fixed = 2 /* padding */ + 1 /* label */ + qa + (hasPr ? 2 : 0)
  return Math.max(1, height - fixed)
}

// The report: what changed, the QA in a card, then the PR. Text wraps;
// nothing is cut. Beside the player it is a sidebar exactly as tall as the
// player, paging what doesn't fit; under it (a narrow window) it spans the
// player's width, in two columns when there's room.
function Report(ui: Ui, $: EngineInterface, site: string, shown: Shown, prLink: Ui, at: { width: number; height?: number }) {
  const { Box, Text, Button } = ui
  const one = player(site)
  const media = sideOf(shown, site)
  const { width, height } = at
  const isBeside = height !== undefined
  const isTwo = !isBeside && width - 4 >= TWO_COLUMNS
  const column = isTwo ? Math.floor((width - 4 - 3) / 2) : width - 4
  const TITLE = titleWidth(column), LABEL = labelWidth(column)
  const changes = shown.changes?.length ? shown.changes : shown.change ? [{ title: shown.change }] : []
  // The summary is the updated side's.
  const summary = (media === shown ? shown.summary ?? [] : []).slice(0, 3).map(s => ({ ...s, lines: wrapWords(s.label, LABEL) }))
  const { passed, total } = qaTotals(summary)
  const allPass = total > 0 && passed === total
  const summaryRows = summary.reduce((n, s) => n + s.lines.length, 0)
  const room = isBeside ? changesThatFit(height, total > 0 ? summaryRows : -1, !!prLink) : Number.POSITIVE_INFINITY
  const wrapped = changes.map((c, n) => ({ n, lines: wrapWords(c.title, TITLE) }))
  const pages = pagesOf(wrapped.map((w, i) => ({ item: w, rows: w.lines.length + (i ? 1 : 0) })), room)
  const page = Math.min(one.changesPage ?? 0, pages.length - 1)
  const label = (text: string, right?: Ui) => (
    <Box flexDirection="row" justifyContent="space-between">
      <Text dimColor bold>{text}</Text>
      {right}
    </Box>
  )

  const changed = (
    <Box flexDirection="column" width={column}>
      {label(
        `WHAT CHANGED · ${changes.length}`,
        pages.length > 1 ? (
          <Button
            key="changes-more"
            plain
            dimColor
            label={`${page + 1}/${pages.length} ${page === pages.length - 1 ? '↑' : '↓'}`}
            onPress={() => {
              one.changesPage = (page + 1) % pages.length
              redraw($, site)
            }}
          />
        ) : undefined,
      )}
      {(pages[page] ?? []).map(({ n, lines }, k) => (
        <Box key={`change-${n}`} flexDirection="row" gap={1} marginTop={k ? 1 : 0}>
          <Text dimColor>{`${n + 1}.`.padStart(3)}</Text>
          <Box flexDirection="column" width={TITLE}>
            {lines.map((line, i) => <Text key={`change-${n}-${i}`}>{line}</Text>)}
          </Box>
        </Box>
      ))}
    </Box>
  )
  const qa = total > 0 && (
    <Box flexDirection="column" width={column} marginTop={isTwo ? 0 : 1}>
      {label('QA', <Text bold color={allPass ? 'success' : 'error'}>{passed}/{total}</Text>)}
      <Box flexDirection="column" borderStyle="round" borderColor={allPass ? 'success' : 'error'} borderDimColor paddingX={1}>
        <Text bold color={allPass ? 'success' : 'error'}>
          {allPass ? '✓ All checks passed' : `✗ ${total - passed} of ${total} checks failed`}
        </Text>
        {summary.map(s => (
          <Box key={`sum-${s.label}`} flexDirection="row" gap={1}>
            <Text color={s.ok ? 'success' : 'error'}>{s.ok ? '✓' : '✗'}</Text>
            <Box flexDirection="column" width={LABEL}>
              {s.lines.map((line, i) => <Text key={`sum-${s.label}-${i}`}>{line}</Text>)}
            </Box>
            {s.total !== undefined && <Text dimColor>{`${s.passed ?? (s.ok ? s.total : 0)}/${s.total}`.padStart(5)}</Text>}
          </Box>
        ))}
      </Box>
    </Box>
  )

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden" backgroundColor={SIDEBAR}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box flexDirection="column">
          {changes.length > 0 && (isTwo ? <Box flexDirection="row" gap={3}>{changed}{qa}</Box> : changed)}
          {(!isTwo || !changes.length) && qa}
        </Box>
        {prLink && <Box flexDirection="row" gap={1} marginTop={1}><Text dimColor>PR</Text>{prLink}</Box>}
      </Box>
    </Box>
  )
}

// Scratch output lives in temp folders; finished work lives somewhere real.
export const isScratch = (path: string) => /^\/(private\/)?(tmp|var\/folders)\//.test(path)

// What you do with the file: keep it (or find it), or paste its path elsewhere.
function Actions(ui: Ui, $: EngineInterface, source: string, isNarrow: boolean) {
  const { Box, Button } = ui
  const done = (r: { exitCode: number; stderr: string }, note: string) =>
    $.ui.toast(r.exitCode === 0 ? note : `Could not: ${r.stderr.trim().slice(0, 120)}`)
  const name = source.split('/').pop()!
  const keep = async () => {
    // A free name: "shot.png", then "shot 2.png", "shot 3.png"…
    const dot = name.lastIndexOf('.')
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
    let out = `${state.home}/Downloads/${name}`
    for (let n = 2; await $.fs.stat(out).then(() => true, () => false); n++) out = `${state.home}/Downloads/${stem} ${n}${ext}`
    if (!state.isMac) await $.process.run(['mkdir', '-p', `${state.home}/Downloads`])
    const r = await $.process.run(['cp', source, out])
    if (r.exitCode === 0) await $.process.run(state.isMac ? ['open', '-R', out] : ['xdg-open', `${state.home}/Downloads`]).catch(() => undefined)
    done(r, `Saved to Downloads/${out.split('/').pop()}`)
  }

  return (
    <Box flexDirection="row" gap={2}>
      {!source.startsWith(`${state.home}/Downloads/`) ? (
        <Button key="keep" plain dimColor label="Save to Downloads" onPress={() => void keep()} />
      ) : (
        <Button key="reveal" plain dimColor label={state.isMac ? 'Show in Finder' : 'Show in folder'} onPress={() => void $.process.run(state.isMac ? ['open', '-R', source] : ['xdg-open', source.slice(0, source.lastIndexOf('/')) || '/']).then(r => done(r, state.isMac ? 'Shown in Finder' : 'Opened the folder'))} />
      )}
      {!isNarrow && (
        <Button
          key="copy"
          plain
          dimColor
          label="Copy path"
          onPress={(press: { surface: 'terminal' }) =>
            void $.ui.copy({ text: source, surface: press.surface }).then(r => $.ui.toast(r.isCopied ? 'Path copied' : 'Could not copy the path'))
          }
        />
      )}
    </Box>
  )
}

// Resumes this chat outside the background service, so pictures draw again.
// A session still running in the background can't be resumed: it's stopped first.
export const resumeCommand = (id: string) =>
  id ? `claude stop ${id}; CLAUDE_CODE_DISABLE_AGENT_VIEW=1 claude --resume ${id}` : 'CLAUDE_CODE_DISABLE_AGENT_VIEW=1 claude --resume'

// Why pictures can't draw here, once a draw has failed: tmux blocking them,
// a terminal without picture support, or a background session.
export type DrawCause = 'tmux' | 'terminal' | 'background'
export const causeOf = (tmux: boolean, terminal: string): DrawCause =>
  tmux ? 'tmux' : /^(ghostty|kitty)$/.test(terminal) ? 'background' : 'terminal'

// The notice for a picture that couldn't draw, and the line Claude reads.
const GHOSTTY = 'https://ghostty.org/download'

export function cantDraw(cause: DrawCause, name: string, id: string) {
  if (cause === 'tmux') return {
    title: 'tmux is blocking pictures',
    text: `"${name}" is ready, but tmux stops pictures from reaching the terminal. Add this line to ~/.tmux.conf, reload tmux, and ask Claude to show it again. Or open this chat outside tmux.`,
    command: 'set -g allow-passthrough on', label: 'Copy setting', action: 'copy_tmux_setting',
    claude: `tmux is blocking pictures, so the person saw a notice instead of ${name}. They can add "set -g allow-passthrough on" to ~/.tmux.conf or open the chat outside tmux.`,
  }
  if (cause === 'terminal') return {
    title: "Your terminal isn't supported by show-your-work",
    text: `"${name}" is ready, but this terminal can't draw pictures. You need Ghostty to see them. Download it here, it's free and takes a minute:`,
    // biome-ignore lint/suspicious/noThenProperty: plain data, never awaited
    link: { href: GHOSTTY, then: 'Then press Copy command and paste it in Ghostty to open this chat there.' },
    command: `claude --resume${id ? ` ${id}` : ''}`, label: 'Copy command', action: 'copy_resume_command',
    claude: `this terminal can't draw pictures, so the person saw a notice instead of ${name}. They need Ghostty to see it; it's free at ${GHOSTTY}.`,
  }
  return {
    title: "Can't show pictures in a background session",
    text: `"${name}" is ready, but this chat is running as a background session, and those can't draw pictures in the terminal. Press Copy command and paste it in a normal Ghostty tab to reopen it there.`,
    command: resumeCommand(id), label: 'Copy command', action: 'copy_resume_command',
    claude: `this chat runs as a background session, which can't draw pictures, so the person saw a notice instead of ${name}. They can resume the chat in a normal terminal tab to see it.`,
  }
}

function Warning(ui: Ui, $: EngineInterface, shown: Shown, width: number) {
  const n = cantDraw(state.drawCause, shown.title, state.sessionId)
  return NoticeBox(ui, $, width, { ...n, copy: n.command })
}

// The file behind a preview is gone (temp cleared, or the original moved):
// say so in place of a blank box, with a prompt to paste.
export function expiredPrompt(shown: Shown): string {
  const file = shown.source ?? shown.path
  return `The image preview "${shown.title}" expired (${file} is gone). Please regenerate it and show it to me again with show_image${shown.compare ? ', with the same compare' : ''}${shown.changes?.length ? ' and the same list of changes' : ''}.`
}
function Expired(ui: Ui, $: EngineInterface, shown: Shown, width: number) {
  return NoticeBox(ui, $, width, {
    title: 'This preview has expired',
    text: `"${shown.title}" was cleared from the preview cache, and its file is no longer there. Copy the prompt and paste it to Claude to send it again.`,
    copy: expiredPrompt(shown), label: 'Copy prompt', action: 'copy_expired_prompt',
  })
}

// A failure, drawn in place of the picture: what happened, in plain words,
// and one button that copies what to paste back (a prompt, or a command).
export function NoticeBox(ui: Ui, $: EngineInterface, width: number, n: { title: string; text: string; command?: string; copy: string; label: string; action: string; link?: { href: string; then: string } }) {
  const { Box, Text, Button, Link } = ui
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={2} paddingY={1} width={Math.max(40, Math.min(width, 96))}>
      <Text bold color="warning">⚠ {n.title}</Text>
      <Text wrap="wrap">{'\n'}{n.text}</Text>
      {n.link ? <Box marginTop={1}><Link href={n.link.href} /></Box> : null}
      {n.link ? <Text wrap="wrap">{'\n'}{n.link.then}</Text> : null}
      {/* A resume command is long and only ever pasted: the button copies it, unseen. */}
      {n.command && n.action !== 'copy_resume_command' ? <Box marginTop={1}><Text bold>{n.command}</Text></Box> : null}
      <Box flexDirection="row" gap={2} marginTop={1}>
        <Button
          key={n.action}
          variant="primary"
          label={n.label}
          onPress={(press: { surface: 'terminal' }) =>
            void $.ui.copy({ text: n.copy, surface: press.surface }).then(r => $.ui.toast(r.isCopied ? (n.command ? 'Copied. Paste it in your terminal.' : 'Copied. Paste it to Claude.') : 'Could not copy'))
          }
        />
      </Box>
    </Box>
  )
}

// The player: the picture and its buttons everywhere, with the QA report at
// its side when there is a report and room for it.
export async function Viewer(
  $: EngineInterface,
  e: Parameters<EngineInterface['ui']['resolve']>[0],
  shown: Shown,
  site: string,
  isPane: boolean,
  viewport: { columns: number; rows: number } | undefined,
) {
  const ui = $.ui.resolve(e) as Ui
  const { Box, Text, Button, Link } = ui
  const one = player(site)
  const media = sideOf(shown, site)
  const source = media.source ?? media.path
  const columns = viewport?.columns ?? 100
  const hasReport = !!(shown.change || shown.changes?.length || shown.summary?.length)
  const layout = layoutOf({ columns, rows: viewport?.rows ?? 40, isPane, hasReport })
  const isWide = layout.isWide
  const other = shown.compare ? (media === shown ? shown.compare : shown) : null
  // A side short of pixels for its box gets a sharper copy, made in the
  // background; never with data saver on (mayWiden).
  for (const side of [media, other]) if (side && mayWiden(side)) useSharpest(side)
  if (state.cell) for (const side of [media, other]) if (side && mayWiden(side)) sharpen($, side, pixelsFor(targetBox(side.width, side.height, layout, state.cell), state.cell, side.width / side.height))
  // This side's own box, and the frame it sits in: Original and Updated
  // share the larger of their two boxes, so switching never moves the layout
  // and each side draws whole at its own size, centred.
  const own = drawBox(media.width, media.height, layout, state.cell)
  const theirs = other ? drawBox(other.width, other.height, layout, state.cell) : own
  const box = { columns: Math.max(own.columns, theirs.columns), rows: Math.max(own.rows, theirs.rows) }
  // A new window or font size: the cell is measured again, and only a cell
  // that really changed redraws.
  const size = `${columns}x${viewport?.rows ?? 0}`
  if (cellFor !== size) {
    cellFor = size
    void $.clock.sleep(0).then(() => remeasure($)).then(isChanged => { if (isChanged) redraw($) }, () => undefined)
  }
  const isNarrow = box.columns < 60
  // Under the player the report takes at least a readable width, even beside a tall, thin picture.
  const below = hasReport && !isWide ? Math.max(box.columns, Math.min(layout.inner, 72)) : box.columns
  const prNumber = shown.pr?.match(/\/pull\/(\d+)/)?.[1]
  const prLabel = prNumber ? `PR #${prNumber}` : shown.pr
  const prLink = shown.pr
    ? /^https?:\/\//.test(shown.pr)
      ? <Link href={shown.pr} label={prLabel} />
      : <Text color="suggestion">{prLabel}</Text>
    : null

  if (!state.canImage) return Warning(ui, $, shown, columns - 8)
  // A new box sends the picture again anyway: it goes as the copy shown now.
  const key = viewKey(site)
  const drawnAs = (one.drawnAs ??= {})
  if (one.box && (one.box.columns !== own.columns || one.box.rows !== own.rows)) drawnAs[key] = undefined
  one.box = { columns: own.columns, rows: own.rows }
  if (await isGone($, media.path)) return Expired(ui, $, shown, columns - 8)
  // A data saver copy cleared from the temp folder: the full one stands in.
  if (media.saver && (await isGone($, media.saver.path))) media.saver = undefined
  const pick = pickOf(media, (drawnAs[key] ??= modeNow(site, media)))
  const pic = await picFor($, pick.file, own)
  noteDrawn($, site, key, pick, pic.src, own)
  probe($, site, key, pic, pick)

  const actions = Actions(ui, $, source, isNarrow)
  // The top corner opens it: the page it shows, else the file itself.
  // Only a web address opens as a page: a model's url could name an app, a
  // script or an option for `open`.
  const at = media.url
  const page = (at && /^https?:\/\/[^\s]+$/i.test(at) ? at : undefined) ?? (/\.html?$/i.test(source) ? source : undefined)
  const opener = (
    <Button
      key="page"
      plain
      label={page ? '↗ Open page' : '↗ View'}
      onPress={() =>
        void $.process.run([openCommand(), page ?? source]).then(r =>
          $.ui.toast(r.exitCode === 0 ? `Opened ${(page ?? source.split('/').pop()!).slice(0, 60)}` : 'Could not open it'),
        )
      }
    />
  )

  // A tall, narrow picture still gets a button row wide enough to read on one
  // line; the picture sits centred above it.
  // ...but never wider than the window has room for.
  // At least the buttons' width, and the title bar's tabs with a little title.
  const controlsMin = Math.min(Math.max(CONTROLS_MIN, tabsWidth(shown) + 14), columns - 8)
  const rowWidth = Math.max(box.columns, controlsMin)
  const stage = (
    <Box flexDirection="column" width={rowWidth} alignItems="center">
      {Picture(ui, $, site, shown, media, own, pic, box)}
      <Box flexDirection="row" justifyContent="flex-end" columnGap={2} flexWrap="wrap" width={rowWidth}>
        <Box flexDirection="row" columnGap={2}>
          {opener}
          {actions}
        </Box>
        {/* Data saver's two buttons: their own group, so a narrow row wraps them under the rest. */}
        <Box flexDirection="row" columnGap={2}>
          {media.saver && <Button key="full-size" plain dimColor label={one.isFull ? 'Show small' : 'Show full size'} onPress={() => toggleFull($, site, shown)} />}
          {SaverSwitch(ui, $)}
        </Box>
      </Box>
    </Box>
  )

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} width={(isWide ? Math.max(box.columns, controlsMin) + SIDE + 3 : Math.max(box.columns, controlsMin, below)) + 4}>
      {TitleBar(ui, $, site, shown, {})}
      {!hasReport && prLink && (
        <Box flexDirection="row" gap={2}>
          {prLink}
          {shown.change && <Text dimColor wrap="truncate-end">{shown.change}</Text>}
        </Box>
      )}
      <Box flexDirection="row" gap={3} marginTop={1}>
        {stage}
        {isWide && Report(ui, $, site, shown, prLink, { width: SIDE, height: box.rows + 2 })}
      </Box>
      {!isWide && hasReport && <Box marginTop={1}>{Report(ui, $, site, shown, prLink, { width: below })}</Box>}
    </Box>
  )
}

// The one line a show call's row reads: what it shows, and what with.
export function toolLine(input: unknown, isRunning: boolean): string {
  const i = (input ?? {}) as { path?: string; title?: string; compare?: string; compare_label?: string }
  const what = i.title ?? i.path?.split('/').pop() ?? ''
  const vs = i.compare ? ` · vs ${i.compare_label ?? i.compare.split('/').pop()}` : ''

  return `▣ ${isRunning ? 'Loading image' : 'Image'} · ${what}${vs}`
}
