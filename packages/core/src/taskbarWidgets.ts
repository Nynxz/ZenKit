// Permanent-taskbar widget registry. Consumers register orderable/toggleable widgets via
// window.ZenKit.taskbar.register (or @nynxz/zenkit-client's registerTaskbarWidget). ZenTaskbar
// renders the enabled ones in order; Zen Settings drives the on/off + ordering. Built-ins
// (clock, and later the hide-panels toggle + canvas controls) register here too.
import { reactive } from 'vue'
import type { TaskbarWidget } from './types'

const LS = 'zenkit.taskbar.widgets.v1'
interface Prefs {
  on: Record<string, boolean> // explicit on/off (absent = use defaultOn)
  order: string[] // user order; ids not present fall back to the order hint
}
function load(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(LS) || 'null')
    if (p && typeof p === 'object')
      return { on: p.on || {}, order: Array.isArray(p.order) ? p.order : [] }
  } catch {
    /* ignore */
  }
  return { on: {}, order: [] }
}
const prefs = reactive<Prefs>(load())
const registry = reactive<TaskbarWidget[]>([])
function save() {
  try {
    localStorage.setItem(LS, JSON.stringify({ on: prefs.on, order: prefs.order }))
  } catch {
    /* ignore */
  }
}
const hintOf = (id: string) => registry.find((w) => w.id === id)?.order ?? 100

export function registerTaskbarWidget(w: TaskbarWidget): () => void {
  const i = registry.findIndex((x) => x.id === w.id)
  if (i >= 0) registry.splice(i, 1) // re-register replaces
  registry.push(w)
  if (!(w.id in prefs.on)) prefs.on[w.id] = w.defaultOn !== false
  if (!prefs.order.includes(w.id)) {
    prefs.order.push(w.id)
    prefs.order.sort((a, b) => hintOf(a) - hintOf(b)) // seed by hint; user reorders persist
    save()
  }
  return () => {
    const j = registry.findIndex((x) => x.id === w.id)
    if (j >= 0) registry.splice(j, 1)
  }
}

/** All registered widgets in user order (for the settings list) — includes disabled ones. */
export function orderedWidgets(): TaskbarWidget[] {
  const byId = new Map(registry.map((w) => [w.id, w]))
  const out: TaskbarWidget[] = []
  for (const id of prefs.order) {
    const w = byId.get(id)
    if (w) out.push(w)
  }
  for (const w of registry) if (!prefs.order.includes(w.id)) out.push(w)
  return out
}
/** Enabled widgets in order (what the taskbar renders). */
export function activeWidgets(): TaskbarWidget[] {
  return orderedWidgets().filter((w) => prefs.on[w.id] !== false)
}
export const isWidgetOn = (id: string) => prefs.on[id] !== false
export function setWidgetOn(id: string, on: boolean) {
  prefs.on[id] = on
  save()
}
/** Move a widget one slot left (-1) or right (+1) in the order. */
export function moveWidget(id: string, dir: -1 | 1) {
  const order = orderedWidgets().map((w) => w.id)
  const i = order.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= order.length) return
  ;[order[i], order[j]] = [order[j], order[i]]
  prefs.order = order
  save()
}
/** Replace the whole order (for drag-and-drop reordering). */
export function setWidgetOrder(order: string[]) {
  prefs.order = order
  save()
}
