# show-your-work

A Claude Code plugin that draws pictures in the chat (Ghostty). It has one tool, `show_image`, with an Original/Updated compare. The code is in `hooks/`, one module per area; tests are in `tests/`.

- `register.tsx`: the entry module (the only one in `hooks.json`): the tool, the `/img` command and the hooks
- `state.ts`: what more than one module reads or changes
- `setup.ts`: temp folder, ffmpeg, ssh and the terminal, found at session start
- `settings.ts`: remembered switches in the plugin's store (`dataSaver`), and `dataSaverOf`, which decides data saver from the env var, the switch and ssh
- `layout.ts`: sizing, and fitting text to a width
- `media.ts`: finding a file and preparing it as a PNG, and the notice when that fails
- `marker.ts`: the shown item behind a result's marker
- `player.tsx`: the player's components, and the swaps and byte sending that put a picture on screen

Before changing an area, read its notes in `docs/technical/`:

- `architecture.md`: the modules, and a tool call traced from Claude to the terminal
- `plugin-loader-and-hooks.md`: what the hooks loader rejects, and engine behaviour that isn't obvious
- `showing-images.md`: how pictures reach the screen, sizing, Ghostty's limits, ssh and background sessions
- `temp-folder.md`: the temp folder, saved markers, cleanup and the shell safety rules
- `testing-and-debugging.md`: the test harness and its quirks, and how to check things on screen

A change is done when `npx -p typescript tsc -p .`, the Biome lint (see `testing-and-debugging.md`), `claude plugin validate .` and `claude plugin test .` pass, and anything visual has been looked at on screen in a normal (not background) Ghostty session. The tests can't see whether a picture draws.

When you learn something new about the engine, Ghostty or the test harness, add it to the right file in `docs/technical/`.
