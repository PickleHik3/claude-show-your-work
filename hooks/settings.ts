// The plugin's remembered switches, kept in its store under 'settings' (a
// /config row would reload the plugin on every change). A switch is a field
// here, read from `settings`:
//   dataSaver  whether pictures are sent as small data saver copies (see
//              dataSaverOf; SHOW_YOUR_WORK_LINK overrides it)
import type { EngineInterface } from 'claude-code'

export const settings: Record<string, boolean> = {}

export async function loadSettings($: EngineInterface) {
  const saved = ((await $.store.get('settings')) ?? {}) as Record<string, unknown>
  for (const [field, value] of Object.entries(saved)) if (typeof value === 'boolean') settings[field] = value
}

export async function saveSetting($: EngineInterface, field: string, value: boolean) {
  // The saved choices, not this module's copy: a reload resets the copy.
  await loadSettings($)
  settings[field] = value
  await $.store.set('settings', { ...settings })
}

// Whether data saver is on: SHOW_YOUR_WORK_LINK=slow or =fast first, then
// the remembered choice, else on whenever pictures cross as bytes (ssh).
// The link's speed is never measured.
export function dataSaverOf(link: string, saved: boolean | undefined, sendBytes: boolean): boolean {
  if (link === 'slow') return true
  if (link === 'fast') return false
  return saved ?? sendBytes
}
// Whether the env var decides it, so the switch in the player can't.
export const isLinkForced = (link: string) => link === 'slow' || link === 'fast'
