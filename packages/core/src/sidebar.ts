// Hosts pinned panels in ComfyUI's native left sidebar: ONE native tab (own rail
// icon) per pinned panel, each filling the sidebar. Watches `inSidebar` panels and
// keeps tabs in sync; each renders the panel body via render(el, ctx). A pinned panel comes back
// out like a docked one: drag its title bar, or its rail icon off the rail, and it floats.
import { nextTick, watch } from 'vue'
import { app } from '@comfy/app'
import { isIconUrl } from '@nynxz/zenkit-ui'
import { startDockTabDrag } from './dockDrag'
import { sidebarRail } from './dockDrop'
import type { Panel, PanelStore } from './panelStore'
import type { ZenBus } from './bus'
import { ensureStyle } from './dom'
import { zlog } from './log'

interface SidebarMgr {
  registerSidebarTab(tab: unknown): void
  unregisterSidebarTab(id: string): void
  sidebarTab?: {
    activeSidebarTabId: string | null
    sidebarTabs?: { id: string; icon?: unknown }[]
    moveTab?: (fromId: string, toId: string, edge: 'before' | 'after') => unknown
  }
}

const TAB_PREFIX = 'zenkit-pin-'
const tabIdFor = (id: string) => TAB_PREFIX + id.replace(/[^a-z0-9]/gi, '-')

// ComfyUI's rail takes an icon class, so an image-URL icon becomes a generated class that
// draws the image as a mask in the rail's current colour, like its own glyph icons.
function railIcon(icon?: string): string {
  if (!icon) return 'mdi mdi-application-outline'
  if (!isIconUrl(icon)) return icon
  let hash = 5381
  for (const ch of icon) hash = ((hash << 5) + hash + ch.charCodeAt(0)) >>> 0
  const cls = `zk-rail-icon-${hash.toString(36)}`
  const mask = `url(${JSON.stringify(icon)}) center / contain no-repeat`
  ensureStyle(
    cls,
    `.${cls}{display:inline-block;width:1em;height:1em;background-color:currentColor;` +
      `-webkit-mask:${mask};mask:${mask}}`,
  )
  return cls
}

// Put ComfyUI's native sidebar on a given side AND make it FLOAT over the canvas
// (Comfy.Sidebar.Style='floating') — so a pinned panel overlays the graph and the glass
// shows it (the 'connected' style is a splitter that pushes the graph aside = solid bg
// behind). Best-effort across ComfyUI setting-store API shapes.
function setComfySetting(id: string, value: unknown): void {
  try {
    const a = app as unknown as {
      extensionManager?: { setting?: { set?: (id: string, v: unknown) => void } }
      ui?: { settings?: { setSettingValue?: (id: string, v: unknown) => void } }
    }
    a.extensionManager?.setting?.set?.(id, value)
    a.ui?.settings?.setSettingValue?.(id, value)
  } catch {
    /* setting may be unavailable; the panel still pins to the current side/style */
  }
}
export function setSidebarLocation(side: 'left' | 'right'): void {
  setComfySetting('Comfy.Sidebar.Location', side)
  setComfySetting('Comfy.Sidebar.Style', 'floating')
}

const STYLE = `
.zenkit-sidebar-tab { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--zen-text, #e5e5ea); }
/* Matches ComfyUI's own sidebar tab header (SidebarTabTemplate), inheriting its font. */
.zk-sb-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 0 1rem; min-height: calc(var(--panel-header-inset, 0.5rem) * 2 + 2rem); cursor: grab; touch-action: none; border-bottom: 1px solid var(--color-interface-stroke, var(--zen-border, #3a3a44)); background: transparent; }
.zk-sb-title { flex: 1; min-width: 0; font-size: 1rem; font-weight: 700; color: var(--color-base-foreground, inherit); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zk-sb-body { flex: 1 1 0; min-height: 0; }
.zk-rail-drop { position: fixed; z-index: 100000; height: 2px; border-radius: 2px; pointer-events: none; background: var(--zen-accent, #3b82f6); }
.zk-rail-drag { position: fixed; z-index: 100001; pointer-events: none; opacity: .85; }
.zk-rail-dragging { opacity: .4; }
.zk-rail-reordering .p-tooltip { display: none !important; }`

export function startSidebar(store: PanelStore, bus: ZenBus): void {
  const mgr = (app as unknown as { extensionManager?: SidebarMgr })?.extensionManager
  if (!mgr?.registerSidebarTab) return
  store.state.sidebarAvailable = true

  const styleEl = document.createElement('style')
  styleEl.id = 'zenkit-sidebar'
  styleEl.textContent = STYLE
  document.head.appendChild(styleEl)

  const tabs = new Map<string, { cleanup: (() => void) | null }>()
  // ComfyUI can render the next custom tab into the element the previous one still fills
  // (switching between two custom tabs reuses the slot without destroying the old tab), so
  // whoever last rendered into a container is torn down before the next one mounts there.
  const occupant = new WeakMap<HTMLElement, { cleanup: (() => void) | null }>()

  function mount(p: Panel, container: HTMLElement, rec: { cleanup: (() => void) | null }) {
    container.classList.add('zenkit-sidebar-tab')
    const bar = document.createElement('div')
    bar.className = 'zk-sb-bar'
    const title = document.createElement('span')
    title.className = 'zk-sb-title'
    title.textContent = p.title
    bar.append(title)
    bar.title = 'Drag out to float this panel'
    bar.onpointerdown = (e) => startDockTabDrag(e, store, p.id, () => {})
    const body = document.createElement('div')
    body.className = 'zk-sb-body'
    container.append(bar, body)
    const ret = p.render(body, p.ctx)
    rec.cleanup = () => {
      if (typeof ret === 'function') {
        try {
          ret()
        } catch {
          /* a panel's own teardown shouldn't break the tab */
        }
      }
      container.replaceChildren()
    }
  }

  function register(p: Panel) {
    if (tabs.has(p.id)) return
    const rec: { cleanup: (() => void) | null } = { cleanup: null }
    tabs.set(p.id, rec)
    mgr!.registerSidebarTab({
      id: tabIdFor(p.id),
      title: p.title,
      icon: railIcon(p.icon),
      tooltip: p.title,
      type: 'custom',
      render: (container: HTMLElement) => {
        const previous = occupant.get(container)
        if (previous && previous !== rec) {
          previous.cleanup?.()
          previous.cleanup = null
        }
        rec.cleanup?.()
        container.replaceChildren()
        mount(p, container, rec)
        occupant.set(container, rec)
      },
      destroy: () => {
        rec.cleanup?.()
        rec.cleanup = null
      },
    })
    zlog(`pinned "${p.id}" to the sidebar`)
  }

  function unregister(id: string) {
    const rec = tabs.get(id)
    if (!rec) return
    rec.cleanup?.()
    tabs.delete(id)
    try {
      mgr!.unregisterSidebarTab(tabIdFor(id))
    } catch {
      /* already gone */
    }
  }

  // A user pin opens the new tab, so the panel stays in view in its new home (restore
  // re-registers silently), and revealing a pinned panel switches the sidebar to it. The tab
  // registers in the watcher below, after a pin event.
  const showTab = (payload: unknown) => {
    const id = (payload as { id?: string } | undefined)?.id
    if (!id || !store._ops.get(id)) return
    void nextTick(() => {
      const sidebar = mgr.sidebarTab
      if (sidebar) sidebar.activeSidebarTabId = tabIdFor(id)
    })
  }
  bus.on('panel:pinned', showTab)
  bus.on('panel:reveal', showTab)

  // A panel can change its icon while pinned (ZenStash shows the active server's favicon).
  // Update the registered tab through ComfyUI's reactive store so the panel isn't remounted.
  watch(
    () =>
      store.state.list
        .filter((p) => p.inSidebar)
        .map((p) => `${p.id}=${p.icon ?? ''}`)
        .join('|'),
    () => {
      for (const p of store.state.list) {
        if (!p.inSidebar) continue
        const tab = mgr.sidebarTab?.sidebarTabs?.find((t) => t.id === tabIdFor(p.id))
        const icon = railIcon(p.icon)
        if (tab && tab.icon !== icon) tab.icon = icon
      }
    },
  )

  startRailIconDrag(store, mgr, (tabId) => [...tabs.keys()].find((id) => tabIdFor(id) === tabId))

  watch(
    () =>
      store.state.list
        .filter((p) => p.inSidebar)
        .map((p) => p.id)
        .join('|'),
    () => {
      const want = new Set(store.state.list.filter((p) => p.inSidebar).map((p) => p.id))
      for (const p of store.state.list) if (p.inSidebar) register(p)
      for (const id of [...tabs.keys()]) if (!want.has(id)) unregister(id)
    },
    { immediate: true },
  )
}


// A pinned panel's rail icon drags like a dock tab: within the rail it reorders (through the
// rail's own moveTab, where the frontend has one), and off the rail the panel comes out and
// follows the pointer. The rail's native drag-and-drop is cancelled for these icons so the
// pointer drag owns the gesture.
const RAIL_OUT = 24 // px past the rail's edge before the panel comes out

function startRailIconDrag(
  store: PanelStore,
  mgr: SidebarMgr,
  panelForTab: (tabId: string) => string | undefined,
) {
  const tabOf = (target: EventTarget | null) =>
    (target as Element | null)?.closest?.<HTMLElement>(`[data-rail-item-id^="${TAB_PREFIX}"]`)
  document.addEventListener('dragstart', (e) => tabOf(e.target) && e.preventDefault(), true)
  document.addEventListener(
    'pointerdown',
    (e) => {
      const item = tabOf(e.target)
      const fromId = item?.dataset.railItemId
      const id = fromId && panelForTab(fromId)
      if (!item || !fromId || !id) return
      const rail = () => sidebarRail()?.getBoundingClientRect()
      let line: HTMLDivElement | null = null
      let clone: HTMLElement | null = null
      const grab = (() => {
        const r = item.getBoundingClientRect()
        return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }
      })()
      // The gap nearest the pointer, between the rail's items, as a moveTab target.
      const slot = (y: number) => {
        const items = [
          ...(sidebarRail()?.querySelectorAll<HTMLElement>('[data-rail-item-id]') ?? []),
        ]
        const rects = items.map((el) => el.getBoundingClientRect())
        const index = rects.findIndex((r) => y < r.top + r.height / 2)
        const at = index === -1 ? items.length : index
        const target =
          at < items.length
            ? { toId: items[at]!.dataset.railItemId!, edge: 'before' as const }
            : { toId: items[items.length - 1]!.dataset.railItemId!, edge: 'after' as const }
        const edgeY = at < rects.length ? rects[at]!.top : rects[rects.length - 1]!.bottom
        const from = items.findIndex((el) => el.dataset.railItemId === fromId)
        const noop = at === from || at === from + 1
        return { ...target, noop, edgeY, left: rects[0]?.left ?? 0, width: rects[0]?.width ?? 0 }
      }
      startDockTabDrag(e, store, id, () => {}, {
        active: (x) => {
          const r = rail()
          return !!r && x <= r.right + RAIL_OUT
        },
        move: (x, y) => {
          if (!mgr.sidebarTab?.moveTab) return
          // A copy of the icon follows the pointer while the original fades, like the rail's
          // own drag, and the line marks where it will land.
          if (!clone) {
            clone = item.cloneNode(true) as HTMLElement
            // The copy must not count as a rail item, or the slot math would follow it.
            clone.removeAttribute('data-rail-item-id')
            for (const el of clone.querySelectorAll('[data-testid]')) el.removeAttribute('data-testid')
            clone.classList.add('zk-rail-drag')
            clone.style.width = `${grab.w}px`
            document.body.append(clone)
            item.classList.add('zk-rail-dragging')
            document.body.classList.add('zk-rail-reordering')
          }
          Object.assign(clone.style, { left: `${x - grab.x}px`, top: `${y - grab.y}px` })
          const s = slot(y)
          line ??= document.body.appendChild(document.createElement('div'))
          line.className = 'zk-rail-drop'
          Object.assign(line.style, {
            display: s.noop ? 'none' : '',
            left: `${s.left + 4}px`,
            top: `${s.edgeY - 1}px`,
            width: `${Math.max(0, s.width - 8)}px`,
          })
        },
        end: () => {
          line?.remove()
          clone?.remove()
          line = clone = null
          item.classList.remove('zk-rail-dragging')
          document.body.classList.remove('zk-rail-reordering')
        },
        release: (_x, y) => {
          const { toId, edge, noop } = slot(y)
          if (!noop) void mgr.sidebarTab?.moveTab?.(fromId, toId, edge)
        },
      })
    },
    true,
  )
}
