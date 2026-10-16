import { expect, test } from 'claude-code/testing'

const shown = { kind: 'image', path: '/tmp/x/after.png', source: '/tmp/x/after.png', width: 960, height: 540, title: 'Agent QA', generation: 1 }

for (const columns of [140, 90]) {
  test(`the player draws a picture at ${columns} columns`, async $ => {
    const output = `Shown to the user: Agent QA.\nshow-your-work:${JSON.stringify(shown)}`
    const target = {
      plugin: 'show-your-work', surface: 'terminal', component: 'ToolResult', requestId: 'tu-1',
      props: { tool_use_id: 'tu-1', tool: 'mcp__show-your-work__show_image', output, isErrored: false },
      viewport: { columns, rows: 50 },
    } as any
    const mounted = await $.ui.mount(target)
    const tree = JSON.stringify(await mounted.drawn())

    expect(tree.includes('"Image"')).toBe(true)
  })
}

test('the window is never wider than the terminal', async $ => {
  for (const columns of [70, 100, 160]) {
    const output = `Shown.\nshow-your-work:${JSON.stringify(shown)}`
    const target = {
      plugin: 'show-your-work', surface: 'terminal', component: 'ToolResult', requestId: `w-${columns}`,
      props: { tool_use_id: `w-${columns}`, tool: 'mcp__show-your-work__show_image', output, isErrored: false },
      viewport: { columns, rows: 50 },
    } as any
    const mounted = await $.ui.mount(target)
    const tree = (await mounted.drawn()) as any
    expect(tree.props.width).toBeLessThanOrEqual(columns - 4)
  }
})

test('a narrow window shows the report under the player', async $ => {
  const report = { ...shown, changes: [{ title: 'Stats moved inside the cards' }], summary: [{ label: 'Layout', ok: true, passed: 4, total: 4 }] }
  for (const columns of [80, 100]) {
    const output = `Shown.\nshow-your-work:${JSON.stringify(report)}`
    const target = {
      plugin: 'show-your-work', surface: 'terminal', component: 'ToolResult', requestId: `n-${columns}`,
      props: { tool_use_id: `n-${columns}`, tool: 'mcp__show-your-work__show_image', output, isErrored: false },
      viewport: { columns, rows: 50 },
    } as any
    const mounted = await $.ui.mount(target)
    const tree = JSON.stringify(await mounted.drawn())
    expect(tree.includes('WHAT CHANGED')).toBe(true)
    expect(tree.includes('All checks passed')).toBe(true)
  }
})

test('a preview whose files are gone says it expired, with a prompt to copy', async $ => {
  const gone = { kind: 'image', path: '/tmp/definitely-gone-xyz.png', source: '/tmp/definitely-gone-xyz.png', width: 800, height: 600, title: 'Hero', generation: 1 }
  const output = `Shown.\nshow-your-work:${JSON.stringify(gone)}`
  const target = {
    plugin: 'show-your-work', surface: 'terminal', component: 'ToolResult', requestId: 'gone',
    props: { tool_use_id: 'gone', tool: 'mcp__show-your-work__show_image', output, isErrored: false },
    viewport: { columns: 140, rows: 50 },
  } as any
  const tree = JSON.stringify(await (await $.ui.mount(target)).drawn())
  expect(tree.includes('"Image"') || tree.includes('expired')).toBe(true)
})

test('a picture that needs ffmpeg says so in place, with a prompt to copy', async $ => {
  const output = "show-your-work: pictures other than PNG need ffmpeg, and it isn't installed. Install it with your package manager, " +
    'for example `sudo apt install ffmpeg` or `sudo dnf install ffmpeg` (Claude can run that for you), then restart Claude Code.'
  const target = {
    plugin: 'show-your-work', surface: 'terminal', component: 'ToolResult', requestId: 'no-ff',
    props: { tool_use_id: 'no-ff', tool: 'mcp__show-your-work__show_image', output, isErrored: true },
    viewport: { columns: 120, rows: 50 },
  } as any
  const tree = JSON.stringify(await (await $.ui.mount(target)).drawn())
  expect(tree.includes('This needs ffmpeg')).toBe(true)
  expect(tree.includes('Copy prompt')).toBe(true)
})

test('other errors keep the engine\'s own drawing', async $ => {
  const target = {
    plugin: 'show-your-work', surface: 'terminal', component: 'ToolResult', requestId: 'other-err',
    props: { tool_use_id: 'other-err', tool: 'mcp__show-your-work__show_image', output: 'show-your-work: no such file', isErrored: true },
    viewport: { columns: 120, rows: 50 },
  } as any
  // The harness has no engine drawing, so passing it on shows up as a refusal.
  const drawn = await $.ui.mount(target).then(m => m.drawn()).then(t => JSON.stringify(t), (err: Error) => String(err))
  expect(drawn.includes('This needs ffmpeg')).toBe(false)
})

// Every node of a drawn tree whose type is `type`.
const nodesOf = (node: any, type: string, out: any[] = []): any[] => {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const n of node) nodesOf(n, type, out); return out }
  if (node.type === type) out.push(node)
  nodesOf(node.children, type, out)
  return out
}

test('Original and Updated of different shapes share one frame, each whole inside it', async $ => {
  const tall = { kind: 'image', path: '/tmp/tall.png', source: '/tmp/tall.png', width: 900, height: 1600, title: 'Tall', generation: 1 }
  const big = { kind: 'image', path: '/tmp/big.png', source: '/tmp/big.png', width: 3000, height: 1875, title: 'Original', generation: 2 }
  const output = `Shown.\nshow-your-work:${JSON.stringify({ ...tall, changes: [{ title: 'Shapes differ' }], compare: big })}`
  const target = {
    plugin: 'show-your-work', surface: 'terminal', component: 'ToolResult', requestId: 'shapes',
    props: { tool_use_id: 'shapes', tool: 'mcp__show-your-work__show_image', output, isErrored: false },
    viewport: { columns: 160, rows: 50 },
  } as any
  const mounted = await $.ui.mount(target)
  const frameOf = (tree: any) => {
    const image = nodesOf(tree, 'Image')[0].props
    const holder = nodesOf(tree, 'Box').find(b => b.props?.justifyContent === 'center' && nodesOf(b.children, 'Image').length)
    return { image: { columns: image.columns, rows: image.rows }, frame: holder ? { columns: holder.props.width, rows: holder.props.height } : { columns: image.columns, rows: image.rows } }
  }
  const updated = frameOf(await mounted.drawn())
  await mounted.press({ key: 'side-before' })
  const original = frameOf(await mounted.drawn())

  // One frame for both: switching moves nothing.
  expect(original.frame).toEqual(updated.frame)
  // Each side is its own shape, inside the frame, and neither is shrunk to the other's.
  for (const side of [updated, original]) {
    expect(side.image.columns).toBeLessThanOrEqual(side.frame.columns)
    expect(side.image.rows).toBeLessThanOrEqual(side.frame.rows)
  }
  expect(updated.image.rows).toBeGreaterThan(updated.image.columns / 2)
  expect(original.image.columns).toBeGreaterThan(updated.image.columns)
})

test('Open page opens only a web address, never an app or a script', async $ => {
  const pic = { kind: 'image', path: '/tmp/a.png', source: '/tmp/a.png', width: 1600, height: 1000, title: 'Page', generation: 1 }
  const cases: [string, string][] = [['https://example.com/pricing', 'Open page'], ['/tmp/x.command', 'View'], ['file:///Applications/Calculator.app', 'View'], ['-a Terminal', 'View']]
  for (const [url, label] of cases) {
    const output = `Shown.\nshow-your-work:${JSON.stringify({ ...pic, url })}`
    const id = `u-${label}-${url.length}`
    const target = {
      plugin: 'show-your-work', surface: 'terminal', component: 'ToolResult', requestId: id,
      props: { tool_use_id: id, tool: 'mcp__show-your-work__show_image', output, isErrored: false },
      viewport: { columns: 140, rows: 50 },
    } as any
    const mounted = await $.ui.mount(target)
    const page = nodesOf(await mounted.drawn(), 'Button').find(b => b.props.key === 'page')
    expect(page.props.label).toBe(`↗ ${label}`)
  }
})

test('/img draws the picture in the chat, under the command', async $ => {
  const pic = { kind: 'image', path: '/tmp/a.png', source: '/tmp/a.png', width: 1600, height: 1000, title: 'hero.jpg', generation: 1 }
  const target = {
    plugin: 'show-your-work', surface: 'terminal', component: 'CommandOutput', requestId: 'img-row',
    props: { command: 'img', args: '/tmp/a.png', text: `show-your-work: Showing hero.jpg.\nshow-your-work:${JSON.stringify(pic)}`, isErrored: false },
    viewport: { columns: 140, rows: 50 },
  } as any
  const tree = await (await $.ui.mount(target)).drawn()
  expect(nodesOf(tree, 'Image').length).toBe(1)
  expect(JSON.stringify(tree).includes('hero.jpg')).toBe(true)
})

test('an /img row from before a restart says what it showed, without the raw marker', async $ => {
  const target = {
    plugin: 'show-your-work', surface: 'terminal', component: 'CommandOutput', requestId: 'img-old',
    props: { command: 'img', args: 'x.png', text: 'Showing x.png (800×500).\nshow-your-work:#abcdef1234', isErrored: false },
    viewport: { columns: 140, rows: 50 },
  } as any
  const text = JSON.stringify(await (await $.ui.mount(target)).drawn())
  expect(text.includes('Showing x.png')).toBe(true)
  expect(text.includes('show-your-work:#')).toBe(false)
})


test('the tabs are drawn once, in the title bar, in every layout', async $ => {
  const pic = { kind: 'image', path: '/tmp/a.png', source: '/tmp/a.png', width: 1600, height: 1000, title: 'Hero', generation: 1 }
  const withReport = { ...pic, changes: [{ title: 'Trip card beside the headline' }], compare: { ...pic, title: 'Original' } }
  const noReport = { ...pic, compare: { ...pic, title: 'Original' } }
  for (const [name, shownNow, columns] of [['report beside', withReport, 170], ['report below', withReport, 90], ['no report', noReport, 170], ['narrow', withReport, 80]] as const) {
    const id = `tabs-${name}`
    const target = {
      plugin: 'show-your-work', surface: 'terminal', component: 'ToolResult', requestId: id,
      props: { tool_use_id: id, tool: 'mcp__show-your-work__show_image', output: `Shown.\nshow-your-work:${JSON.stringify(shownNow)}`, isErrored: false },
      viewport: { columns, rows: 50 },
    } as any
    const tree = await (await $.ui.mount(target)).drawn()
    const bars = nodesOf(tree, 'Box').filter(b => b.key === 'title-bar' || b.props?.key === 'title-bar')
    expect(bars.length).toBe(1)
    for (const key of ['side-before', 'side-after']) {
      expect(nodesOf(tree, 'Button').filter(b => b.props.key === key).length).toBe(1)
      expect(nodesOf(bars[0], 'Button').filter(b => b.props.key === key).length).toBe(1)
    }
  }
})

test('a wide window draws plain QA lines in the sidebar, never an empty one', async $ => {
  const pic = { kind: 'image', path: '/tmp/k.png', source: '/tmp/k.png', width: 720, height: 3200, title: 'UI kit', generation: 1 }
  const withQa = { ...pic, summary: [{ label: 'Components from live markup', ok: true }, { label: 'Renders standalone', ok: true }] }
  const output = `Shown.\nshow-your-work:${JSON.stringify(withQa)}`
  const target = {
    plugin: 'show-your-work', surface: 'terminal', component: 'ToolResult', requestId: 'qa-wide',
    props: { tool_use_id: 'qa-wide', tool: 'mcp__show-your-work__show_image', output, isErrored: false },
    viewport: { columns: 200, rows: 60 },
  } as any
  const mounted = await $.ui.mount(target)
  const tree = JSON.stringify(await mounted.drawn())
  expect(tree.includes('All checks passed')).toBe(true)
  expect(tree.includes('Renders standalone')).toBe(true)
})
