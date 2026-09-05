// Pinned Start-menu launchers — a persisted list of registration ids, reactive
// so the taskbar updates live.
import { reactive } from 'vue'

const LS = 'zenkit.pins.v1'

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS) || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

const state = reactive<{ ids: string[] }>({ ids: load() })

function save() {
  try {
    localStorage.setItem(LS, JSON.stringify(state.ids))
  } catch {
    /* ignore */
  }
}

export function pinnedIds(): string[] {
  return state.ids
}

export function isPinned(id: string): boolean {
  return state.ids.includes(id)
}

export function togglePin(id: string): void {
  const i = state.ids.indexOf(id)
  if (i >= 0) state.ids.splice(i, 1)
  else state.ids.push(id)
  save()
}
