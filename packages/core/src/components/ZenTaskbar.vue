<script setup lang="ts">
// Permanent bottom taskbar: a Start button (→ start-menu launcher popup) and the
// minimized panels as restore buttons. Replaces the old floating minimized chips.
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ZenContextMenu,
  ZenSelect,
  ZenIcon,
  ZenPopover,
  ZenMenuItem,
  ZenMenuSeparator,
  type ContextMenuItem,
} from '@nynxz/zenkit-ui'
import { STORE_KEY, type PanelStore } from '../panelStore'
import { APP_STORE_KEY, type AppStore } from '../appStore'
import { canvasGutter, TASKBAR_H, taskbarFloats } from '../tiling'
import { theme } from '../theme'
import { activeWidgets } from '../taskbarWidgets'
import { isPinned, togglePin, pinnedIds } from '../pins'
import TaskbarWidgetMount from './TaskbarWidgetMount.vue'
import { useTaskReorder } from '../taskReorder'
import { cleanName } from '../workflowLayout'
import { startDockTabDrag } from '../dockDrag'
import {
  activate,
  appTileId,
  createWorkspace,
  currentWorkflowName,
  hasWorkflow,
  leave,
  pinWorkspace,
  removeWorkspace,
  renameWorkspace,
  revealTile,
  tileRectOf,
  tilesOf,
  untile,
  workspaceOf,
  ws,
  type Workspace,
} from '../workspaces'

const store = inject(STORE_KEY) as PanelStore
const appStore = inject(APP_STORE_KEY) as AppStore
const ops = store._ops

function appByKey(key: string | null | undefined) {
  if (!key) return null
  return (
    appStore.state.registry.find((r) => appStore.keyOf(r) === key) || {
      id: key,
      title: key,
      icon: 'mdi mdi-application-outline',
    }
  )
}

// A chip per running app, like a window list: one on screen (full screen, or in the workspace
// showing) drops to the graph when clicked and keeps running; one off screen comes back where it
// was left (its workspace, for a tiled app); ✕ closes it.
const onScreen = (key: string) => {
  const tile = tileRectOf(appTileId(key))
  return tile ? tile !== 'hidden' : appStore.state.active.app === key
}
const appChips = computed(() =>
  appStore.state.running.map((loc) => {
    const reg = appByKey(loc.app)!
    return { key: loc.app!, title: reg.title, icon: reg.icon, active: onScreen(loc.app!) }
  }),
)

function toggleApp(key: string) {
  if (!onScreen(key)) appStore.restore(key)
  else if (appStore.state.active.app === key) appStore.minimize()
  else leave()
}

function closeApp(key: string) {
  untile(appTileId(key))
  appStore.close(key)
}

// --- workspaces ------------------------------------------------------------------------------
/** A workspace's panels: the open ones tiled there, and the ones waiting for it (closed with
 *  `keep` — a node's panel that steps aside while its workspace is off screen). */
const wsTiles = computed(() => new Map(ws.list.map((w) => [w.id, tilesOf(w)])))
const panelsOf = (w: Workspace) => wsTiles.value.get(w.id) ?? []
const tileCount = (w: Workspace) => panelsOf(w).length
/** A click on a workspace's tab: in, or back to the graph. The second click of a double-click is
 *  dropped, so a double-click is one switch rather than in and straight back out. */
function wsClick(e: MouseEvent, id: string) {
  if (e.detail > 1) return
  activate(ws.active === id ? null : id)
}
// Rename (from the tab's menu) happens in the tab: its label becomes an input of the same width,
// height and font, so nothing moves. Enter saves; Escape or leaving the field cancels; an empty
// name isn't taken.
const renaming = ref<string | null>(null)
const renameEl = ref<HTMLInputElement[] | null>(null)
const renameWidth = ref(0)
const renameBad = ref(false)
function startRename(id: string) {
  const label = root.value?.querySelector<HTMLElement>(`[data-ws-name="${CSS.escape(id)}"]`)
  // The label's exact width (a short name gives a short field; the text scrolls in it).
  renameWidth.value = Math.max(8, label?.getBoundingClientRect().width ?? 0)
  renameBad.value = false
  renaming.value = id
  // Filled once, not bound: a re-render (the empty-name mark) mustn't put the old name back.
  void nextTick(() => {
    const input = renameEl.value?.[0]
    if (!input) return
    input.value = ws.list.find((w) => w.id === id)?.name ?? ''
    input.focus()
    input.select()
  })
}
function saveRename(id: string, name: string) {
  if (renaming.value !== id) return
  if (!cleanName(name)) {
    renameBad.value = true
    return
  }
  renaming.value = null
  renameWorkspace(id, name)
}
function cancelRename() {
  renaming.value = null
}
/** The taskbar's own strip: its menus open beside it (above a bottom bar), never over it. */
const barRect = () => root.value?.getBoundingClientRect() ?? null
const wsMenu = ref<InstanceType<typeof ZenContextMenu> | null>(null)
const wsMenuFor = ref<string | null>(null)
function openWsMenu(e: MouseEvent, id: string) {
  cancelRename()
  wsListOpen.value = false
  wsMenuFor.value = id
  wsMenu.value?.show(e, { clear: barRect() })
}
/** Go to a panel's workspace and bring the panel up — a waiting one reopens there. */
function jumpTo(id: string) {
  revealTile(id)
}
const wsHint = (x: Workspace) => {
  const i = ws.list.indexOf(x)
  return i >= 0 && i < 9 ? `Alt+${i + 1}` : undefined
}
const wsItem = (x: Workspace): ContextMenuItem => ({
  label: `${x.name}${tileCount(x) ? ` (${tileCount(x)})` : ''}`,
  icon: `mdi ${ws.active === x.id ? 'mdi-check' : x.scope === 'global' ? 'mdi-pin-outline' : 'mdi-view-dashboard-outline'}`,
  hint: wsHint(x),
  run: () => activate(x.id),
})
const wsMenuItems = computed<ContextMenuItem[]>(() => {
  if (wsListOpen.value && !wsMenuFor.value)
    return [
      { heading: wfName.value ?? 'Workspaces' },
      {
        label: 'The graph',
        icon: `mdi ${ws.active ? 'mdi-graph-outline' : 'mdi-check'}`,
        run: () => activate(null),
      },
      ...ownWs.value.map(wsItem),
      ...(globalWs.value.length
        ? (['-', { heading: 'Global' }, ...globalWs.value.map(wsItem)] as ContextMenuItem[])
        : []),
      '-',
      {
        label: wfName.value ? `New workspace for ${wfName.value}` : 'New workspace',
        icon: 'mdi mdi-plus',
        run: () => activate(createWorkspace().id),
      },
      {
        label: 'New global workspace',
        icon: 'mdi mdi-pin-outline',
        run: () => activate(createWorkspace(undefined, 'global').id),
      },
    ]
  const w = ws.list.find((x) => x.id === wsMenuFor.value)
  if (!w) return []
  const own = panelsOf(w)
  return [
    { heading: w.scope === 'global' ? `${w.name} · global` : w.name },
    {
      label: ws.active === w.id ? 'Back to the graph' : 'Open',
      icon: 'mdi mdi-arrow-right',
      run: () => activate(ws.active === w.id ? null : w.id),
    },
    ...(own.length
      ? ([
          '-',
          { heading: 'Panels here' },
          ...own.map((p) => ({ label: p.title, icon: p.icon, run: () => jumpTo(p.id) })),
        ] as ContextMenuItem[])
      : []),
    '-',
    w.scope === 'global'
      ? {
          label: wfName.value ? `Make it ${wfName.value}'s` : "Make it this workflow's",
          icon: 'mdi mdi-pin-off-outline',
          disabled: !hasWorkflow(),
          run: () => pinWorkspace(w.id, false),
        }
      : {
          label: 'Pin as global',
          icon: 'mdi mdi-pin-outline',
          run: () => pinWorkspace(w.id, true),
        },
    { label: 'Rename…', icon: 'mdi mdi-pencil-outline', run: () => startRename(w.id) },
    '-',
    {
      label: 'Remove workspace',
      icon: 'mdi mdi-trash-can-outline',
      danger: true,
      run: () => removeWorkspace(w.id),
    },
  ]
})

// enabled taskbar widgets, in user order (reactive — registry/prefs are reactive)
const widgets = computed(() => activeWidgets())

// Windowed consumer panels (floating + minimized; docked/sidebar live elsewhere) that belong
// HERE: free-floating ones, which show over the graph and every workspace, plus the ones tiled in
// the workspace on screen. Another workspace's panels sit behind its tab (its menu lists them).
// Ambient (frame:'none') panels like the mascot aren't "windows" — keep them out of the bar.
const windowed = computed(() =>
  store.state.list.filter(
    (p) => !p.id.startsWith('zenkit:') && !p.dockSide && !p.inSidebar && p.frame !== 'none',
  ),
)
const tasks = computed(() =>
  ops.sortByTaskOrder(
    windowed.value.filter((p) => {
      const home = workspaceOf(p.id)
      return !home || home.id === ws.active
    }),
  ),
)
/** The current workflow's workspaces come first, then the global ones. */
const wfName = computed(() => currentWorkflowName())
const ownWs = computed(() => ws.list.filter((w) => w.scope === 'workflow'))
const globalWs = computed(() => ws.list.filter((w) => w.scope === 'global'))
/** Many workspaces: the tabs collapse to the active one plus a list. */
const WS_TABS = 4
const wsCompact = computed(() => ws.list.length > WS_TABS)
const shownOf = (list: Workspace[]) =>
  wsCompact.value ? list.filter((w) => w.id === ws.active) : list
const wsGroups = computed(() => [
  { scope: 'workflow', list: shownOf(ownWs.value) },
  { scope: 'global', list: shownOf(globalWs.value) },
])
const wsTitle = (w: Workspace) => {
  const names = panelsOf(w).map((p) => p.title)
  const where =
    w.scope === 'global'
      ? ' · global: shown with every workflow'
      : wfName.value
        ? ` · saved in ${wfName.value}`
        : ''
  return `${w.name}${names.length ? ' — ' + names.join(', ') : ' — empty'}${where} · right-click to rename and more`
}
function openWsList(e: MouseEvent) {
  wsMenuFor.value = null
  wsListOpen.value = true
  wsMenu.value?.show(e, { clear: barRect() })
}
const wsListOpen = ref(false)
// Bottom-docked panels: the taskbar is their tab strip. The shown one is the zone's active tab
// (or its first, as the dock layout falls back to) unless the zone is tucked away.
const bottomDocked = computed(() => ops.dockMembers('bottom'))
const bottomShownId = computed(() => {
  const z = store.state.docks.bottom
  if (z.collapsed) return null
  const members = bottomDocked.value
  return members.some((p) => p.id === z.active) ? z.active : (members[0]?.id ?? null)
})

// The frontmost open panel (highest z) — shown active; null when panels are hidden.
const focusedId = computed(() => {
  if (store.state.panelsHidden) return null
  const open = tasks.value.filter((p) => p.status === 'open')
  return open.length ? open.reduce((a, b) => (b.z > a.z ? b : a)).id : null
})
function taskClick(p: { id: string; status: string }) {
  if (clickWasDrag()) return
  // A panel tiled in a workspace that isn't on screen: go there and show it.
  const home = workspaceOf(p.id)
  if (home && ws.active !== home.id) {
    activate(home.id)
    if (p.status === 'minimized') ops.restore(p.id)
    else ops.front(p.id)
    return
  }
  if (p.status === 'minimized') ops.restore(p.id)
  else if (focusedId.value === p.id)
    ops.minimize(p.id) // click the active one → minimize
  else ops.front(p.id) // bring an open-but-behind one to the front
}

// --- per-tab context menu: act on a panel without focusing it first ------------
const ctxOpen = ref(false)
const ctxAt = ref<DOMRect | { x: number; y: number }>({ x: 0, y: 0 })
const ctxPanel = ref<{ id: string; title: string; status: string } | null>(null)
const ctxDocked = computed(() => !!(ctxPanel.value && ops.get(ctxPanel.value.id)?.dockSide))

function openTaskMenu(e: MouseEvent, p: { id: string; title: string; status: string }) {
  ctxPanel.value = p
  // A zero-width strip at the pointer's x spanning the bar: the menu opens beside the bar.
  const bar = barRect()
  ctxAt.value = bar
    ? new DOMRect(e.clientX, bar.top, 0, bar.height)
    : { x: e.clientX, y: e.clientY }
  ctxOpen.value = true
  closeOverflow()
}
function runOnCtx(fn: (id: string) => void) {
  const p = ctxPanel.value
  ctxOpen.value = false
  if (p) fn(p.id)
}

// --- open-panels overflow: no horizontal scroll. Tasks that don't fit collapse into a
// "⋯N" chip that opens a list. visibleCount is measured from the laid-out button positions;
// overflowed buttons stay in the DOM (visibility:hidden) so the geometry is stable to re-measure.
const tasksEl = ref<HTMLElement | null>(null)
const taskIds = () => tasks.value.map((p) => p.id)
const { dropLine, draggingId, onPointerDown, clickWasDrag } = useTaskReorder(
  tasksEl,
  taskIds,
  (id, beforeId) => ops.reorderTask(taskIds(), id, beforeId),
)
const visibleCount = ref(99)
const overflowCount = computed(() => Math.max(0, tasks.value.length - visibleCount.value))
const overflowTasks = computed(() => tasks.value.slice(visibleCount.value))
function measureTasks() {
  const el = tasksEl.value
  if (!el) return
  const btns = Array.from(el.querySelectorAll<HTMLElement>('.tb-task:not(.tb-ovf)'))
  const n = btns.length
  if (!n) {
    visibleCount.value = 0
    return
  }
  const avail = el.clientWidth
  const last = btns[n - 1]
  if (last.offsetLeft + last.offsetWidth <= avail) {
    visibleCount.value = n
    return
  } // all fit
  const CHIP = 44 // reserve room for the overflow chip
  let count = 0
  for (let i = 0; i < n; i++) {
    if (btns[i].offsetLeft + btns[i].offsetWidth <= avail - CHIP) count = i + 1
    else break
  }
  visibleCount.value = count
}
let tasksRO: ResizeObserver | null = null
onMounted(() => {
  measureTasks()
  if (tasksEl.value && typeof ResizeObserver !== 'undefined') {
    tasksRO = new ResizeObserver(() => measureTasks())
    tasksRO.observe(tasksEl.value)
  }
})
onBeforeUnmount(() => {
  tasksRO?.disconnect()
  tasksRO = null
})
watch(tasks, () => nextTick(measureTasks))

// overflow list popup (teleported, anchored to the chip)
const ovfOpen = ref(false)
const ovfEl = ref<HTMLElement | null>(null)
const ovfStyle = ref<Record<string, string>>({})
function onOvfDoc(e: PointerEvent) {
  const t = e.target as Node
  if (ovfEl.value?.contains(t) || (e.target as Element | null)?.closest?.('.tb-ovf')) return
  closeOverflow()
}
function openOverflow() {
  const chip = tasksEl.value?.querySelector('.tb-ovf') as HTMLElement | null
  if (chip) {
    const r = chip.getBoundingClientRect()
    const right = window.innerWidth - r.right + 'px'
    ovfStyle.value =
      store.state.taskbarPos === 'top'
        ? { right, top: r.bottom + 8 + 'px' }
        : { right, bottom: window.innerHeight - r.top + 8 + 'px' }
  }
  ovfOpen.value = true
  setTimeout(() => window.addEventListener('pointerdown', onOvfDoc, true), 0)
}
function closeOverflow() {
  if (!ovfOpen.value) return
  ovfOpen.value = false
  window.removeEventListener('pointerdown', onOvfDoc, true)
}
function toggleOverflow() {
  if (ovfOpen.value) closeOverflow()
  else openOverflow()
}
watch(overflowCount, (n) => {
  if (!n) closeOverflow()
})

// Registered launchers, grouped by plugin, filtered by the menu search.
const q = ref('')
const groups = computed(() => {
  const s = q.value.trim().toLowerCase()
  const by = new Map<
    string,
    { plugin: string; logo?: string; items: typeof store.state.registry }
  >()
  for (const r of store.state.registry) {
    if (r.spawnOnly) continue
    if (r.plugin && !store.pluginEnabled(r.plugin)) continue // hidden via Zen Settings
    if (s && !r.title.toLowerCase().includes(s) && !(r.plugin || '').toLowerCase().includes(s))
      continue
    const key = r.plugin || 'Other'
    if (!by.has(key)) by.set(key, { plugin: key, logo: r.logo, items: [] })
    by.get(key)!.items.push(r)
  }
  return [...by.values()]
})
const instCount = (typeId: string) => store.instances(typeId).length

// Registered full-screen apps (launcher "Apps" section), filtered by the menu search.
const apps = computed(() => {
  const s = q.value.trim().toLowerCase()
  return appStore.state.registry.filter((a) => {
    if (a.spawnOnly) return false
    if (a.plugin && !store.pluginEnabled(a.plugin)) return false
    if (s && !a.title.toLowerCase().includes(s) && !(a.plugin || '').toLowerCase().includes(s))
      return false
    return true
  })
})
function launchApp(a: { id: string; namespace?: string; plugin?: string }) {
  appStore.open(appStore.keyOf(a)) // open by full key (id collisions across plugins are safe)
  closeMenu()
}

// Pinned launchers (persisted by registration id) — shown as a card strip.
const pinned = computed(() =>
  pinnedIds()
    .map((id) => store.state.registry.find((r) => r.id === id))
    .filter(
      (r): r is NonNullable<typeof r> =>
        !!r && !r.spawnOnly && (!r.plugin || store.pluginEnabled(r.plugin)),
    ),
)

// --- start menu (teleported, anchored above the Start button) ---
const root = ref<HTMLElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const menuStyle = ref<Record<string, string>>({})
function onDoc(e: PointerEvent) {
  const t = e.target as Node
  if (root.value?.contains(t) || menuEl.value?.contains(t)) return
  // the theme ZenSelect's dropdown is teleported to <body>, so it's "outside" the
  // start menu in the DOM — don't treat clicking it as a click-away.
  if ((e.target as Element | null)?.closest?.('.zs-menu')) return
  closeMenu()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeMenu()
}
function openMenu() {
  const btn = root.value?.querySelector('.tb-start') as HTMLElement | null
  if (btn) {
    const r = btn.getBoundingClientRect()
    const gap = 11 // breathing room off the toolbar, matched to the minimap's distance
    menuStyle.value =
      store.state.taskbarPos === 'top'
        ? { left: r.left + 'px', top: r.bottom + gap + 'px' }
        : { left: r.left + 'px', bottom: window.innerHeight - r.top + gap + 'px' }
  }
  menuOpen.value = true
  scanComfyButtons()
  setTimeout(() => {
    window.addEventListener('pointerdown', onDoc, true)
    window.addEventListener('keydown', onKey, true)
  }, 0)
}
function closeMenu() {
  if (!menuOpen.value) return
  menuOpen.value = false
  q.value = ''
  window.removeEventListener('pointerdown', onDoc, true)
  window.removeEventListener('keydown', onKey, true)
}
function launch(r: { open: () => void }) {
  r.open()
  closeMenu()
}
function openSettings() {
  store.open('zenkit:settings')
  closeMenu()
}
onBeforeUnmount(closeMenu)

// --- theme controls (start-menu footer) ---
// computed: a pack a plugin registers after the taskbar mounts still joins the list
const packOptions = computed(() =>
  theme.packs().map((id) => ({ value: id, label: theme.packLabel(id) })),
)
const current = ref(theme.current())
const mode = ref(theme.currentMode())
// keep the footer in sync when the theme changes from anywhere (Zen Settings, etc.)
const offTheme = theme.onChange(() => {
  current.value = theme.current()
  mode.value = theme.currentMode()
})
onBeforeUnmount(offTheme)
// some packs are dark-only / light-only — lock the toggle so you can't pick an unsupported mode
const modeFixed = computed(() => theme.packModes(current.value).length < 2)
function onPick(id: string) {
  theme.setPack(id)
  current.value = theme.current()
}
function setDark() {
  theme.setMode(mode.value === 'dark' ? 'light' : 'dark')
  mode.value = theme.currentMode()
}

// White-label Start button. The store resolves the name/logo (Zen Settings override →
// distributor's branding.set() → ComfyUI's own), so this is always renderable. The logo may
// be an image URL/data URI or an MDI class — ZenIcon picks the renderer, and falls back to
// the hexagon glyph if an image 404s.
const branding = computed(() => store.state.branding)

// ComfyUI's sidebar-bottom buttons, absorbed into the menu (when the setting is on).
// We read them live and proxy clicks to the originals (which we CSS-hide) — no fragile
// command IDs, and it tracks whatever ComfyUI puts there.
interface ComfyBtn {
  label: string
  icon: string // the original icon element's class list, rendered on our own <i> so
  el: HTMLElement // ComfyUI's global icon classes (size-4 / pi / lucide mask) size it
}
const comfyButtons = ref<ComfyBtn[]>([])
// The store hides the bottom cluster (.sidebar-item-group.mt-auto) via CSS. For the menu
// list we match those buttons by aria-label across the toolbar (this is what reliably
// found their renderable icon element) and copy the icon's class onto our own <i>.
const COMFY_LABELS = /settings|help|shortcut|keyboard|bottom panel/i
// ComfyUI's own icons (svg / lucide mask / pi) don't reliably reproduce in our menu, so
// map the known buttons to our own MDI icons (always loaded) by aria-label keyword.
function iconFor(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('setting')) return 'mdi mdi-cog-outline'
  if (l.includes('help')) return 'mdi mdi-help-circle-outline'
  if (l.includes('keyboard') || l.includes('shortcut')) return 'mdi mdi-keyboard-outline'
  if (
    l.includes('bottom') ||
    l.includes('panel') ||
    l.includes('terminal') ||
    l.includes('console') ||
    l.includes('log')
  )
    return 'mdi mdi-dock-bottom'
  if (l.includes('theme')) return 'mdi mdi-palette-outline'
  return 'mdi mdi-dots-horizontal'
}
function scanComfyButtons() {
  comfyButtons.value = []
  if (!store.state.absorbComfyButtons) return
  const bar = document.querySelector('.side-tool-bar-container')
  if (!bar) return
  const seen = new Set<HTMLElement>()
  const out: ComfyBtn[] = []
  bar.querySelectorAll<HTMLElement>('button, [role="button"], .side-bar-button').forEach((el) => {
    const label =
      el.getAttribute('aria-label') ||
      el.querySelector('.side-bar-button-label')?.textContent?.trim() ||
      el.title ||
      ''
    if (!label || !COMFY_LABELS.test(label) || seen.has(el)) return
    seen.add(el)
    out.push({ label, icon: iconFor(label), el })
  })
  comfyButtons.value = out
}
// re-scan when the setting flips (the hide itself is immediate via the store's CSS)
watch(
  () => store.state.absorbComfyButtons,
  () => scanComfyButtons(),
  { immediate: true },
)

// --- ComfyUI canvas controls are now the built-in `zenkit:canvas-controls` taskbar widget ---
function clickComfy(b: ComfyBtn) {
  try {
    b.el.click()
  } catch {
    /* original may have gone away */
  }
  closeMenu()
}

const floating = computed(() => taskbarFloats(store))
const tbStyle = computed(() => {
  if (store.state.taskbarPos === 'top')
    return { height: TASKBAR_H + 'px', top: store.state.topbarH + 'px', bottom: 'auto' }
  if (!floating.value) return { height: TASKBAR_H + 'px', bottom: '0', top: 'auto' }
  const g = canvasGutter() + 'px'
  return { height: TASKBAR_H + 'px', bottom: g, top: 'auto', left: g, right: g }
})
// Named rather than inlined in the template: Prettier's `semi: false` strips the separator from a
// multi-statement inline handler, and Vue cannot parse newline-separated statements there.
function openTaskFromOverflow(p: Parameters<typeof taskClick>[0]) {
  taskClick(p)
  closeOverflow()
}
</script>

<template>
  <div
    ref="root"
    class="tb"
    data-zen-taskbar
    :class="['pos-' + store.state.taskbarPos, { floating }]"
    :style="tbStyle"
  >
    <button
      class="tb-start"
      :class="{ on: menuOpen }"
      :title="branding.title"
      @click="menuOpen ? closeMenu() : openMenu()"
    >
      <ZenIcon class="tb-logo" :icon="branding.logo" fallback="mdi-hexagon-multiple" />
      <span class="tb-start-lbl">{{ branding.title }}</span>
    </button>

    <!-- Running full-screen apps: active = showing (click minimizes to the graph), otherwise
         minimized (click shows it where it was left). ✕ or a middle-click closes one. -->
    <button
      v-for="a in appChips"
      :key="a.key"
      class="tb-task tb-app"
      :class="{ active: a.active }"
      :title="a.active ? a.title + ' — click to minimize' : 'Show ' + a.title"
      @click="toggleApp(a.key)"
      @auxclick.prevent="$event.button === 1 && closeApp(a.key)"
    >
      <ZenIcon :icon="a.icon" />
      <span class="tb-task-lbl">{{ a.title }}</span>
      <i class="tb-app-x mdi mdi-close" title="Close" @click.stop="closeApp(a.key)" />
    </button>

    <!-- workspaces: the graph, then a tab per workspace (named, with its panel count); Alt+`
         flips between them. Many workspaces collapse to the active tab plus a list. -->
    <div class="tb-ws" @contextmenu.prevent>
      <button
        class="tb-ws-b graph"
        :class="{ active: !ws.active }"
        title="The graph (Alt+`)"
        @click="activate(null)"
      >
        <i class="mdi mdi-graph-outline" />
        <span class="tb-ws-name">Graph</span>
      </button>
      <template v-for="group in wsGroups" :key="group.scope">
        <span v-if="group.scope === 'global' && group.list.length" class="tb-ws-sep" />
        <template v-for="w in group.list" :key="w.id">
          <!-- Renaming: the same tab with its label as an input of the label's width. -->
          <span
            v-if="renaming === w.id"
            class="tb-ws-b editing"
            :class="{
              active: ws.active === w.id,
              global: w.scope === 'global',
              invalid: renameBad,
            }"
          >
            <i class="mdi mdi-view-dashboard-outline" />
            <input
              ref="renameEl"
              class="tb-ws-rename"
              :style="{ width: `${renameWidth}px` }"
              :aria-label="`Rename ${w.name}`"
              :aria-invalid="renameBad || undefined"
              :title="renameBad ? 'A name can\'t be empty' : 'Enter to save · Escape to cancel'"
              maxlength="48"
              spellcheck="false"
              @input="renameBad = false"
              @keydown.enter.prevent="saveRename(w.id, ($event.target as HTMLInputElement).value)"
              @keydown.esc.prevent.stop="cancelRename"
              @blur="cancelRename"
            />
            <i v-if="w.scope === 'global'" class="mdi mdi-pin tb-ws-pin" />
            <span v-if="tileCount(w)" class="tb-ws-count">{{ tileCount(w) }}</span>
          </span>
          <button
            v-else
            class="tb-ws-b"
            :class="{ active: ws.active === w.id, global: w.scope === 'global' }"
            :title="wsTitle(w)"
            @click="wsClick($event, w.id)"
            @contextmenu.prevent.stop="openWsMenu($event, w.id)"
          >
            <i class="mdi mdi-view-dashboard-outline" />
            <span class="tb-ws-name" :data-ws-name="w.id">{{ w.name }}</span>
            <i v-if="w.scope === 'global'" class="mdi mdi-pin tb-ws-pin" />
            <span v-if="tileCount(w)" class="tb-ws-count">{{ tileCount(w) }}</span>
          </button>
        </template>
        <button
          v-if="group.scope === 'workflow' && !wsCompact"
          class="tb-ws-b add"
          :title="wfName ? `New workspace for ${wfName}` : 'New workspace'"
          @click="activate(createWorkspace().id)"
        >
          <i class="mdi mdi-plus" />
        </button>
      </template>
      <button
        v-if="wsCompact"
        class="tb-ws-b more"
        :title="`All ${ws.list.length} workspaces`"
        @click="openWsList"
      >
        <i class="mdi mdi-chevron-up" />
      </button>
    </div>
    <ZenContextMenu ref="wsMenu" :items="wsMenuItems" />

    <div v-if="bottomDocked.length" class="tb-docked">
      <button
        v-for="p in bottomDocked"
        :key="p.id"
        class="tb-dock"
        :class="{ active: bottomShownId === p.id }"
        :title="(bottomShownId === p.id ? 'hide ' : 'show ') + p.title"
        @pointerdown="
          startDockTabDrag($event, store, p.id, () => ops.toggleDockTab('bottom', p.id))
        "
        @keydown.enter.space.prevent="ops.toggleDockTab('bottom', p.id)"
        @contextmenu.prevent.stop="openTaskMenu($event, p)"
      >
        <ZenIcon :icon="p.icon" />
      </button>
    </div>

    <div ref="tasksEl" class="tb-tasks">
      <button
        v-for="(p, i) in tasks"
        :key="p.id"
        :data-task-id="p.id"
        class="tb-task"
        :class="{
          min: p.status === 'minimized',
          active: focusedId === p.id,
          'tb-off': i >= visibleCount,
          dragging: draggingId === p.id,
        }"
        :title="
          p.status === 'minimized'
            ? 'restore ' + p.title
            : focusedId === p.id
              ? 'minimize ' + p.title
              : 'focus ' + p.title
        "
        @pointerdown="onPointerDown($event, p.id)"
        @click="taskClick(p)"
        @contextmenu.prevent.stop="openTaskMenu($event, p)"
      >
        <ZenIcon :icon="p.icon" />
        <span class="tb-task-lbl">{{ p.title }}</span>
      </button>
      <button
        v-if="overflowCount > 0"
        class="tb-task tb-ovf"
        :class="{ on: ovfOpen }"
        :title="overflowCount + ' more panel' + (overflowCount > 1 ? 's' : '')"
        @click.stop="toggleOverflow"
      >
        <i class="mdi mdi-dots-horizontal" />
        <span class="tb-task-lbl">{{ overflowCount }}</span>
      </button>
      <div v-if="dropLine !== null" class="tb-drop-line" :style="{ left: dropLine + 'px' }" />
    </div>

    <!-- unified right-side strip: all widgets (canvas controls, VRAM, hide, …) share one gap -->
    <div v-if="widgets.length" class="tb-widgets">
      <TaskbarWidgetMount v-for="w in widgets" :key="w.id" :widget="w" />
    </div>

    <Teleport to="body">
      <div v-if="menuOpen" ref="menuEl" class="tb-menu" :style="menuStyle">
        <div class="tb-search">
          <i class="mdi mdi-magnify" />
          <input v-model="q" placeholder="Search panels…" spellcheck="false" autofocus />
        </div>

        <!-- All panels (browse + live search) — the main scroll area -->
        <div class="tb-pane zen-scroll">
          <!-- Apps: full-screen apps that cover the graph (launch over the desktop) -->
          <div v-if="apps.length" class="tb-group">
            <div class="tb-gtitle">
              <i class="mdi mdi-application-brackets-outline" />
              <span>Apps</span>
            </div>
            <button
              v-for="a in apps"
              :key="'app-' + appStore.keyOf(a)"
              class="tb-item"
              :title="'open ' + a.title"
              @click="launchApp(a)"
            >
              <ZenIcon :icon="a.icon" />
              <span class="tb-item-lbl">{{ a.title }}</span>
              <span class="tb-grow" />
              <i class="mdi mdi-fullscreen tb-appglyph" title="full-screen app" />
            </button>
          </div>
          <!-- Pinned: a group at the top of the list (consistent rows) — no card grid / scroll -->
          <div v-if="pinned.length && !q" class="tb-group">
            <div class="tb-gtitle">
              <i class="mdi mdi-pin" />
              <span>Pinned</span>
            </div>
            <button
              v-for="r in pinned"
              :key="'pin-' + r.id"
              class="tb-item"
              :title="'open ' + r.title"
              @click="launch(r)"
            >
              <ZenIcon :icon="r.icon" />
              <span class="tb-item-lbl">{{ r.title }}</span>
              <span class="tb-grow" />
              <span v-if="r.multi && instCount(r.id)" class="tb-badge">{{ instCount(r.id) }}</span>
              <i class="mdi mdi-pin tb-pinbtn on" title="Unpin" @click.stop="togglePin(r.id)" />
            </button>
          </div>
          <template v-if="groups.length">
            <div v-for="g in groups" :key="g.plugin" class="tb-group">
              <div class="tb-gtitle">
                <img v-if="g.logo" :src="g.logo" class="tb-glogo" alt="" />
                <i v-else class="mdi mdi-puzzle-outline" />
                <span>{{ g.plugin }}</span>
              </div>
              <button
                v-for="r in g.items"
                :key="r.id"
                class="tb-item"
                :title="r.multi ? 'open a new ' + r.title : 'open ' + r.title"
                @click="launch(r)"
              >
                <ZenIcon :icon="r.icon" />
                <span class="tb-item-lbl">{{ r.title }}</span>
                <span class="tb-grow" />
                <span v-if="r.multi && instCount(r.id)" class="tb-badge">
                  {{ instCount(r.id) }}
                </span>
                <i
                  class="mdi tb-pinbtn"
                  :class="isPinned(r.id) ? 'mdi-pin on' : 'mdi-pin-outline'"
                  :title="isPinned(r.id) ? 'Unpin' : 'Pin'"
                  @click.stop="togglePin(r.id)"
                />
              </button>
            </div>
          </template>
          <div v-else class="tb-empty">
            {{ q ? 'No matches' : 'No plugins have registered panels yet.' }}
          </div>
        </div>

        <!-- Footer: one control line. Zen Settings + the absorbed ComfyUI buttons cluster
             on the left; theme selector + light/dark toggle pin to the right. Every control
             shares the boxed .tb-fbtn style for a consistent row. -->
        <div class="tb-foot">
          <div class="tb-foot-l">
            <button class="tb-fbtn" title="Zen Settings" @click="openSettings">
              <i class="mdi mdi-tune-variant" />
            </button>
            <button
              v-for="b in comfyButtons"
              :key="b.label"
              class="tb-fbtn"
              :title="b.label"
              @click="clickComfy(b)"
            >
              <i :class="b.icon" />
            </button>
          </div>
          <div class="tb-theme">
            <ZenSelect
              class="tb-themesel"
              :model-value="current"
              :options="packOptions"
              @update:model-value="onPick"
            />
            <button
              class="tb-fbtn tb-modebtn"
              :disabled="modeFixed"
              :title="modeFixed ? `This theme is ${mode}-only` : 'Toggle dark / light'"
              @click="setDark()"
            >
              <i
                class="mdi"
                :class="mode === 'dark' ? 'mdi-weather-night' : 'mdi-white-balance-sunny'"
              />
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- overflow list: the open panels that didn't fit in the strip -->
    <Teleport to="body">
      <div v-if="ovfOpen" ref="ovfEl" class="tb-ovfmenu" :style="ovfStyle">
        <button
          v-for="p in overflowTasks"
          :key="p.id"
          class="tb-ovfitem"
          :class="{ min: p.status === 'minimized' }"
          :title="'open ' + p.title"
          @click="openTaskFromOverflow(p)"
        >
          <ZenIcon :icon="p.icon" />
          <span class="tb-ovfitem-lbl">{{ p.title }}</span>
        </button>
      </div>
    </Teleport>

    <ZenPopover v-model:open="ctxOpen" :anchor="ctxAt" placement="bottom-start">
      <template v-if="ctxDocked">
        <ZenMenuItem
          icon="mdi mdi-window-restore"
          @select="runOnCtx((id) => ops.setDock(id, null))"
        >
          Undock (float)
        </ZenMenuItem>
        <ZenMenuItem
          v-if="store.state.sidebarAvailable"
          icon="mdi mdi-dock-left"
          @select="runOnCtx(ops.pinSidebar)"
        >
          Pin to sidebar
        </ZenMenuItem>
      </template>
      <ZenMenuItem
        v-else-if="ctxPanel?.status === 'minimized'"
        icon="mdi mdi-window-restore"
        @select="runOnCtx(ops.restore)"
      >
        Restore
      </ZenMenuItem>
      <template v-else>
        <ZenMenuItem
          v-if="focusedId !== ctxPanel?.id"
          icon="mdi mdi-arrow-up-bold-box-outline"
          @select="runOnCtx(ops.front)"
        >
          Bring to front
        </ZenMenuItem>
        <ZenMenuItem icon="mdi mdi-window-minimize" @select="runOnCtx(ops.minimize)">
          Minimize
        </ZenMenuItem>
      </template>
      <template v-if="!ctxDocked">
        <ZenMenuSeparator />
        <ZenMenuItem
          icon="mdi mdi-dock-bottom"
          @select="runOnCtx((id) => ops.setDock(id, 'bottom'))"
        >
          Dock to taskbar
        </ZenMenuItem>
        <ZenMenuItem icon="mdi mdi-dock-right" @select="runOnCtx((id) => ops.setDock(id, 'right'))">
          Dock right
        </ZenMenuItem>
        <ZenMenuItem
          v-if="store.state.sidebarAvailable"
          icon="mdi mdi-dock-left"
          @select="runOnCtx(ops.pinSidebar)"
        >
          Pin to sidebar
        </ZenMenuItem>
      </template>
      <ZenMenuSeparator />
      <ZenMenuItem icon="mdi mdi-close" danger @select="runOnCtx(ops.close)">Close</ZenMenuItem>
    </ZenPopover>
  </div>
</template>

<style scoped>
.tb {
  position: fixed;
  left: 0;
  right: 0;
  z-index: 99999;
  display: flex;
  align-items: stretch;
  gap: 6px;
  padding: 4px 6px;
  box-sizing: border-box;
  background: color-mix(
    in srgb,
    var(--zen-chrome-bg, var(--zen-surface, #202026)) 94%,
    transparent
  );
  border-top: 1px solid var(--zen-border, #3a3a44);
  backdrop-filter: blur(10px);
  font-family: var(--p-font-family, system-ui, sans-serif);
  color: var(--zen-text, #e5e5ea);
  pointer-events: auto;
}
.tb.pos-top {
  border-top: none;
  border-bottom: 1px solid var(--zen-border, #3a3a44);
}
/* Floating: an inset card like the rest of the canvas chrome. */
.tb.floating {
  border: 1px solid var(--zen-surface-border, var(--zen-border, #3a3a44));
  border-radius: var(--zen-radius-surface, var(--zen-radius, 10px));
}
.tb-start {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: var(--zen-radius, 7px);
  color: var(--zen-text, #e5e5ea);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  font-family: inherit;
}
.tb-start:hover,
.tb-start.on {
  background: color-mix(in srgb, var(--zen-accent, #3b82f6) 22%, transparent);
  color: var(--zen-accent, #3b82f6);
}
.tb-start .mdi {
  font-size: 17px;
}
/* ZenIcon renders either form under this class. `img.` (not `.tb-logo`) so the element
   selector outweighs ZenIcon's own scoped `.zen-ico-img { width: 1em }`; `contain` so a
   white-label logo of any aspect isn't cropped. The glyph form is sized by `.tb-start .mdi`. */
img.tb-logo {
  width: 18px;
  height: 18px;
  border-radius: var(--zen-radius, 5px);
  object-fit: contain;
}

/* no horizontal scroll: clip overflow, JS collapses what doesn't fit into the .tb-ovf chip */
.tb-docked {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding-right: 6px;
  margin-right: 2px;
  border-right: 1px solid var(--zen-surface-border, var(--zen-border, #3a3a44));
}
.tb-dock {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  border: none;
  border-radius: var(--zen-radius, 6px);
  background: var(--zen-ghost-bg, transparent);
  color: var(--zen-muted, #9aa0aa);
  font-size: 15px;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.tb-dock:hover {
  background: var(--zen-control-hover-bg, var(--zen-control-bg, #202026));
  color: var(--zen-text, #e5e5ea);
}
/* The shown docked panel gets the same tint + underline as the frontmost window chip, so it
   reads as open whatever its icon is (an image icon ignores `color`); hidden image icons dim. */
.tb-dock.active {
  background: color-mix(in srgb, var(--zen-accent, #3b82f6) 16%, var(--zen-bg, #15151a));
  color: var(--zen-accent, #3b82f6);
  box-shadow: inset 0 -2px 0 var(--zen-accent, #3b82f6);
}
.tb-dock :deep(.zen-ico-img) {
  transition: opacity 0.12s ease;
}
.tb-dock:not(.active):not(:hover) :deep(.zen-ico-img) {
  opacity: 0.6;
}
.tb-tasks {
  flex: 1;
  min-width: 0;
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 4px;
  overflow: hidden;
  user-select: none;
}
.tb-task.dragging {
  opacity: 0.5;
  cursor: grabbing;
}
.tb-drop-line {
  position: absolute;
  top: 50%;
  width: 2px;
  height: 18px;
  border-radius: 999px;
  background: var(--zen-accent, #3b82f6);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.tb-task.tb-off {
  visibility: hidden;
} /* overflowed: kept in DOM for stable measurement */
.tb-ovf {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
}
.tb-ovf .mdi {
  color: var(--zen-muted, #9aa0aa);
}
.tb-ovf.on {
  border-color: var(--zen-accent, #3b82f6);
  color: var(--zen-accent, #3b82f6);
}
.tb-ovf.on .mdi {
  color: var(--zen-accent, #3b82f6);
}
/* Tasks read as a strip, not a row of boxes: no outline at rest, a soft fill on hover, and the
   focused one raised (the same mark as the active workspace tab). */
.tb-task {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  padding: 0 10px;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--zen-radius, 6px);
  color: var(--zen-text, #e5e5ea);
  font-size: 11px;
  font-family: inherit;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.tb-task:hover {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 8%, transparent);
}
.tb-task .mdi {
  font-size: 14px;
  color: var(--zen-accent, #3b82f6);
  flex: 0 0 auto;
}
.tb-task-lbl {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* minimized = dimmed; active (frontmost) = accent tint + an underline indicator */
.tb-task.min {
  opacity: 0.5;
}
.tb-task.min .mdi {
  color: var(--zen-muted, #9aa0aa);
}
/* The focused task / active workspace is a raised pill: a lighter neutral fill with a soft
   shadow, its icon in the accent colour — "this one" without adding colour or an underline. */
.tb-task.active,
.tb-ws-b.active {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 16%, var(--zen-bg, #15151a));
  /* An accent edge marks it as selected on every theme — a tint alone vanishes on neutral ones. */
  box-shadow:
    0 1px 2px rgb(0 0 0 / 45%),
    inset 0 0 0 1px color-mix(in srgb, var(--zen-accent, #6366f1) 55%, transparent);
}
/* running full-screen app chips — sit just after Start, never collapse into overflow */
.tb-app {
  flex: 0 0 auto;
  max-width: 220px;
}
.tb-app-x {
  font-size: 12px !important;
  color: var(--zen-muted, #9aa0aa) !important;
  margin-left: 2px;
  border-radius: 50%;
  opacity: 0;
  transition: opacity var(--zen-dur-fast, 0.12s);
}
.tb-app:hover .tb-app-x,
.tb-app.active .tb-app-x {
  opacity: 1;
}
.tb-app-x:hover {
  color: var(--zen-text, #e5e5ea) !important;
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 14%, transparent);
}
/* the full-screen glyph trailing an app row in the launcher */
.tb-appglyph {
  font-size: 13px !important;
  color: var(--zen-muted, #9aa0aa) !important;
  opacity: 0.55;
}

.tb-widgets {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
  height: 100%;
}
.tb-widgets:not(:empty) {
  border-left: 1px solid var(--zen-border, #3a3a44);
}

/* overflow list popup (open panels that didn't fit) */
.tb-ovfmenu {
  position: fixed;
  z-index: 100000;
  min-width: 200px;
  max-width: 320px;
  max-height: 60vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 5px;
  background: var(--zen-chrome-bg, var(--zen-surface, #202026));
  border: 1px solid var(--zen-surface-border, var(--zen-border, #3a3a44));
  border-radius: var(--zen-radius-surface, var(--zen-radius, 9px));
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
}
.tb-ovfitem {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: var(--zen-radius, 6px);
  color: var(--zen-text, #e5e5ea);
  font-size: 12px;
  font-family: inherit;
  padding: 6px 8px;
}
.tb-ovfitem:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
}
.tb-ovfitem.min {
  opacity: 0.55;
}
.tb-ovfitem .mdi {
  font-size: 14px;
  color: var(--zen-accent, #3b82f6);
  flex: 0 0 auto;
}
.tb-ovfitem-lbl {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* narrow window: the Comfy opener drops its label → icon only */
@media (max-width: 600px) {
  .tb-start-lbl {
    display: none;
  }
  .tb-start {
    padding: 0 10px;
  }
}

/* start menu */
.tb-menu {
  position: fixed;
  z-index: 100000;
  width: 360px;
  height: min(480px, 78vh);
  display: flex;
  flex-direction: column;
  background: var(--zen-chrome-bg, var(--zen-surface, #202026));
  border: 1px solid var(--zen-surface-border, var(--zen-border, #3a3a44));
  border-radius: var(--zen-radius-surface, var(--zen-radius, 10px));
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
  overflow: hidden;
  font-family: var(--p-font-family, system-ui, sans-serif);
  color: var(--zen-text, #e5e5ea);
}
.tb-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 11px;
  border-bottom: 1px solid var(--zen-border, #3a3a44);
}
.tb-search .mdi {
  color: var(--zen-muted, #9aa0aa);
  font-size: 16px;
}
.tb-search input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  color: inherit;
  font: inherit;
  font-size: 12px;
}
.tb-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tb-gtitle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--zen-muted, #9aa0aa);
  padding: 5px 4px 2px;
}
.tb-gtitle .mdi {
  font-size: 13px;
}
.tb-glogo {
  width: 14px;
  height: 14px;
  border-radius: var(--zen-radius, 4px);
  object-fit: cover;
}
.tb-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  cursor: pointer;
  background: none;
  border: 1px solid transparent;
  color: var(--zen-text, #e5e5ea);
  border-radius: max(0px, calc(var(--zen-radius, 8px) - 2px));
  padding: 7px 8px;
  font-size: 12px;
  font-family: inherit;
}
.tb-item:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 9%, transparent);
}
.tb-item .mdi {
  font-size: 15px;
  color: var(--zen-accent, #3b82f6);
}
.tb-item .dim {
  color: var(--zen-muted, #9aa0aa);
  font-size: 13px;
}
.tb-grow {
  flex: 1;
}
.tb-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: var(--zen-radius, 8px);
  background: color-mix(in srgb, var(--zen-accent, #3b82f6) 20%, transparent);
  color: var(--zen-accent, #3b82f6);
  font-size: 10px;
  font-weight: 700;
}
.tb-empty {
  padding: 18px 8px;
  text-align: center;
  color: var(--zen-muted, #9aa0aa);
  font-size: 12px;
}
/* footer: a single control line — left cluster (settings + absorbed ComfyUI buttons) and
   a right cluster (theme + mode) split via space-between. */
.tb-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 9px;
  border-top: 1px solid var(--zen-border, #3a3a44);
}
.tb-foot-l {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.tb-pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* Unified footer controls: boxed 30px icon buttons (Zen Settings, absorbed ComfyUI
   buttons, mode toggle) — same chrome as the taskbar tasks so the whole UI feels of a
   piece. Every icon is one of our own MDI glyphs (absorbed buttons map via iconFor()). */
.tb-fbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border: 1px solid var(--zen-control-border, var(--zen-border, #3a3a44));
  border-radius: var(--zen-radius, 7px);
  background: var(--zen-ghost-bg, var(--zen-bg, #15151a));
  color: var(--zen-muted, #9aa0aa);
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    background 0.12s ease,
    color 0.12s ease;
}
.tb-fbtn:hover {
  border-color: var(--zen-control-hover-border, var(--zen-accent, #3b82f6));
  background: var(--zen-control-hover-bg, var(--zen-control-bg));
  color: var(--zen-ghost-hover-text, var(--zen-accent, #3b82f6));
}
/* line-height:1 so the glyph centers in the box — without it the icon inherits ComfyUI's
   small line-height and sits ~1px high (covers absorbed pi/mdi icons too). */
.tb-fbtn i {
  font-size: 16px;
  line-height: 1;
}
.tb-fbtn:disabled {
  opacity: 0.4;
  cursor: default;
}
.tb-fbtn:disabled:hover {
  border-color: var(--zen-border, #3a3a44);
  color: var(--zen-muted, #9aa0aa);
}
/* theme cluster pinned right; selector is a fixed width (long names ellipsize rather than
   stretch the control), trigger fills that width and matches the 30px button height. */
.tb-theme {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}
.tb-themesel {
  flex: 0 0 132px;
  width: 132px;
  min-width: 0;
}
.tb-themesel :deep(.zs-trigger) {
  width: 100%;
  height: 30px;
  box-sizing: border-box;
}
.tb-item-lbl {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tb-pinbtn {
  font-size: 14px !important;
  color: var(--zen-muted, #9aa0aa) !important;
  opacity: 0;
}
.tb-item:hover .tb-pinbtn {
  opacity: 0.6;
}
.tb-pinbtn:hover {
  opacity: 1 !important;
}
.tb-pinbtn.on {
  opacity: 1;
  color: var(--zen-accent, #3b82f6) !important;
}
</style>

<style>
/* ComfyUI's canvas-controls group, reparented into the taskbar — global rule since it's
   foreign DOM. Strip its absolute positioning/chrome and shrink it to micro buttons. */
.zen-canvasctl {
  position: static !important;
  inset: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  z-index: auto !important;
  /* zoom (not transform: scale) so the layout box shrinks too — transform left the box
     full-size, which showed as massive empty padding + shoved the controls' position. */
  zoom: 0.78;
}
/* The new UI's shadow-beneath draws the panel's shadow on a ::before layer of its own (rounded,
   behind it), which the rules above don't reach: in the taskbar it showed as a rounded shadow. */
.zen-canvasctl::before,
.zen-canvasctl::after {
  display: none !important;
}
/* Workspace switcher: the graph, then a tab per workspace with its name and panel count, styled
   like the tasks (no box; the active one raised), set off by a divider. */
.tb-ws {
  display: inline-flex;
  flex: none;
  align-items: stretch;
  align-self: stretch;
  gap: 1px;
  box-sizing: border-box;
  margin: 0 4px 0 2px;
  padding: 2px 6px 2px 0;
  border-right: 1px solid var(--zen-border, #3a3a44);
}
.tb-ws-b {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--zen-radius, 6px);
  background: none;
  color: var(--zen-muted, #9aa0aa);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.tb-ws-b:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 8%, transparent);
  color: var(--zen-text, #e5e5ea);
}
.tb-ws-b.active {
  color: var(--zen-text, #e5e5ea);
}
.tb-ws-b .mdi {
  font-size: 14px;
}
.tb-ws-b.active .mdi {
  color: var(--zen-accent, #6366f1);
}
.tb-ws-b.add,
.tb-ws-b.more {
  min-width: 22px;
  padding: 0 4px;
}
.tb-ws-sep {
  align-self: center;
  width: 1px;
  height: 14px;
  margin: 0 4px;
  background: var(--zen-border, #3a3a44);
}
.tb-ws-pin {
  margin-left: -2px;
  font-size: 10px !important;
  color: var(--zen-muted, #9aa0aa);
  opacity: 0.8;
  transform: rotate(35deg);
}
.tb-ws-b.active .tb-ws-pin {
  color: var(--zen-accent, #6366f1);
}
.tb-ws-name {
  max-width: 96px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tb-ws-count {
  min-width: 14px;
  padding: 1px 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
  color: var(--zen-muted, #9aa0aa);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
@media (prefers-reduced-motion: reduce) {
  .tb-task,
  .tb-ws-b {
    transition: none;
  }
}
.tb-ws-b.editing {
  flex: none;
  cursor: text;
  box-shadow: inset 0 0 0 1px var(--zen-accent, #6366f1);
}
.tb-ws-b.editing.invalid {
  box-shadow: inset 0 0 0 1px var(--zen-danger, #dc2626);
}
/* In place of the label: same font and line, no box of its own, so the tab keeps its size. */
.tb-ws-rename {
  flex: none;
  box-sizing: content-box;
  min-width: 0;
  height: auto;
  margin: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: none;
  color: var(--zen-text, #e5e5ea);
  font: inherit;
  line-height: 1;
}
</style>
