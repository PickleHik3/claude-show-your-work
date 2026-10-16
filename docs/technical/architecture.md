# Architecture

How a picture gets from Claude's tool call to the terminal, and which module does each part. The topic notes go deeper on each step.

## Modules

| Module | Holds |
|---|---|
| `register.tsx` | The entry module: the `show_image` tool, the `/img` command, and every `on(...)` hook that ties the modules together |
| `state.ts` | What more than one module reads or changes: the session's facts and the repaint count |
| `setup.ts` | Found once per session: temp folder, home, ffmpeg, ssh, the terminal |
| `settings.ts` | Remembered switches, kept in the plugin's store under `settings`: `dataSaver`. `dataSaverOf` decides data saver from `SHOW_YOUR_WORK_LINK`, the switch and ssh |
| `media.ts` | Getting files ready to draw: finding the file, PNG conversion at the width the player needs, the data saver copy (`SAVER_SH`), and the notice when it fails |
| `marker.ts` | The marker a tool result carries, and the shown item saved behind it |
| `layout.ts` | Sizing: from the room a player has to its box in cells and the pixels its picture needs |
| `player.tsx` | The components that draw the player, the Original/Updated switch, Show full size and the data saver switch, the in-place swap (`blit`), the byte path for ssh (`pngSource`) and the send log |

Only `register.tsx` is listed in `hooks.json`; it imports the rest. The loader's rules apply in every module (see `plugin-loader-and-hooks.md`).

## A tool call, end to end

1. **Claude calls `show_image`** with a path, and optionally a title, changes, a summary, a page url, a PR and a `compare` file.
2. **`tool.call` hook** (`register.tsx`): finds the file (`locate`) and refuses anything that isn't a picture.
3. **Preparing** (`prepare`, `media.ts`): the picture becomes a PNG at the width the player needs. With data saver on, a small copy is made beside it (`saverCopy`). A compare file is prepared the same way.
4. **The result** goes back to Claude as a line of text plus a marker, `show-your-work:#<id>` (`markOf`, `marker.ts`). The shown item is saved under that id in the temp folder. Claude never receives the picture, so showing it costs no tokens.
5. **`ui.render` for the `ToolResult`** (`register.tsx`): reads the marker (`shownOf`) and draws the `Viewer` (`player.tsx`). An unchanged player hands back its last drawing, so scrolling costs nothing.
6. **Sizing** (`layout.ts`): the terminal's cell size in pixels comes from the tty. The player picks a box in cells for the picture's shape, and a sharper copy is made in the background if the box needs more pixels.
7. **Drawing**: the `Image` element points Ghostty at the PNG by path, and Ghostty draws it through the kitty graphics protocol. Over ssh the bytes are sent instead (`pngSource`).
8. **Swaps**: a picture already on screen is sent again in place with `$.ui.blit` (`blit`, `draw`), one swap in flight per picture with the newest winning. A row scrolled back into view does this.

## Where to look

- A picture is the wrong size or blurry: `layout.ts`, then `showing-images.md`.
- A picture doesn't arrive over ssh, or is slow: `send.log` in the temp folder, `pngSource`, `readBytes` and `SHRINK_SH` in `player.tsx`, `SAVER_SH` in `media.ts`, then `showing-images.md`.
- An old row draws nothing: `marker.ts`, then `temp-folder.md`.
- The plugin doesn't load at all: `plugin-loader-and-hooks.md`, and run `claude plugin test .`.
