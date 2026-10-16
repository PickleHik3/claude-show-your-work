import { expect, test } from 'claude-code/testing'

import { dataSaverOf, isLinkForced, saveSetting } from '../hooks/settings'
import { SAVER_PX, saverWidth } from '../hooks/layout'
import { isDataSaver, SAVER_SH, saverCopy, saverNote } from '../hooks/media'
import { sendLine } from '../hooks/player'
import { state } from '../hooks/state'

// A real 3×2 PNG, 68 bytes.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAC0lEQVR4nGNgwAQAABQAAX3+Hu4AAAAASUVORK5CYII='

test('data saver: the env var first, then the saved choice, then ssh', () => {
  expect(dataSaverOf('slow', false, false)).toBe(true)
  expect(dataSaverOf('fast', true, true)).toBe(false)
  expect(dataSaverOf('', true, false)).toBe(true)
  expect(dataSaverOf('', false, true)).toBe(false)
  expect(dataSaverOf('', undefined, true)).toBe(true)
  expect(dataSaverOf('', undefined, false)).toBe(false)
  // Anything but slow or fast leaves it to the setting.
  expect(dataSaverOf('medium', undefined, true)).toBe(true)
  expect(isLinkForced('slow')).toBe(true)
  expect(isLinkForced('')).toBe(false)
})

test('a data saver copy is the pane wide, never wider than the picture', () => {
  // SHOW_YOUR_WORK_PX wins.
  expect(saverWidth(1440, 900, { width: 18, height: 36 }, { columns: 59 })).toBe(900)
  // Else the measured cell times the columns.
  expect(saverWidth(1440, 0, { width: 18.3, height: 36 }, { columns: 59 })).toBe(1080)
  // Else a phone's width.
  expect(saverWidth(1440, 0, null, null)).toBe(SAVER_PX)
  expect(SAVER_PX).toBe(1080)
  // Never upscaled; a tall screenshot keeps its full width.
  expect(saverWidth(720, 0, null, null)).toBe(720)
  expect(saverWidth(1080, 2000, null, null)).toBe(1080)
})

test('Claude reads the data saver copy in the first line', () => {
  expect(saverNote({ path: '/t/s.png', width: 1080, height: 2400, bytes: 186_034 })).toBe('data saver, 1080×2400, 186 KB')
  expect(saverNote({ path: '/t/s.png', width: 300, height: 200, bytes: 120 })).toBe('data saver, 300×200, 1 KB')
  expect(saverNote(undefined)).toBe('')
})

test('a send log line has the time, site, copy, pixels, bytes and blit time', () => {
  const pick = { file: '/t/s.png', mode: 'saver' as const, width: 1080, height: 2400 }
  // The pixels and bytes are the ones sent, read from the PNG itself.
  expect(sendLine(0, 'tu-1', pick, { png: PNG }, 812.4, 'blit')).toBe('1970-01-01T00:00:00.000Z tu-1 saver 3x2 68 812 blit')
  // A render's own send isn't timed; a path crosses as a path.
  expect(sendLine(0, 'tu-1', { ...pick, mode: 'full' }, { file: '/t/a.png', format: 'png' }, null, 'render')).toBe('1970-01-01T00:00:00.000Z tu-1 full 1080x2400 file - render')
})

test('the copy is made once by the shell script, at the pane width, and sized from the file', async () => {
  const runs: string[][] = []
  const $ = {
    process: {
      run: async (argv: string[]) => {
        runs.push(argv)
        if (argv[0] === 'sh') return { exitCode: 0, stdout: '186034\n', stderr: '' }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
    fs: { read: async () => ({ base64: PNG }) },
  }
  const was = { isMac: state.isMac, TMP: state.TMP, cell: state.cell, termSize: state.termSize, saverPx: state.saverPx, ffmpeg: state.ffmpeg }
  Object.assign(state, { isMac: false, TMP: '/t/tmp dir', cell: null, termSize: null, saverPx: 0, ffmpeg: '/usr/bin/ffmpeg' })
  try {
    const wide = await saverCopy($ as never, '/t/shot.png', 1440, '/w/shot.png')
    expect(runs[0]!.slice(0, 3)).toEqual(['sh', '-c', SAVER_SH])
    expect(runs[0]![3]).toBe('/t/shot.png')
    expect(runs[0]!.slice(5)).toEqual(['1080', '/usr/bin/ffmpeg', '/w/shot.png'])
    expect(runs[0]![4]!.startsWith('/t/tmp dir/s-')).toBe(true)
    expect(runs[0]![4]!.endsWith('-1080.png')).toBe(true)
    expect(wide).toEqual({ path: runs[0]![4]!, width: 3, height: 2, bytes: 186034 })
    // Already narrow enough: colours only, no resize.
    await saverCopy($ as never, '/t/small.png', 720, '/w/small.png')
    expect(runs[1]![5]).toBe('0')
  } finally {
    Object.assign(state, was)
  }
})

test('no data saver copy when the script fails', async () => {
  const $ = { process: { run: async () => ({ exitCode: 1, stdout: '', stderr: '' }) }, fs: { read: async () => ({ base64: PNG }) } }
  expect(await saverCopy($ as never, '/t/shot.png', 1440, '/w/shot.png')).toBe(null)
})

// Every node of a drawn tree whose type is `type`.
const nodesOf = (node: any, type: string, out: any[] = []): any[] => {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const n of node) nodesOf(n, type, out); return out }
  if (node.type === type) out.push(node)
  nodesOf(node.children, type, out)
  return out
}
const buttonOf = (tree: any, key: string) => nodesOf(tree, 'Button').find(b => b.props.key === key)
const imagesOf = (tree: any) => nodesOf(tree, 'Image')

const saved = { kind: 'image', path: '/tmp/x/after.png', source: '/tmp/x/after.png', width: 1440, height: 3200, title: 'Trip', generation: 1, saver: { path: '/tmp/x/s-after-1080.png', width: 1080, height: 2400, bytes: 186034 } }
const rowOf = (id: string, shown: unknown) => ({
  plugin: 'show-your-work', surface: 'terminal', component: 'ToolResult', requestId: id,
  props: { tool_use_id: id, tool: 'mcp__show-your-work__show_image', output: `Shown.\nshow-your-work:${JSON.stringify(shown)}`, isErrored: false },
  viewport: { columns: 59, rows: 39 },
}) as any

test('a data saver picture draws its small copy, with Show full size beside it', async $ => {
  const mounted = await $.ui.mount(rowOf('saver-1', saved))
  const tree = await mounted.drawn()
  expect(imagesOf(tree).length).toBe(1)
  expect(imagesOf(tree)[0].props.source.file).toBe(saved.saver.path)
  expect(buttonOf(tree, 'full-size').props.label).toBe('Show full size')
  // The switch is there too, off by default here (no ssh in the harness).
  expect(buttonOf(tree, 'data-saver').props.label).toBe('Data saver: off')
})

test('Show full size swaps in place and relabels; the drawn source stays, so nothing is sent twice', async $ => {
  const mounted = await $.ui.mount(rowOf('saver-2', saved))
  await mounted.press({ key: 'full-size' })
  let tree = await mounted.drawn()
  expect(buttonOf(tree, 'full-size').props.label).toBe('Show small')
  // The full picture went by blit; the render keeps the source it was drawn with.
  expect(imagesOf(tree)[0].props.source.file).toBe(saved.saver.path)
  await mounted.press({ key: 'full-size' })
  tree = await mounted.drawn()
  expect(buttonOf(tree, 'full-size').props.label).toBe('Show full size')
})

test('a picture with no data saver copy has no Show full size', async $ => {
  const { saver: _, ...plain } = saved
  const tree = await (await $.ui.mount(rowOf('saver-3', plain))).drawn()
  expect(buttonOf(tree, 'full-size')).toBe(undefined)
  expect(imagesOf(tree)[0].props.source.file).toBe(plain.path)
})

test('compare draws only the side on screen; the other is drawn when switched to, as the copy the site shows', async $ => {
  const before = { ...saved, path: '/tmp/x/before.png', source: '/tmp/x/before.png', title: 'Original', saver: { ...saved.saver, path: '/tmp/x/s-before-1080.png' } }
  const mounted = await $.ui.mount(rowOf('saver-4', { ...saved, compare: before }))
  let tree = await mounted.drawn()
  expect(imagesOf(tree).length).toBe(1)
  expect(imagesOf(tree)[0].props.source.file).toBe(saved.saver.path)
  await mounted.press({ key: 'side-before' })
  tree = await mounted.drawn()
  expect(imagesOf(tree).length).toBe(1)
  expect(imagesOf(tree)[0].props.source.file).toBe(before.saver.path)
  // Full size is per site: switching back after it draws the full Updated.
  await mounted.press({ key: 'full-size' })
  await mounted.press({ key: 'side-after' })
  tree = await mounted.drawn()
  expect(imagesOf(tree)[0].props.source.file).toBe(saved.path)
  expect(buttonOf(tree, 'full-size').props.label).toBe('Show small')
})

test('the data saver choice is saved in the store, and decides from then on', async () => {
  const store = new Map<string, unknown>([['settings', { other: true }]])
  const $ = { store: { get: async (k: string) => store.get(k), set: async (k: string, v: unknown) => void store.set(k, v) } }
  const was = { link: state.link, sendBytes: state.sendBytes }
  Object.assign(state, { link: '', sendBytes: true })
  try {
    await saveSetting($ as never, 'dataSaver', false)
    expect(store.get('settings')).toEqual({ other: true, dataSaver: false })
    // Saved off beats ssh's default on.
    expect(isDataSaver()).toBe(false)
    await saveSetting($ as never, 'dataSaver', true)
    expect(isDataSaver()).toBe(true)
    // The env var beats the saved choice.
    state.link = 'fast'
    expect(isDataSaver()).toBe(false)
  } finally {
    await saveSetting($ as never, 'dataSaver', false)
    Object.assign(state, was)
  }
})
