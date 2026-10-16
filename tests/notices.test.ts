import { expect, test } from 'claude-code/testing'

import { noticeOf, NO_FFMPEG } from '../hooks/media'
import { cantDraw, causeOf } from '../hooks/player'

const P = '/Users/u/Desktop/hero.png'
const kindOf = (raw: string, path = P) => noticeOf(new Error(raw), path, '/Users/u').kind

test('each failure gets its own plain notice', () => {
  expect(kindOf('show-your-work: $.fs.stat(/Users/u/Desktop/hero.png) failed: ENOENT')).toBe('missing')
  expect(kindOf("could not convert /tmp/x/c50a67.txt: Error: Cannot extract image from file.")).toBe('not_image')
  expect(kindOf(NO_FFMPEG)).toBe('no_ffmpeg')
  expect(kindOf('something odd')).toBe('other')
})

test('notices use the person\'s own path, never raw tool output or temp copies', () => {
  for (const raw of ['show-your-work: $.fs.stat(/private/tmp/x) failed: ENOENT', 'could not convert /tmp/claude-show-your-work/c50a67.txt: sips', 'odd failure in /tmp/claude-show-your-work/a-3.png']) {
    const n = noticeOf(new Error(raw), P, '/Users/u')
    for (const text of [n.message, n.text, n.prompt]) {
      expect(/ENOENT|sips|claude-show-your-work|show-your-work:/.test(text)).toBe(false)
    }
    expect(n.message.includes('~/Desktop/hero.png')).toBe(true)
  }
})

test('a picture that cannot draw says why, and tells Claude it was not seen', () => {
  expect(causeOf(true, 'ghostty')).toBe('tmux')
  expect(causeOf(false, 'ghostty')).toBe('background')
  expect(causeOf(false, 'apple_terminal')).toBe('terminal')
  expect(cantDraw('tmux', 'a.png', 'id1').command).toBe('set -g allow-passthrough on')
  expect(cantDraw('terminal', 'a.png', 'id1').title).toBe("Your terminal isn't supported by show-your-work")
  expect(cantDraw('terminal', 'a.png', 'id1').link?.href).toBe('https://ghostty.org/download')
  expect(cantDraw('terminal', 'a.png', 'id1').claude.includes('https://ghostty.org/download')).toBe(true)
  expect(cantDraw('background', 'a.png', 'id1').command.includes('--resume id1')).toBe(true)
  for (const cause of ['tmux', 'terminal', 'background'] as const) expect(cantDraw(cause, 'a.png', '').claude.includes('saw a notice')).toBe(true)
})

test('the ffmpeg notice names a package manager, with a prompt to paste back', () => {
  const n = noticeOf(new Error(NO_FFMPEG), '/home/u/a.jpg', '/home/u')
  expect(n.kind).toBe('no_ffmpeg')
  expect(n.text.includes('apt install ffmpeg')).toBe(true)
  expect(n.prompt.includes('ffmpeg')).toBe(true)
  expect(/ENOENT/.test(NO_FFMPEG)).toBe(false)
})
