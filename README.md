<h1 align="center">claude-show-your-work</h1>

<p align="center">Claude Code can show you pictures in the terminal.</p>

show-your-work (claude-show-your-work) is a Claude Code plugin that lets you view screenshots in Claude Code, right in the terminal: app screens, web pages, designs and charts, with a before-and-after switch and a short QA report beside the picture.

## This fork

A fork of [iamumeransari/claude-show-your-work](https://github.com/iamumeransari/claude-show-your-work) v0.6.3 (MIT), kept by PickleHik3. It has left upstream for good and no longer tracks it.

- **Images only.** The one tool is `show_image`. Video playback, version history, the onboarding tour and welcome, usage stats and the self-updater are gone.
- Tool descriptions and the injected prompt point at the android-control skill's `ad` tool (`ad shot`, `ad zoom`) for Android, and at headless Playwright screenshots for websites, and ask for before/after on device checks.
- Nothing is sent anywhere: there is no telemetry and no update check.

Install:

```
/plugin marketplace add https://github.com/PickleHik3/claude-show-your-work.git#v0.7.0-pk.1
/plugin install show-your-work@picklehik3
```

It works on macOS and Linux. You need a terminal that supports the kitty graphics protocol, like Ghostty, and Claude Code 2.1.287 or later. On Linux, pictures other than PNG need ffmpeg (`sudo apt install ffmpeg`, or ask Claude to install it).

## Usage

Claude shows you its work in the chat whenever it builds or changes something visual. You can also ask for it directly:

- "Give me four directions for the homepage hero and show them to me."
- "Fix the billing toggle and show me before and after."
- "Take a screenshot of the settings screen on the device and show it to me."

### Features

- **Pictures in the chat:** PNG, JPEG, WebP, GIF (its first frame) and TIFF, sized to fill the space the chat has and sharpened when the window grows.
- **Before and after:** with a `compare` file, the player has Original and Updated tabs that switch in place without moving the layout.
- **What changed and QA:** the list of changes and up to three QA lines sit beside the picture when the chat is wide enough, under it otherwise.
- **Quick functions:** open the page the picture shows (or the file itself), save it to Downloads, or copy its path.
- **Over ssh:** pictures are sent as bytes, shrunk first when they're over Claude Code's 2 MiB limit.
- **When pictures can't draw** (tmux with passthrough off, an unsupported terminal, a background session), the player says why and how to fix it, and Claude is told the picture wasn't seen.

<p align="center">
  <img src="docs/concepts.jpg" alt="Four landing page concepts for Tern shown in the chat" width="49%">
  <img src="docs/breakpoints.jpg" alt="The Tern homepage at desktop, tablet and phone sizes shown in the chat" width="49%">
</p>

## How it works

Pictures go straight to your terminal, never to Claude, so showing them uses no tokens.

## For developers

<details>
<summary>The tool and local development</summary>

The plugin gives Claude one tool, `show_image`. A basic call needs only a path. For a before and after, Claude also passes the old file and the test results:

```jsonc
{
  "path": "qa/after.png",           // the fixed version
  "compare": "qa/before.png",       // the same view on the old version
  "title": "Pricing page",
  "url": "http://localhost:3000/pricing",
  "changes": [                      // what changed
    { "title": "Annual toggle sets prices" },
    { "title": "Plan buttons line up" }
  ],
  "summary": [                      // the test results, at most three lines
    { "label": "Billing: toggle works", "ok": true, "passed": 1, "total": 1 },
    { "label": "Layout: plans, buttons", "ok": true, "passed": 3, "total": 3 }
  ]
}
```

To open a file yourself, run `/img path/to/file.png`.

To work on the plugin, edit the modules in `hooks/` (`register.tsx` is the entry) and run `/reload-plugins` to load your changes. The notes in `docs/technical/` explain each area. Before sending a change, run the checks in `docs/technical/testing-and-debugging.md`.

</details>

## License

[MIT](LICENSE). Photography in the examples is from [Unsplash](https://unsplash.com), used under the Unsplash License.
