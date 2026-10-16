// What more than one module reads or changes: the session's facts and the
// players' repaint count.
import type { Cell } from './layout'
import type { DrawCause } from './player'

// An imported `let` is read-only to the module that imports it, so anything
// set in one module and read in another is a field of this object.
export const state = {
  // Converted pictures, shrunk copies and the shown items behind markers. A
  // private folder per user, chosen at session start: a fixed name in the
  // shared /tmp could be made first, or pointed elsewhere, by another user on
  // the same machine.
  TMP: '/tmp/claude-show-your-work',
  cwd: '',
  home: '',
  ffmpeg: 'ffmpeg',
  // setUp's one run, shared by everything that waits on it.
  setup: null as Promise<void> | null,
  // Whether a Button can hold coloured Text (Claude Code 2.1.295 and later).
  canColourButtons: false,
  generation: 0,
  // Every change that should repaint bumps this; a window's drawing is kept and
  // handed back while nothing changed (scrolling only moves which rows show).
  version: 0,
  // macOS unless the session says Linux: every Linux path below is a branch
  // beside the macOS one, which stays as it was.
  isMac: true,
  // The terminal's cell in pixels (see Cell in layout.ts).
  cell: null as Cell | null,
  // The terminal's size in cells, from the same measure.
  termSize: null as { columns: number; rows: number } | null,
  // The terminal reads the file itself: a path crosses, not the picture.
  // Over ssh the terminal is on another machine and can't read the file, so the
  // bytes have to cross after all.
  sendBytes: false,
  // Whether the terminal draws pictures. Some sessions cannot (a background
  // session's relay): the first blit says so, and from then on every player
  // shows a warning with the way back instead. (Coloured half-block cells were
  // tried as a fallback: unreadable.)
  canImage: true,
  probed: false,
  sessionId: '',
  drawCause: 'background' as DrawCause,
  inTmux: false,
  terminalName: '',
}
