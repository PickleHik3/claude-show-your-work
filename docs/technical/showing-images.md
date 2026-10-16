# Drawing pictures

## How a picture reaches the screen

Claude calls `show_image` with a path. The tool call prepares the file (converts it to PNG at the width the player needs), saves the shown item in the temp folder, and returns one short line for Claude plus a marker line, `show-your-work:#<id>`. The `ToolResult` render hook reads the marker and draws the player (`Viewer`) in the chat. `/img <path>` does the same in its own command row (`CommandOutput` hook). Pictures go to the screen only, never to Claude, so they cost no tokens.

On macOS `sips` converts and resizes pictures. On Linux ffmpeg does (a PNG that needs no resizing needs neither); without it, a picture other than PNG shows the `no_ffmpeg` notice.

The picture is an `Image` element. A picture already on screen can be swapped in place with `$.ui.blit` (`blit` in `player.tsx`, one swap in flight per picture, the newest winning); a row scrolled back into view sends its picture again this way.

## Sources: path or bytes

- **Normally the source is a path:** `{ file, format: 'png', generation }`. Ghostty reads the file itself, so nothing large crosses.
- **Over ssh the terminal is on another machine** and can't read the file. `setUp` sets `sendBytes` when `SSH_CONNECTION` or `SSH_TTY` is present, and `pngSource` then sends `{ png: <base64> }`.
- **Claude Code refuses a PNG over 2 MiB sent as bytes** (`decodes to more than 2097152 bytes`; the whole render is refused). Files over `BYTES_MAX` are shrunk first by `SHRINK_SH` (sips, then ffmpeg, then ImageMagick), once per file, into the temp folder. With no tool, the source falls back to the path.
- `recentBytes` keeps the last six base64 strings, so a redraw (any button press) doesn't read and send the picture again. Without it, buttons lag badly over ssh.
- Every byte source goes through `pngSource`; that is the one place to change what crosses over ssh.
- Do **not** switch to bytes automatically when a blit is denied with "cannot read files". That happens in background sessions too, where bytes don't draw either, and it left players stuck on their alt text.

## Ghostty's limits

- **Ghostty draws a picture at its native pixel size at most.** It scales a picture down to fit its box but never up. A 800 px picture in a wide box stays small. So pictures are made as wide as the box really is in pixels (`frameWidth`, 320 to 2400 px), enlarged with `sips --resampleWidth` (ffmpeg on Linux) up to that width and never past twice their own width; a sharper copy stops at `MAX_STILL` (3200).
- **Ghostty keeps a picture at the size it was last sent.** When the box changes size but the source doesn't, the picture is cropped, not rescaled. File sources carry `generation: box.columns * 1000 + box.rows`, so a new box means a new source. Byte sources have no generation field; a crop can flash for a frame until the next redraw.
- Nothing may wrap, overlay or fill behind the `Image`. Each of those stopped it drawing in Ghostty.

## Player layout

Every view (one picture, or Original/Updated) is built from the same zones, in this order:

1. **Title bar** (`TitleBar`): the title (the only thing that gives way when space runs out), a PR link, then the Original/Updated tabs on the right, on one line. The player is never narrower than its tabs (`tabsWidth`).
2. **Stage**: the picture and the buttons under it (Open page or View, Save to Downloads, Copy path).
3. **Report**: what changed, then QA. Beside the stage when the chat is wide enough, under it otherwise.

There is no side-by-side view of two stills: compare is the Original/Updated switch.

No sizes in the UI: no resolution.

`tests/render.test.ts` enforces this: the tabs are drawn once, in the title bar, in every layout. A change that moves them fails that test.

## Sizing

All sizing goes through `hooks/layout.ts`:

- `layoutOf(room)`: the space a player has. `room` is its columns and rows, pane or inline, and whether it has a report. Gives `maxCols`, `maxRows`, whether the report sits beside (`isWide`) and the inner width. Inline, a picture takes at most 120 columns and 55% of the rows (8 to 40); in a pane up to 220 columns and the pane's rows minus 12. The report sits beside when there is one and the chat is at least `WIDE_ENOUGH` (110) columns, in a `SIDE` (40) column.
- `targetBox(w, h, layout, cell)`: the box a picture of that shape fills.
- `pixelsFor(box, cell, aspect)`: the screen pixels that box needs, for its width and its height, between `PX_MIN` (320) and `PX_MAX` (2400).
- `drawBox(w, h, layout, cell)`: the box actually drawn: the target, cut down to the picture's own pixels, so a picture that's short of pixels is drawn whole at its size instead of small in a big box.
- `frameWidth`: the width a picture is made at when prepared, the pixels an inline player without a report needs in this terminal.
- `sharpen`: when a player needs at least 15% more pixels than its picture has (a bigger window, a pane), a sharper copy is made in the background from the original file and swapped into the same object. It stops at twice the picture's own width and `MAX_STILL` (3200).

The invariant, tested in `tests/fit.test.ts`: a picture made at `frameWidth` fills its box at any window size and shape. `fit` rounds rows with a hair of tolerance; without it, 38 rows computed as 37.999 lost a row and several columns.

The cell's pixel size comes from the tty: `CELL_SH` (perl `ioctl` TIOCGWINSZ, `0x40087468` on macOS) gives rows, columns and the window's size in points; `SCALE_SH` (`NSScreen.mainScreen.backingScaleFactor` via osascript JXA) turns points into pixels. `cell` is null where the tty reports nothing (tmux, a relay): boxes then assume 2:1 cells, pictures are made at 1600 px at most, and nothing is sharpened. `remeasure` runs when the viewport changes size, at most once a second, and only a real change redraws.

Original and Updated share one frame, the bigger of their two boxes, each picture centred in it, so switching tabs never moves the layout. Each side has its own `Image` key (`viewKey`).

Sizes in the UI: none. The file's own size is kept as `sourceWidth`/`sourceHeight` and goes to Claude in the tool result only.

## When pictures can't draw

The first draw is probed (`probe`): a blit 250 ms later reports whether the `Image` drew or fell back to its alt text. If it didn't, every player shows a notice (`cantDraw`) instead:

- **tmux** with `allow-passthrough off`: known at session start, before any draw.
- **A terminal other than Ghostty or kitty.**
- **A background session** (agent view, a fork, `claude attach`). These can't draw pictures at all. The notice's Copy command button copies `claude stop <id>; CLAUDE_CODE_DISABLE_AGENT_VIEW=1 claude --resume <id>`. Resuming alone fails while the session still runs. The command itself isn't printed in the notice.
