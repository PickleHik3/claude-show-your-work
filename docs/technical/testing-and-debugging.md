# Testing

## Checks before any change is done

```
npx -p typescript tsc -p .
npx --yes @biomejs/biome@1.9.4 lint hooks tests types
claude plugin validate .
claude plugin test .
```

Note `npx -p typescript tsc`: a bare `npx tsc` runs an unrelated package.

## Lint

Biome (`biome.json`), lint only: the formatter is off so diffs stay small. The recommended rules apply, minus a few that fight the code's idioms: non-null assertions after a checked lookup, `if (!x) map.set(k, (x = ...))`, several declarations on one line, reassigning a normalised parameter, and array index keys in rows that never reorder. Tests may use `any` for engine targets. A real exception gets a `biome-ignore` comment with its reason.

## CI

`.github/workflows/ci.yml` runs lint, `claude plugin validate .` and `claude plugin test .` on every push to `main`, `releases` and `latest` and on pull requests. It doesn't typecheck: the engine's types (`.claude-plugin/types/`) are written by Claude Code when it loads the plugin from a folder, are git-ignored, and need a signed-in session to appear. Run `tsc` locally.

`.github/workflows/release.yml` publishes a GitHub release when a `show-your-work--v*` tag is pushed, titled with the version and with the release commit's summary as its notes.

## The test harness (`claude-code/testing`)

- `claude plugin test` runs every `*.test.ts(x)` under the folder and takes no filter. To run one file, copy the folder somewhere with only that test file in `tests/`.
- Every test loads the module, so a loader rule broken anywhere fails every test. That's the fastest way to catch the rules in `plugin-loader-and-hooks.md`.
- Pure functions are exported and tested directly (`tests/fit.test.ts`, `tests/notices.test.ts`, `tests/saver.test.ts`). Prefer pulling logic into a small exported function over driving it through hooks.
- Render tests mount a component with `$.ui.mount(target)` and read `drawn()`. Press buttons with `mounted.press({ key })`.
- **Hooks registered with `on(...)` in a test return `{ value }` or `{ deny }`.** Returning a bare object (like `{ deny: '...' }` meant as a result) turns into a rejection.
- `mock.clock(on)` replaces `$.clock`; move it with `clock.advance(ms)`. Real timers don't advance it.
- A mounted player's `$` has no store: a button that saves a setting can't be pressed through to the store. Test the saving with a stand-in `$` (`tests/saver.test.ts`).
- The plugin a test mounts is its own copy of the modules: setting `state` from a test changes the test's copy, not what the mounted player reads.
- `mock.store(on, entries)` answers `$.store`. **Atoms (`atom`, `read`, `update`) are not in the store** and can't be seeded, so the pane can't be rendered with content in a test.
- `$.session.start` can't be driven usefully: the plugin's session hook doesn't run under the harness. Test what it decides through exported functions.
- A byte source must be a real PNG; the harness checks the header.
- The harness can't run processes or read real files: anything that needs ffmpeg or sips is checked by hand.
- To check a test really guards a fix, break the fix and see the test fail.

## Shell scripts

The `sh -c` scripts (`SHRINK_SH`, `SAVER_SH`, `LOG_SH`, `CLEAN_SH`, `PICK_TMP`) are tested by hand in a temp folder, the way the plugin runs them: `sh -c "$SCRIPT" arg0 arg1 ...` (with `-c`, the first argument is `$0`). Use a folder with spaces in its name. For Linux behaviour on a Mac, put only `sh wc tr rm` on `PATH`. For `SAVER_SH`'s fallbacks, a `PATH` folder of links to `sh wc tr mv magick convert` (no pngquant) or `sh wc tr mv` (ffmpeg only, by its full path). A big test picture: `magick -size 1080x2400 plasma: big.png` (noise: the worst case for bytes and time). Claude Code's own safety check refuses to run an `sh -c` script holding `rm` from the Bash tool, which is one more reason `SAVER_SH` has none.

## On screen

**This fork is checked on the user's phone**, not in Ghostty: Claude Code over ssh from Termux on a Nothing Phone 2, inside the `herdr` multiplexer (a 59 × 39 pane), with `${TMP}/send.log` beside it for what was sent and how long each blit took. The Ghostty notes below are upstream's and still hold for a desktop check.

The tests can't see whether a picture draws. Check visual changes in a normal Ghostty tab with the local copy:

```
claude --plugin-dir ~/Projects/claude-show-your-work --settings '{"enabledPlugins":{"show-your-work@picklehik3":false}}'
```

- A plain `claude` loads the **installed** copy from GitHub, not the local one.
- **Background sessions (agent view, forks, `claude attach`) can't draw pictures at all.** A test there shows the background notice, whatever the code does. Use a normal tab.
- **Over ssh:** start with `SSH_CONNECTION="1 1 1 1"` in front to send pictures as bytes, as over ssh. A real check needs Remote Login and `ssh localhost`.
- `/reload-plugins` picks up edits; `/img <path>` shows any file without Claude. Compare needs a `show_image` call with `compare`: ask Claude to show two files as Original and Updated.
- Several sessions can share this folder (forks, other tabs). Check `git status` and `git reflog` before committing; another session may have edited or amended.
