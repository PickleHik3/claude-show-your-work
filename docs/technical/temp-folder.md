# Temp folder

## What's in it (`TMP`)

- `$TMPDIR/claude-show-your-work-<uid>`, made with mode 700 (`PICK_TMP`). Holds converted pictures (anything not PNG), enlarged and shrunk copies, the copies sent as bytes over ssh (`b-<key>.png`), sharper copies (`w-<key>-<width>.png`), data saver copies (`s-<key>-<width>.png`, with the emptied `.r.png` and `.q.png` it was made through), the saved markers (`shown-<id>.json`) and `send.log` (see `showing-images.md`).
- Anything older than a week is deleted at session start (`CLEAN_SH`), without following links.
- Claude is told (in the tool description) to save screenshots it makes only to show in a temp folder, not in the project.

## Markers

- A tool result carries `show-your-work:#<id>`, never the drawing data. The shown item is saved as `shown-<id>.json` in the temp folder (`markOf`), and kept in memory (`shownById`) for the session.
- A row redrawn after a restart reads the file again (`shownOf`). Once the week-old cleanup has taken it, the row falls back to the engine's own drawing of the result text.
- Where the file can't be written, the item itself goes in the marker as JSON (`parseShown` reads it).
- The picture a marker points to is the file Claude named (or its converted copy). Nothing else is kept: when that file changes, a redrawn row shows the new picture; when it's gone, the row says the preview expired.
- `/img` rows keep their item in memory only: after a restart they show their first line.

Before 0.7.0 every shown file was copied into `.show-your-work/` in the project as a version history, with the markers beside it. That store is no longer read or written.

## Safety rules (from issue #4 and the review after it)

- Never word-split a path: `while IFS= read -r`, quoted variables, `cd -P` into the folder and work with bare names.
- Never follow a link: check `[ ! -L ]` and `[ -O ]` (owned by this user) before writing or deleting.
- Delete only names the plugin makes (strict patterns), so a user's own file can never match.
- Paths with spaces must work: test the scripts in a temp folder with spaces in its name.
