// Hosts pinned panels in ComfyUI's native left sidebar: ONE native tab (own rail
// icon) per pinned panel, each filling the sidebar. Watches `inSidebar` panels and
// keeps tabs in sync; each renders the panel body (+ a pop-out button) via render(el, ctx).
import { watch } from 'vue'
import { app } from '@comfy/app'
import type { Panel, PanelStore } from './panelStore'
import type { ZenBus } from './bus'
import { zlog } from './log'

interface SidebarMgr {
  registerSidebarTab(tab: unknown): void
  unregisterSidebarTab(id: string): void
  toast?: { add?(o: unknown): void }
}

const TAB_PREFIX = 'zenkit-pin-'
const tabIdFor = (id: string) => TAB_PREFIX + id.replace(/[^a-z0-9]/gi, '-')

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
.zenkit-sidebar-tab { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--zen-text, #e5e5ea); font-family: var(--p-font-family, system-ui, sans-serif); }
.zk-sb-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-bottom: 1px solid var(--zen-border, #3a3a44); background: var(--zen-surface, #202026); }
.zk-sb-title { flex: 1; min-width: 0; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zk-sb-pop { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px solid var(--zen-border, #3a3a44); border-radius: var(--zen-radius, 6px); background: var(--zen-bg, #1a1a1f); color: var(--zen-muted, #9aa0aa); cursor: pointer; }
.zk-sb-pop:hover { border-color: var(--zen-accent, #3b82f6); color: var(--zen-accent, #3b82f6); }
.zk-sb-body { flex: 1 1 0; min-height: 0; }`

export function startSidebar(store: PanelStore, bus: ZenBus): void {
  const mgr = (app as unknown as { extensionManager?: SidebarMgr })?.extensionManager
  if (!mgr?.registerSidebarTab) return
  store.state.sidebarAvailable = true

  const styleEl = document.createElement('style')
  styleEl.id = 'zenkit-sidebar'
  styleEl.textContent = STYLE
  document.head.appendChild(styleEl)

  const tabs = new Map<string, { cleanup: (() => void) | null }>()

  function mount(p: Panel, container: HTMLElement, rec: { cleanup: (() => void) | null }) {
    container.classList.add('zenkit-sidebar-tab')
    const bar = document.createElement('div')
    bar.className = 'zk-sb-bar'
    const title = document.createElement('span')
    title.className = 'zk-sb-title'
    title.textContent = p.title
    const pop = document.createElement('button')
    pop.className = 'zk-sb-pop'
    pop.title = 'Pop out to a floating panel'
    pop.innerHTML = '<i class="mdi mdi-arrow-top-right-bold-box-outline"></i>'
    pop.onclick = () => store._ops.unpinSidebar(p.id)
    bar.append(title, pop)
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
      icon: p.icon || 'mdi mdi-application-outline',
      tooltip: p.title,
      type: 'custom',
      render: (container: HTMLElement) => {
        rec.cleanup?.()
        mount(p, container, rec)
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

  // Toast only on a user pin (restore re-registers silently).
  bus.on('panel:pinned', (payload) => {
    const id = (payload as { id?: string } | undefined)?.id
    const p = id ? store._ops.get(id) : null
    if (p)
      mgr.toast?.add?.({
        severity: 'info',
        summary: 'Pinned to sidebar',
        detail: `${p.title} — open it from the sidebar rail`,
        life: 3000,
      })
  })

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
