// One change to review: what changed, and the page it is on.
export type KeyChange = { title: string; detail?: string; url?: string }

// One line of the QA summary: a group of checks, whether it passed, and how
// many of its checks did.
export type Summary = { label: string; ok: boolean; passed?: number; total?: number }

export type Shown = {
  kind?: 'image'
  // the PNG the terminal draws
  path: string
  // the file the user gave, for Open and Reveal
  source?: string
  // the picture drawn, in pixels
  width: number
  height: number
  /** The file's own size, for its label, when the picture drawn is another size. */
  sourceWidth?: number
  sourceHeight?: number
  title: string
  generation: number
  // QA context: the change and its PR
  change?: string
  pr?: string
  // the page the picture is of, to open it there
  url?: string
  // what to review, and the QA in three lines
  changes?: KeyChange[]
  summary?: Summary[]
  // the other side of a before/after, and the two sides' names
  compare?: Shown
  label?: string
}

declare module 'claude-code' {
  interface PluginState {
    'show-your-work': { current: Shown | null }
  }
}
