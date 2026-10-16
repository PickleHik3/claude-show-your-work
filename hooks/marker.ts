// The shown item behind a result's marker: the tool result carries only
// "show-your-work:#id", and the item waits here and in the temp folder.
import type { EngineInterface } from 'claude-code'

import type { Shown } from '../types'

import { state } from './state'
import { keyOf } from './media'

export const MARK = 'show-your-work:'

// A tool result's text, whether it came as a string or as content blocks.
export function textOf(output: unknown): string {
  return typeof output === 'string'
    ? output
    : Array.isArray(output)
      ? output.map(b => (b && typeof b === 'object' && 'text' in b ? String(b.text) : '')).join('\n')
      : ''
}
// What a show drew, kept out of Claude's context.
export const shownById = new Map<string, Shown>()
// Each item is saved beside the converted pictures, so a restart can still
// draw the row; the temp folder's week-old cleanup takes it with them.
const shownFile = (id: string) => `${state.TMP}/shown-${id}.json`

// The marker for a shown item: its id, with the item saved under it, or the
// item itself when it can't be saved.
export async function markOf($: EngineInterface, shown: Shown): Promise<string> {
  state.generation += 1
  const id = keyOf(`${shown.source ?? shown.path}|${await $.clock.now()}|${state.generation}`).slice(0, 10)
  const saved = await $.process.run(['sh', '-c', 'printf "%s" "$1" > "$0"', shownFile(id), JSON.stringify(shown)]).catch(() => null)
  if (saved && saved.exitCode === 0) {
    shownById.set(id, shown)
    return `${MARK}#${id}`
  }
  return `${MARK}${JSON.stringify(shown)}`
}

// The marker is the last line: a command's row also starts with the plugin's name.
const markIn = (output: unknown) => textOf(output).split('\n').findLast(l => l.startsWith(MARK))?.slice(MARK.length).trim()
export async function shownOf($: EngineInterface, output: unknown): Promise<Shown | null> {
  const mark = markIn(output)
  if (!mark?.startsWith('#')) return parseShown(output)
  const id = mark.slice(1)
  if (!/^[0-9a-f]{4,12}$/.test(id)) return null
  const known = shownById.get(id)
  if (known) return known
  const r = await $.process.run(['cat', shownFile(id)]).catch(() => null)
  if (!r || r.exitCode !== 0) return null
  try {
    const shown = JSON.parse(r.stdout) as Shown
    shownById.set(id, shown)
    return shown
  } catch {
    return null
  }
}
export function parseShown(output: unknown): Shown | null {
  const text = textOf(output)
  const line = text.split('\n').findLast(l => l.startsWith(MARK))
  if (!line) return null
  try {
    return JSON.parse(line.slice(line.indexOf(':') + 1)) as Shown
  } catch {
    return null
  }
}
