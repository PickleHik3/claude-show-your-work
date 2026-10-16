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
  // with data saver on, the small copy sent in place of `path` until the
  // person asks for the full size, and its size on disk
  saver?: { path: string; width: number; height: number; bytes: number }
  // prepared with data saver on: never enlarged, then or by sharpening, even
  // when it needed no small copy
  isSaving?: boolean
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
