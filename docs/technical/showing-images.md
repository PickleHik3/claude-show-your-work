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

## Data saver

For a slow link: this fork's user runs Claude Code over ssh (Tailscale, often relayed) from Termux on a phone, in a 59-column pane about 1080 px wide. A full-size PNG takes seconds to cross there.

- **On or off** (`dataSaverOf` in `settings.ts`, read through `isDataSaver`): `SHOW_YOUR_WORK_LINK=slow` forces it on, `=fast` off. Otherwise the remembered `dataSaver` setting, otherwise on whenever pictures go as bytes (`sendBytes`, ssh). The link's speed is never measured.
- **The full picture** is the file as converted to PNG, never enlarged: with data saver on, `prepare` skips the widening toward `frameWidth`, so Show full size sends the file's own pixels. Pictures over `MAX_STILL` are still shrunk. The item carries `isSaving`, and `mayWiden` keeps `sharpen` off it too, with a small copy or without one.
- **Only when it pays** (`isSaverWorth`): a copy is made when the picture is wider than the copy would be (`saverWidth`), or over `SAVER_BYTES` (150 KB). A picture within both (a 1080 px screenshot of 36 KB in a 1080 px pane) goes as it is: no copy, no Show full size, and no time spent making one. The size comes from `$.fs.stat` (`size`); a size that can't be read counts as big.
- **The copy** (`saverCopy`, `SAVER_SH` in `media.ts`), made in `prepare` beside the full picture, so the render never waits for it: scaled to `saverWidth`, which is `SHOW_YOUR_WORK_PX` when set, else the cell's width times the terminal's columns when the cell is measured, else 1080 px. Never wider than the picture, and the full width even for a tall screenshot (chosen over fitting its height in the rows). Then 256 colours with `pngquant 256 --speed 8 --strip` (dithered). On Linux the scaled picture goes down a pipe straight into pngquant, uncompressed (`magick -resize … -define png:compression-level=0 png:-`, else ffmpeg's `-c:v png -compression_level 0 -f image2pipe -`), so no PNG is compressed and read back between the two; sips (macOS) can't write to a pipe and scales into a file first. When the pipe fails or pngquant is missing, the old chain: scale into a file (sips, ffmpeg, ImageMagick), pngquant from it, ImageMagick (`-dither FloydSteinberg -colors 256`, `PNG8:`) when pngquant is missing or fails, and the plain scaled PNG when both fail. A copy that isn't smaller than what it was made from is dropped; ImageMagick's dither made a flat screenshot three times bigger.
- **Bytes:** about 150 KB is the goal, but width wins: nothing shrinks a copy below the pane's width to meet it. A flat app screenshot comes out around 10 to 20 KB; noise (`magick plasma:`) stays over 1 MB.
- **Time** (measured on the Linux host, 1440×3200 to 1080 px, median of 7): a flat screenshot of 51 KB 790 ms before, 610 ms now; a screenshot with text of 370 KB 1020 ms before (149 KB), 895 ms now (127 KB). Most of what's left is decoding the PNG (about 160 ms in ImageMagick, 220 ms in ffmpeg, its start included) and pngquant itself. `--speed 8` against `--speed 3`: about half the time on noise (1.1 s against 2.4 s at 1080×2400), a quarter to a third less on screenshots, a few percent more bytes; `--speed 10` is faster again but doubles a flat screenshot's bytes. ffmpeg's own `palettegen`/`paletteuse` was slower on noise (5 s) and bigger on screenshots; vipsthumbnail wasn't on the machine.
- **Cached** as `s-<key of the original's path>-<width>.png` and made again only when the original is newer (`-nt`), so showing the same file again costs nothing. The script uses no `rm`: the files it works through are emptied and left for `CLEAN_SH`.
- Sharpening (`sharpen`) skips anything shown with data saver on (`mayWiden`).
- **The switch** changes pictures shown from then on, not ones already drawn. With the env var set, the button reads `Data saver: on (env)` and only says, in a toast, that the env var sets it: a `Button` has no disabled state (its props are key, label, hotkey, action, plain, dimColor, variant, role, autoFocus).
- **Show full size / Show small** (`toggleFull`), on any picture drawn from a saver copy, swap the other copy into the same `Image` with `blit`. The full picture is read and sent on the first press, never before. The state is per site (`isFull`) and holds across Original/Updated.
- **Each `Image` keeps the source it was drawn with** (`drawnAs`). The engine sends an `Image` again when its render source changes, even right after a blit sent that same picture; when the render source is unchanged, a blitted source stays and is the one re-sent on a resize. So the swap goes by blit and the redraw that relabels the button keeps the old render source: one send per press. A new box resets `drawnAs`, since the picture goes again anyway; so does a flip, since the other side is a new `Image`.
- **Compare** sends only the side on screen: the player draws one `Image`, and the other side's bytes are read when it is flipped to, as the copy the site shows then.
- **The first-draw `probe`** sends a 68-byte dot, not the picture again, when pictures go as bytes (see When pictures can't draw).

## The send log

Every send appends one line to `${TMP}/send.log` (`sendLine`, `LOG_SH`): ISO time, site (the tool_use_id), `saver`, `full` or `dot` (the probe's), the pixels and bytes actually sent (read from the PNG), the milliseconds `$.ui.blit` took, and what sent it (`render`, `blit`, `probe`). A render's own send isn't timed (`-`) and is logged when the picture or its box is new to that `Image`, a best guess at when the engine transmits. The dot's own render (68 bytes once more) isn't logged. A path source logs `file` for its bytes. The log is emptied once it passes 1 MB. Compare it with what the phone shows.

The first picture of a session over ssh:

```
2026-10-16T10:15:02.120Z toolu_01Ab… saver 1080x2400 8619 - render
2026-10-16T10:15:02.380Z toolu_01Ab… dot 1x1 68 41 probe
2026-10-16T10:15:09.904Z toolu_01Ab… full 1440x3200 52880 610 blit
```

A picture within the pane and under 150 KB has no copy: its line reads `full` at its own size.

The result's first line names the copy for Claude: `Shown: shot.png (1440×3200; data saver, 1080×2400, 9 KB).`

## Ghostty's limits

- **Ghostty draws a picture at its native pixel size at most.** It scales a picture down to fit its box but never up. A 800 px picture in a wide box stays small. So pictures are made as wide as the box really is in pixels (`frameWidth`, 320 to 2400 px), enlarged with `sips --resampleWidth` (ffmpeg on Linux) up to that width and never past twice their own width; a sharper copy stops at `MAX_STILL` (3200). With data saver on, nothing is enlarged (see Data saver).
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

The first draw is probed (`probe`): a blit 250 ms later reports whether the `Image` drew or fell back to its alt text. If it didn't, every player shows a notice (`cantDraw`) instead.

The blit's answer comes from the terminal and the source's kind, not from the picture (see `plugin-loader-and-hooks.md`), and a blit that is allowed transmits everything it was given. Asking with the picture itself sent it twice. So:

- **Bytes (ssh):** the first player's title bar holds a one-cell `Image` (`DOT_KEY`) with a clear 1×1 PNG (`DOT`, 68 bytes) until the answer comes; the probe blits the dot again into that key, so the picture on screen is never replaced, and the redraw after the answer drops the dot. A few hundred bytes cross in all (the dot twice, with its escape codes), where the first picture crossed twice before. A long title loses three columns for those 250 ms.
- **A path (local):** the probe blits the picture on screen, as before. Only the path crosses, and a path is the one source whose answer differs ("cannot read files on this machine"), so a dot sent as bytes would answer the wrong question there.
- Skipping the probe isn't possible: what decides (the terminal's answer to the engine's graphics query, `kittyGraphics`) isn't readable by a plugin, and a background session over ssh looks the same as a normal one from here.

The causes:

- **tmux** with `allow-passthrough off`: known at session start, before any draw.
- **A terminal other than Ghostty or kitty.**
- **A background session** (agent view, a fork, `claude attach`). These can't draw pictures at all. The notice's Copy command button copies `claude stop <id>; CLAUDE_CODE_DISABLE_AGENT_VIEW=1 claude --resume <id>`. Resuming alone fails while the session still runs. The command itself isn't printed in the notice.
