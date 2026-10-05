// ZenKit runtime orchestrator. installZenKit() wires the store + theme + host
// overlay and installs window.ZenKit. (jobs/channels/finder/sidebar deferred.)
import { createApp, watch } from 'vue'
import { registerPacks } from '@nynxz/zenkit-theme'
import type { ZenKitApi, PanelHandle, PanelContext } from './types'
import { createBus, type ZenBus } from './bus'
import { ensureStyle, removeStyle } from './dom'
import { theme } from './theme'
import { startComfyThemeBridge } from './comfyTheme'
import { createComfyThemeMenu } from './comfyThemeMenu'
import { syncThemeSplash } from './themeSplash'
import { createPanelStore, STORE_KEY, type PanelStore } from './panelStore'
import { createAppStore, APP_STORE_KEY, type AppStore } from './appStore'
import { setStatsPinned, startTiling } from './tiling'
import { activate, attachWorkspaces, toggleWorkspace, workspacesApi, ws } from './workspaces'
import { startSidebar } from './sidebar'
import { CANVAS_CONTROLS_WIDGET, registerTaskbarWidget } from './taskbarWidgets'
import { createStorage } from './storage'
import { startBackground, backgrounds } from './background'
import { startSidebarPin } from './sidebarPin'
import { startGroups } from './groups'
import { createChannels } from './channels'
import { createJobs } from './jobs'
import { createPlugins } from './pluginRegistry'
import { createGraph } from './graph'
import { createCapabilities } from './capabilities'
import { registerCoreCapabilities } from './coreCapabilities'
import { registerWorkflowCapabilities } from './workflowCapabilities'
import { createMedia } from './media'
import { createViewer } from './viewer'
import { createChrome } from './chrome'
import ZenHost from './components/ZenHost.vue'
import ZenJobsWidget from './components/ZenJobsWidget.vue'
import ZenRunWidget from './components/ZenRunWidget.vue'
import ZenSettings from './components/ZenSettings.vue'
// ZenKit's own family tile (docs/assets/render/brand.mjs) — the "core" row in Zen Settings.
import zenkitLogo from './brand/zenkit.svg'

// The runtime's version is core's package version, so it can't drift from what ships.
import { version as ZENKIT_VERSION } from '../package.json'

export { ZENKIT_VERSION }

export interface InstallOptions {
  /** Theme packs to register (JSON loaded by the host). */
  themes?: unknown[]
  /** Taskbar Start-button branding. `logo` is an image URL/data URI or an MDI class; a local
   *  override from Zen Settings wins over it. */
  branding?: { logo?: string; title?: string }
}

function semverSatisfies(version: string, range: string): boolean {
  const v = version.split('.').map(Number)
  const r = (range || '').trim()
  const cmp = (a: number[], b: number[]) =>
    a[0]! - b[0]! || (a[1] || 0) - (b[1] || 0) || (a[2] || 0) - (b[2] || 0)
  if (r.startsWith('^')) {
    const b = r.slice(1).split('.').map(Number)
    return v[0] === b[0] && cmp(v, b) >= 0
  }
  if (r.startsWith('>=')) {
    const b = r.slice(2).trim().split('.').map(Number)
    return cmp(v, b) >= 0
  }
  return version === r
}

let installed: ZenKitApi | null = null
let theStore: PanelStore | null = null
let theAppStore: AppStore | null = null

export function installZenKit(opts: InstallOptions = {}): ZenKitApi {
  if (installed) return installed
  if (opts.themes?.length) registerPacks(opts.themes)

  const bus = createBus()
  theme.init()
  const store = createPanelStore(bus)
  const appStore = createAppStore(bus)
  theStore = store
  theAppStore = appStore
  if (opts.branding) store.setBranding(opts.branding)
  attachWorkspaces(store, appStore)
  installWorkspaceKeys()
  startTiling(store)
  startSidebar(store, bus) // host pinned panels in ComfyUI's native sidebar (no-op if unavailable)

  // Built-in widget: progress for running jobs (invisible while there are none).
  registerTaskbarWidget({
    id: 'zenkit:jobs',
    label: 'Jobs',
    icon: 'mdi mdi-progress-clock',
    order: 90,
    defaultOn: true,
    render: (el) => {
      const widget = createApp(ZenJobsWidget)
      widget.mount(el)
      return () => widget.unmount()
    },
  })

  // Built-in widget: Run / Stop, shown while a workspace or an app covers ComfyUI's action bar.
  registerTaskbarWidget({
    id: 'zenkit:run',
    label: 'Run (when the graph is covered)',
    icon: 'mdi mdi-play',
    order: 80,
    defaultOn: true,
    render: (el) => {
      const widget = createApp(ZenRunWidget, { appStore })
      widget.mount(el)
      return () => widget.unmount()
    },
  })

  // Built-in widget: the hide-all-panels toggle.
  registerTaskbarWidget({
    id: 'zenkit:hide-panels',
    label: 'Hide panels',
    icon: 'mdi mdi-eye-outline',
    order: 100,
    defaultOn: true,
    render: (el) => {
      const btn = document.createElement('button')
      btn.style.cssText =
        'display:inline-flex;align-items:center;justify-content:center;width:28px;height:24px;padding:0;background:none;border:none;border-radius:var(--zen-radius,6px);cursor:pointer;font-size:16px;'
      el.appendChild(btn)
      const sync = () => {
        const h = store.state.panelsHidden
        btn.innerHTML = `<i class="mdi ${h ? 'mdi-eye-off-outline' : 'mdi-eye-outline'}"></i>`
        btn.style.color = h ? 'var(--zen-accent, #3b82f6)' : 'var(--zen-muted, #9aa0aa)'
        btn.title = h ? 'Show panels' : 'Hide all panels'
      }
      btn.addEventListener(
        'mouseenter',
        () => (btn.style.background = 'color-mix(in srgb, var(--zen-text, #fff) 12%, transparent)'),
      )
      btn.addEventListener('mouseleave', () => (btn.style.background = 'none'))
      btn.addEventListener('click', () => (store.state.panelsHidden = !store.state.panelsHidden))
      sync()
      return watch(() => store.state.panelsHidden, sync)
    },
  })

  // Built-in widget: ComfyUI's bottom-right canvas controls, reparented into the taskbar.
  registerTaskbarWidget({
    id: CANVAS_CONTROLS_WIDGET,
    label: 'Canvas controls',
    icon: 'mdi mdi-tune-variant',
    order: 110,
    defaultOn: true,
    render: (el) => {
      // Found by its buttons' test ids (stable across ComfyUI layout changes), not its classes.
      const SEL = '[role="toolbar"]:has([data-testid="zoom-controls-button"])'
      let ctl: HTMLElement | null = null
      let parent: Node | null = null
      let next: Node | null = null
      const dock = () => {
        if (!theme.comfyRestyle()) return
        const c = document.querySelector(SEL) as HTMLElement | null
        if (!c || el.contains(c)) return
        parent = c.parentNode
        next = c.nextSibling
        c.classList.add('zen-canvasctl')
        el.appendChild(c)
        ctl = c
      }
      const undock = () => {
        if (!ctl) return
        ctl.classList.remove('zen-canvasctl')
        if (parent) parent.insertBefore(ctl, next)
        ctl = parent = next = null
      }
      const styleId = 'zenkit-canvasctl-style'
      const applyRestyle = (on: boolean) => {
        setStatsPinned(on)
        if (!on) {
          undock()
          removeStyle(styleId)
          return
        }
        ensureStyle(
          styleId,
          `.minimap-main-container{bottom:0!important}${SEL}:not(.zen-canvasctl){display:none!important}`,
        )
        dock()
      }
      applyRestyle(theme.comfyRestyle())
      const offRestyle = theme.onComfyRestyleChange(applyRestyle)
      const retries = [150, 400, 900, 1800, 3000].map((t) =>
        window.setTimeout(() => {
          if (!ctl || !ctl.isConnected || !el.contains(ctl)) dock()
        }, t),
      )
      let pending = false
      const obs = new MutationObserver(() => {
        if (pending) return
        pending = true
        requestAnimationFrame(() => {
          pending = false
          if (!ctl || !ctl.isConnected || !el.contains(ctl)) dock()
        })
      })
      obs.observe(document.body, { childList: true, subtree: true })
      return () => {
        setStatsPinned(false)
        offRestyle()
        retries.forEach((t) => clearTimeout(t))
        obs.disconnect()
        undock()
        removeStyle(styleId)
      }
    },
  })

  // Host overlay injected into body (renders panels + docks + the taskbar).
  const hostEl = document.createElement('div')
  hostEl.id = 'zenkit-host'
  document.body.appendChild(hostEl)
  const hostApp = createApp(ZenHost)
  hostApp.provide(STORE_KEY, store)
  hostApp.provide(APP_STORE_KEY, appStore)
  hostApp.mount(hostEl)

  // Keep ComfyUI's native dialogs / context menus / toasts ABOVE the ZenKit panel
  // overlay (z 1500), so a panel never covers a native modal. (ZenKit's own
  // teleported menus sit at 100000, above these — they're transient.)
  ensureStyle(
    'zenkit-native-overlay-z',
    '.p-dialog-mask,.p-overlay-mask,.comfy-modal,.p-contextmenu,.p-tieredmenu,.p-menu.p-component,.p-toast,.p-confirmdialog,.p-confirmpopup{z-index:2000!important}',
  )

  startBackground() // themed canvas grid behind the node graph
  startSidebarPin() // keep ComfyUI's sidebar at a fixed px width when docks resize the graph
  startGroups() // themed (rounded) node groups; native drag/resize left untouched

  // Sync ZenKit theme switches with ComfyUI + comfyui-desktop (native titlebar / .dark-theme),
  // and mirror ComfyUI's own theme menu back into ZenKit. Always on — it's the robust bridge.
  startComfyThemeBridge()
  // Experimental: inject a ZenKit theme block into ComfyUI's logo→Theme menu, toggleable from
  // Zen Settings (the store flag persists; start/stop tracks it, applied immediately on boot).
  // The startup splash follows the theme (and its light/dark mode) from the next load.
  theme.onChange(() => syncThemeSplash(store.state.themedSplash))
  watch(
    () => store.state.themedSplash,
    (on) => syncThemeSplash(on),
    { immediate: true },
  )

  const comfyThemeMenu = createComfyThemeMenu()
  watch(
    () => store.state.comfyThemeMenu,
    (on) => (on ? comfyThemeMenu.start() : comfyThemeMenu.stop()),
    { immediate: true },
  )

  const api = buildApi(store, appStore, bus)
  // Hidden registration so Zen Settings restores at its saved place on reload.
  store.register({
    id: 'zenkit:settings',
    title: 'Zen Settings',
    icon: 'mdi mdi-cog-outline',
    logo: zenkitLogo,
    spawnOnly: true,
    open: () => openZenSettings()!,
  })
  window.dispatchEvent(new CustomEvent('zen:ready'))
  return api
}

// Build window.ZenKit (the public API) over a store + bus. Shared by the full runtime and
// the detached-window runtime so both expose the exact same surface — crucially including
// live channels, so a popped-out Media Viewer keeps syncing.
function buildApi(store: PanelStore, appStore: AppStore, bus: ZenBus): ZenKitApi {
  let resolveReady!: (a: ZenKitApi) => void
  const ready = new Promise<ZenKitApi>((r) => (resolveReady = r))

  const jobs = createJobs(bus)
  const media = createMedia()
  const channels = createChannels(bus, media)

  const api: ZenKitApi = {
    version: ZENKIT_VERSION,
    ready,
    require: (range) => semverSatisfies(ZENKIT_VERSION, range),
    panels: {
      open: store.open,
      close: (id, opts) => store.close(id, opts),
      get: store.get,
      list: store.list,
      instances: store.instances,
      register: store.register,
      registered: store.registered,
    },
    theme: {
      tokens: theme.tokens,
      packs: () => theme.packs(),
      packLabel: (id) => theme.packLabel(id),
      packModes: (id) => theme.packModes(id),
      setPack: (n) => theme.setPack(n),
      current: () => theme.current(),
      currentMode: () => theme.currentMode(),
      setMode: (m) => theme.setMode(m),
      onChange: (cb) => theme.onChange(cb),
      registerPack: (p) => theme.registerPack(p),
    },
    bus,
    jobs: { list: jobs.list, get: jobs.get, on: jobs.on, start: jobs.start },
    channels: {
      publish: channels.publish,
      declare: channels.declare,
      get: channels.get,
      last: channels.last,
      list: channels.list,
      subscribe: channels.subscribe,
    },
    plugins: createPlugins(bus),
    taskbar: { register: registerTaskbarWidget },
    storage: createStorage(),
    background: backgrounds,
    graph: createGraph(),
    viewer: createViewer(),
    capabilities: createCapabilities(bus),
    media,
    apps: {
      register: appStore.register,
      registered: appStore.registered,
      open: appStore.open,
      close: appStore.close,
      // `close` drops to the graph but the taskbar keeps the app as minimized; `restore` goes
      // back to the route you left, which is what clicking its chip does.
      restore: appStore.restore,
      minimized: appStore.minimized,
      current: appStore.current,
      navigate: appStore.navigate,
      back: appStore.back,
      forward: appStore.forward,
      location: appStore.location,
      on: appStore.on,
    },
    chrome: createChrome(store, appStore),
    branding: {
      get: () => ({ ...store.state.branding }),
      set: (b) => store.setBranding(b),
    },
    workspaces: workspacesApi(),
    docks: {
      get: (side) => store.dockState(side),
      set: (side, patch) => store.setDockState(side, patch),
    },
  }

  installed = api
  window.ZenKit = api
  registerCoreCapabilities(api)
  registerWorkflowCapabilities(api)
  resolveReady(api)
  return api
}

/**
 * Detached-panel runtime. The page was opened with `?zen-panel=<registrationId>` (see
 * detach.ts) — boot a minimal ZenKit (no taskbar / host overlay / background) and mount
 * JUST that panel fullscreen, so the popped-out OS/browser window shows the panel
 * maximized instead of a second copy of the whole ComfyUI UI. window.ZenKit is still
 * installed, so the panel's live wiring (channels, theme, storage) works as if docked.
 */
export function installZenKitSecondary(panelId: string, opts: InstallOptions = {}): ZenKitApi {
  if (installed) return installed
  if (opts.themes?.length) registerPacks(opts.themes)
  const bus = createBus()
  theme.init()
  const store = createPanelStore(bus)
  const appStore = createAppStore(bus)
  theStore = store
  const api = buildApi(store, appStore, bus)

  // Fullscreen mount host, shaped EXACTLY like a docked/floating panel so every panel
  // renders identically — not just ones that happen to use height:100%. A panel's content
  // normally mounts into ZenPanel's `.body` (a sized flex child: `flex:1 1 0; min-height:0`)
  // inside the flex-column `.zp`. A panel built to fill that flex child collapses to zero
  // height in a bare div — which is why only self-sizing panels (Media Viewer) survived. We
  // recreate that exact box here: a flex-column `host` + a sized flex-child `body`.
  const host = document.createElement('div')
  host.id = 'zenkit-secondary'
  host.style.cssText =
    'position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;overflow:hidden;background:var(--zen-bg, #1a1a1f);'
  document.body.appendChild(host)
  const body = document.createElement('div')
  body.className = 'zen-secondary-body'
  body.style.cssText = 'flex:1 1 0;min-width:0;min-height:0;overflow:hidden;position:relative;'
  host.appendChild(body)

  // No in-window close button — the popped-out window has its own OS/browser chrome to
  // close it, and a floating button only overlapped panel content.

  // Give the panel the same per-instance content state it has when docked — read/written
  // under the store's own localStorage key — so a popped-out Notes shows the same content
  // and keeps saving. (Singleton id == registration id; a multi panel shares one key.)
  const STATE_LS = 'zenkit.panelstate.v1'
  const readStates = (): Record<string, unknown> => {
    try {
      return JSON.parse(localStorage.getItem(STATE_LS) || '{}') || {}
    } catch {
      return {}
    }
  }
  const ctx: PanelContext = {
    id: panelId,
    state: readStates()[panelId],
    expose: () => () => {},
    setState: (s) => {
      try {
        const all = readStates()
        all[panelId] = s
        localStorage.setItem(STATE_LS, JSON.stringify(all))
      } catch {
        /* quota / serialization — best effort */
      }
    },
  }

  const reveal = () => document.getElementById('zen-secondary-cover')?.remove()
  // The message names the panel id from the URL, so it is set as text, never as HTML.
  const fail = (msg: string) => {
    reveal()
    const note = document.createElement('div')
    note.style.cssText =
      'padding:24px;font:13px system-ui,sans-serif;color:var(--zen-muted,#9aa0aa)'
    note.textContent = msg
    body.replaceChildren(note)
  }

  // Mount the requested panel as soon as its consumer plugin registers it (the full
  // ComfyUI frontend still boots in this window, so registrations arrive normally).
  let mounted = false
  const tryMount = () => {
    if (mounted) return
    const reg = store.registered().find((r) => r.id === panelId)
    if (!reg) return
    // Resolve a render fn (+ ctx). Preferred: the registration carries `render`
    // (registerZenPlugin / a ZenPanelDef). Fallback: the panel defines its render INSIDE
    // open() — common in hand-written plugins — so open it (invisible here, there's no
    // host overlay) and reuse the live panel's render + its real persisted ctx.
    let render = reg.render
    let mountCtx: PanelContext = ctx
    if (!render) {
      try {
        reg.open()
      } catch (e) {
        console.error('[ZenKit] secondary open() failed for', panelId, e)
      }
      const p =
        store.state.list.find((x) => x.id === panelId) ??
        store.state.list.find((x) => x.instanceOf === panelId)
      if (p?.render) {
        render = p.render
        mountCtx = p.ctx
      }
    }
    if (!render) return
    mounted = true
    try {
      render(body, mountCtx)
      reveal() // boot done — reveal the panel
    } catch (e) {
      console.error('[ZenKit] secondary mount failed for', panelId, e)
      fail(`Couldn't open “${panelId}” in this window.`)
    }
  }
  tryMount()
  if (!mounted) {
    bus.on('registry:change', tryMount)
    // Don't leave the loading cover up forever if the panel never registers here
    // (wrong id, or its plugin isn't installed in this ComfyUI).
    window.setTimeout(() => {
      if (!mounted) fail(`Panel “${panelId}” isn't available in this window.`)
    }, 8000)
  }

  window.dispatchEvent(new CustomEvent('zen:ready'))
  return api
}

/** Open the Zen Settings control center (plugins, logs, prefs). */
export function openZenSettings(): PanelHandle | undefined {
  if (!installed || !theStore) return
  return installed.panels.open({
    id: 'zenkit:settings',
    title: 'Zen Settings',
    icon: 'mdi mdi-cog-outline',
    width: 460,
    height: 560,
    minWidth: 320,
    minHeight: 320,
    render(el) {
      const a = createApp(ZenSettings)
      a.provide(STORE_KEY, theStore!)
      a.provide(APP_STORE_KEY, theAppStore!)
      a.mount(el)
      return () => a.unmount()
    },
  })
}

/** Toggle "hide all panels" — same as the taskbar eye. */
export function toggleZenPanels(): void {
  if (theStore) theStore.state.panelsHidden = !theStore.state.panelsHidden
}

/** Alt+` flips between the graph and the last workspace; Alt+1–9 go straight to a workspace. */
function installWorkspaceKeys() {
  window.addEventListener(
    'keydown',
    (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.code === 'Backquote') {
        e.preventDefault()
        e.stopPropagation()
        toggleWorkspace()
        return
      }
      const n = /^Digit([1-9])$/.exec(e.code)?.[1]
      const target = n ? ws.list[Number(n) - 1] : undefined
      if (!target) return
      e.preventDefault()
      e.stopPropagation()
      activate(ws.active === target.id ? null : target.id)
    },
    true,
  )
}
