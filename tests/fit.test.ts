import { expect, test } from 'claude-code/testing'

import { wrapWords, pagesOf, fit, cellOf, frameWidth, paneSize, layoutOf, targetBox, drawBox, pixelsFor, tabLabel } from '../hooks/layout'
import { isAtLeast } from '../hooks/setup'
import { expand, keyOf, looseName, pngDims } from '../hooks/media'
import { parseShown } from '../hooks/marker'
import { qaTotals, resumeCommand, isScratch, toolLine } from '../hooks/player'

test('a wide image fills the width at half-height rows', () => {
  expect(fit(1920, 1080, 100, 40)).toEqual({ columns: 100, rows: 29 })
})

test('a tall image is limited by rows and narrowed to keep its shape', () => {
  expect(fit(1000, 2000, 100, 30)).toEqual({ columns: 30, rows: 30 })
})

test('sizes stay inside the 1..255 cell limits', () => {
  const box = fit(10000, 10, 400, 40)
  expect(box.columns).toBe(255)
  expect(box.rows).toBe(1)
})

test('the result text round-trips to the shown image', () => {

  const shown = { path: '/tmp/a.png', width: 10, height: 5, title: 'a', generation: 1 }
  const text = `Shown to the user: a (10×5).\nshow-your-work:${JSON.stringify(shown)}`
  expect(parseShown(text)).toEqual(shown)
  expect(parseShown([{ type: 'text', text }])).toEqual(shown)
  expect(parseShown('nothing here')).toBe(null)
})

test('typed and dragged-in paths resolve', () => {
  expect(expand('~/Movies/Screen\\ Recordings/a.png', '/w', '/Users/u')).toBe('/Users/u/Movies/Screen Recordings/a.png')
  expect(expand("'/tmp/a b.png'", '/w', '/Users/u')).toBe('/tmp/a b.png')
  expect(expand('img/a.png', '/w/', '/Users/u')).toBe('/w/img/a.png')
})

test('temp files are scratch, finished work is not', () => {
  expect(isScratch('/tmp/claude-show-your-work/a.png')).toBe(true)
  expect(isScratch('/private/tmp/claude-501/x/qa.png')).toBe(true)
  expect(isScratch('/var/folders/rq/x/T/shot.png')).toBe(true)
  expect(isScratch('/Users/u/Pictures/launch.png')).toBe(false)
})

test('the call row is one short line', () => {
  const line = toolLine({ path: '/tmp/x/after.png', title: 'Pricing', compare: '/tmp/before.png', compare_label: 'Live' }, false)
  expect(line).toBe('▣ Image · Pricing · vs Live')
  expect(toolLine({ path: '/a/b/shot.png' }, true)).toBe('▣ Loading image · shot.png')
})

test('the resume command names this session', () => {
  expect(resumeCommand('abc-123')).toBe('claude stop abc-123; CLAUDE_CODE_DISABLE_AGENT_VIEW=1 claude --resume abc-123')
  expect(resumeCommand('')).toBe('CLAUDE_CODE_DISABLE_AGENT_VIEW=1 claude --resume')
})

test('the QA line totals the summary', () => {
  expect(qaTotals([{ label: 'a', ok: true, passed: 4, total: 4 }, { label: 'b', ok: false, passed: 1, total: 3 }])).toEqual({ passed: 5, total: 7 })
  // Plain summary lines (label and tick, no numbers) count one each, so the QA card shows.
  expect(qaTotals([{ label: 'a', ok: true }, { label: 'b', ok: true }, { label: 'c', ok: false }])).toEqual({ passed: 2, total: 3 })
  expect(qaTotals()).toEqual({ passed: 0, total: 0 })
})

test('sidebar text wraps whole words and never loses any', () => {
  const lines = wrapWords('Stats moved inside the cards on every slide', 12)
  expect(lines.every(l => l.length <= 12)).toBe(true)
  expect(lines.join(' ')).toBe('Stats moved inside the cards on every slide')
  expect(wrapWords('short', 12)).toEqual(['short'])
})

test('changes page by rows and an item never splits', () => {
  const pages = pagesOf([{ item: 'a', rows: 2 }, { item: 'b', rows: 2 }, { item: 'c', rows: 1 }], 3)
  expect(pages).toEqual([['a'], ['b', 'c']])
})


test('wrapping never hangs on a tiny width', () => {
  expect(wrapWords('Stats moved inside', 0).length).toBeGreaterThan(0)
  expect(wrapWords('Stats moved inside', -7).join('')).toBe('Statsmovedinside')
})

test('a key is the same for the same text, and hex', () => {
  expect(keyOf('/a.png|10|1')).toBe(keyOf('/a.png|10|1'))
  expect(keyOf('/a.png|10|1')).not.toBe(keyOf('/a.png|10|2'))
  expect(keyOf('/a.png|10|1')).toMatch(/^[0-9a-f]+$/)
})

test('long tab names are shortened so every tab fits', () => {
  expect(tabLabel('Original')).toBe('Original')
  expect(tabLabel('Before (blurred photo background)')).toBe('Before (blu…')
})

test('a typed screenshot name matches the narrow-space one macOS writes', () => {
  expect(looseName('Screenshot 2026-10-04 at 11.37.02 AM.png')).toBe(looseName('Screenshot 2026-10-04 at 11.37.02 AM.png'))
  expect(looseName('a b.png')).toBe('a b.png')
  expect(looseName('café.png')).toBe(looseName('café.png'))
})

test('a PNG header gives its size without any tool (Linux)', () => {
  // 1x1 PNG
  const onePx = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  expect(pngDims(onePx)).toEqual({ width: 1, height: 1 })
  expect(pngDims(btoa('not a png at all, just some text here'))).toBe(null)
})

test('with the cell size known, a small picture gets a box its own pixels fill', () => {
  // 1600 px on Retina cells of 25 x 54 px: Ghostty never draws it larger.
  const box = fit(1600, 615, 105, 22, { width: 25, height: 54 })
  expect(box.rows).toBe(11)
  expect(box.columns).toBe(62)
})

test('with the cell size known, a big picture is never wider than its box', () => {
  const px = { width: 15.4, height: 33 }
  const box = fit(1800, 1125, 105, 22, px)
  // Drawn at the box's height, the picture's width still fits the columns.
  expect((box.rows * px.height * 1800) / 1125).toBeLessThanOrEqual(box.columns * px.width)
  expect(box.rows).toBeLessThanOrEqual(22)
})

test('the cell size comes from the tty size, and is unknown without pixels', () => {
  expect(cellOf('40 150 2400 1280\n')).toEqual({ width: 16, height: 32 })
  expect(cellOf('40 150 2400 1280\n', 2)).toEqual({ width: 32, height: 64 })
  expect(cellOf('40 150 0 0')).toBe(null)
  expect(cellOf('')).toBe(null)
})

test('pictures are made as wide as the window shows them, up to 2400 px', () => {
  // A full Retina window: 157 by 39 cells of 32.1 by 68.5 screen pixels.
  const term = { columns: 157, rows: 39 }, px = { width: 32.1, height: 68.5 }
  expect(frameWidth(1600, 800, term, px)).toBe(2400)
  const tall = frameWidth(1600, 1000, term, px)
  expect(tall).toBeGreaterThan(1600)
  expect(tall).toBeLessThan(2400)
  // Half a window: narrower than 1600, so the picture is smaller too.
  expect(frameWidth(1600, 800, { columns: 78, rows: 39 }, px)).toBeLessThan(1600 * 1.5)
  // Nothing measured: 1600 at most, as before.
  expect(frameWidth(3000, 1500, null, null)).toBe(1600)
  expect(frameWidth(1280, 720, null, null)).toBe(1280)
})

test('versions compare by number, not by text', () => {
  expect(isAtLeast('2.1.296', '2.1.295')).toBe(true)
  expect(isAtLeast('2.1.295', '2.1.295')).toBe(true)
  expect(isAtLeast('2.1.294', '2.1.295')).toBe(false)
  expect(isAtLeast('2.1.1000', '2.1.295')).toBe(true)
  expect(isAtLeast('2.2.0', '2.1.295')).toBe(true)
  expect(isAtLeast('2.1.296-dev', '2.1.295')).toBe(true)
})

test('a docked pane sizes to its own width, not the whole screen', () => {
  expect(paneSize({ columns: 267, rows: 60 }, { bodyColumns: 45 })).toEqual({ columns: 45, rows: 60 })
  // A pane docked under the chat is short: the picture fits its height too.
  expect(paneSize({ columns: 160, rows: 60 }, { bodyColumns: 150, scroll: { bodyRows: 12 } })).toEqual({ columns: 150, rows: 12 })
  expect(paneSize({ columns: 160, rows: 60 }, { bodyColumns: 150, bodyRows: 14 })).toEqual({ columns: 150, rows: 14 })
  expect(paneSize({ columns: 120, rows: 40 }, {})).toEqual({ columns: 120, rows: 40 })
  expect(paneSize(undefined, { bodyColumns: 45 })).toBe(undefined)
})

// Retina cell: 9×18 points, 2 pixels a point.
const RETINA = { width: 18, height: 36 }

test('the layout puts the report beside the picture only when there is one and room for it', () => {
  expect(layoutOf({ columns: 160, rows: 50, isPane: false, hasReport: true }).isWide).toBe(true)
  expect(layoutOf({ columns: 160, rows: 50, isPane: false, hasReport: false }).isWide).toBe(false)
  expect(layoutOf({ columns: 100, rows: 50, isPane: false, hasReport: true }).isWide).toBe(false)
  // Beside the report, the picture has less room.
  expect(layoutOf({ columns: 160, rows: 50, isPane: false, hasReport: true }).maxCols).toBeLessThan(layoutOf({ columns: 160, rows: 50, isPane: false, hasReport: false }).maxCols)
  // A short pane keeps its controls: the picture gets what's left.
  expect(layoutOf({ columns: 150, rows: 20, isPane: true, hasReport: false }).maxRows).toBe(8)
})

test('a picture made at the prepared width fills its box, at any window size and shape', () => {
  for (const [columns, rows] of [[80, 30], [120, 40], [160, 50], [240, 70], [300, 90]] as const) {
    for (const [w, h] of [[2400, 1500], [1600, 1000], [1920, 1080], [900, 1600], [3000, 600], [400, 300]] as const) {
      const made = frameWidth(w, h, { columns, rows }, RETINA)
      const madeHeight = Math.round((made * h) / w)
      const layout = layoutOf({ columns, rows, isPane: false, hasReport: false })
      const target = targetBox(made, madeHeight, layout, RETINA)
      const drawn = drawBox(made, madeHeight, layout, RETINA)
      // Small in a big box was the bug: the drawn box is the whole target, or within a cell of it.
      if (made < 2400) {
        expect(drawn.columns).toBeGreaterThanOrEqual(target.columns - 1)
        expect(drawn.rows).toBeGreaterThanOrEqual(target.rows - 1)
      }
      expect(drawn.columns).toBeLessThanOrEqual(layout.maxCols)
      expect(drawn.rows).toBeLessThanOrEqual(layout.maxRows)
    }
  }
})

test('a picture short of pixels is drawn whole at its own size, never cropped or stretched', () => {
  const layout = layoutOf({ columns: 200, rows: 60, isPane: false, hasReport: false })
  const target = targetBox(800, 500, layout, RETINA)
  const drawn = drawBox(800, 500, layout, RETINA)
  expect(drawn.columns).toBeLessThan(target.columns)
  // Its own shape: 800×500 is 8:5, in 2:1 cells.
  expect(Math.abs((drawn.columns * RETINA.width) / (drawn.rows * RETINA.height) - 1.6)).toBeLessThan(0.15)
  // And the pixels that would fill the target are asked for, within limits.
  expect(pixelsFor(target, RETINA)).toBeGreaterThan(800)
  expect(pixelsFor({ columns: 500 }, RETINA)).toBe(2400)
  expect(pixelsFor({ columns: 5 }, RETINA)).toBe(320)
  expect(pixelsFor(target, null)).toBe(1600)
})
