// The plugin's remembered switches, kept in its store under 'settings' (a
// /config row would reload the plugin on every change). There are none at the
// moment; a switch is added as a field here and read from `settings`.
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
