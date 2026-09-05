// @nynxz/zenkit-client — typed SDK for window.ZenKit; self-contained, no-ops when ZenKit is absent.
// The ZenKit contract lives here now (folded in from the old @nynxz/zenkit-types) — consumers
// import every ZenKit type from @nynxz/zenkit-client.
export * from '@nynxz/zenkit-types'
import type {
  AppHandle,
  AppLocation,
  AppRegistration,
  BusHandler,
  ChannelImage,
  ChannelInput,
  Job,
  PanelHandle,
  PanelRegistration,
  PanelSpec,
  RegisteredPlugin,
  SlotMatch,
  SlotMiddleClickCtx,
  TaskbarWidget,
  ThemePack,
  ViewerHandle,
  ViewerItem,
  ZenBackground,
  ZenKitApi,
} from '@nynxz/zenkit-types'

// Styled console badge so ZenKit logs are easy to spot.
const BADGE_INFO = 'background:#3b82f6;color:#fff;border-radius:3px;padding:1px 6px;font-weight:700'
const BADGE_WARN = 'background:#b45309;color:#fff;border-radius:3px;padding:1px 6px;font-weight:700'
function zlog(msg: string, ...a: unknown[]): void {
  console.info('%cZenKit%c ' + msg, BADGE_INFO, 'color:inherit', ...a)
}
function zwarn(msg: string, ...a: unknown[]): void {
  console.warn('%cZenKit%c ' + msg, BADGE_WARN, 'color:inherit', ...a)
}

/** URL for ZenKit's cached thumbnail service. Requires ZenKit installed (404s otherwise). */
export function thumbUrl(
  ref: { type?: string; filename: string; subfolder?: string },
  size = 256,
): string {
  const q = new URLSearchParams({
    type: ref.type || 'output',
    filename: ref.filename,
    subfolder: ref.subfolder || '',
    size: String(size),
  })
  return `/zenkit/thumb?${q.toString()}`
}

/** The special channel name for "whatever was published most recently". */
export const LAST_CHANNEL = '$last'

/** The ZenKit runtime if installed, else null. */
export function getZenKit(): ZenKitApi | null {
  return (typeof window !== 'undefined' && window.ZenKit) || null
}

export function hasZenKit(): boolean {
  return getZenKit() != null
}

/** ms to wait for ZenKit before deciding it's absent (load order is handled by whenZen). */
export const ZEN_CONNECT_TIMEOUT = 6000

/** Resolve ZenKit when ready, or null after `timeout` ms if it never loads (either load order). */
export function whenZen(timeout = ZEN_CONNECT_TIMEOUT): Promise<ZenKitApi | null> {
  const now = getZenKit()
  if (now) return now.ready ?? Promise.resolve(now)
  if (typeof window === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    let done = false
    const finish = (v: ZenKitApi | null) => {
      if (done) return
      done = true
      window.removeEventListener('zen:ready', onReady)
      if (!v) warnAbsentOnce()
      resolve(v)
    }
    const onReady = () => finish(getZenKit())
    window.addEventListener('zen:ready', onReady)
    setTimeout(() => finish(getZenKit()), timeout)
  })
}

let _warnedAbsent = false
function warnAbsentOnce(): void {
  if (_warnedAbsent) return
  _warnedAbsent = true
  zwarn(
    'runtime not detected — ZenKit-integrated panels will use their fallback UI. Install ComfyUI-ZenKit for the full experience.',
  )
}

/** Open a panel if ZenKit is present, else null. */
export async function openPanel(spec: PanelSpec): Promise<PanelHandle | null> {
  const zen = await whenZen()
  return zen ? zen.panels.open(spec) : null
}

/** Register a reusable panel (shows in the ZenBar) if ZenKit is present. Returns
 *  an unregister fn, or a no-op when ZenKit is absent. */
export async function registerPanel(reg: PanelRegistration): Promise<() => void> {
  const zen = await whenZen()
  return zen ? zen.panels.register(reg) : () => {}
}

/** Register a full-screen app (shows in the ZenBar launcher) if ZenKit is present.
 *  Returns an unregister fn, or a no-op when ZenKit is absent. */
export async function registerZenApp(reg: AppRegistration): Promise<() => void> {
  const zen = await whenZen()
  return zen ? zen.apps.register(reg) : () => {}
}

/** One app a plugin contributes — an {@link AppRegistration} minus the fields the plugin
 *  supplies (`plugin` / `logo` / `version`), mirroring how {@link ZenPanelDef} relates to a
 *  panel registration. */
export type ZenAppDef = Omit<AppRegistration, 'plugin' | 'namespace' | 'logo' | 'version'>

/** One panel a plugin contributes — a panel spec plus ZenBar capability flags. */
export interface ZenPanelDef extends Omit<PanelSpec, 'id' | 'instanceOf'> {
  id: string
  /** Allow multiple live instances (ZenBar shows open-new + an instance list). */
  multi?: boolean
  /** Hide from the ZenBar; opened only programmatically (popup/action-spawned). */
  spawnOnly?: boolean
  /** Icon for the sidebar-tab fallback when ZenKit is absent (defaults to `icon`). */
  sidebarIcon?: string
  /** Escape hatch: fully custom open (gets the live ZenKit + the instance id). */
  open?: (zen: ZenKitApi, instanceId?: string) => PanelHandle
}

/** A plugin's whole ZenKit integration — the single registration point. One call wires up
 *  every client surface (panels, apps, taskbar widgets, themes, backgrounds,
 *  channels, slot-links, node-widget views), reports the plugin to the introspection registry
 *  (so the Zen Inspector can see it), and handles graceful fallback when ZenKit is absent.
 *  Passed to {@link registerZenPlugin}. */
export interface ZenPluginDef {
  /** Canonical kebab id — the single identity that derives the app `namespace`, the `<id>:`
   *  panel-id prefix (for short panel ids), and joins this plugin's client surfaces to its
   *  Python nodes/routes in the Inspector. Defaults to a slug of `plugin` ("ZenSuite" →
   *  "zensuite"). Set it (and the matching `[tool.zenkit] id` in pyproject.toml) to pin a
   *  stable identity across both runtimes. */
  id?: string
  /** Display/group name shown in the ZenBar. */
  plugin: string
  /** Route namespace for this plugin's apps — each app's routing key becomes
   *  '<namespace>/<id>'. Defaults to `id` (a slug of `plugin`). Set it explicitly to pin a
   *  stable, clean namespace (recommended: a `zen*` name). */
  namespace?: string
  logo?: string
  /** Plugin version (e.g. "0.3.1") — surfaced in Zen Settings + the Inspector. */
  version?: string
  /** One-line description (shown in the Inspector). */
  description?: string
  /** Panels this plugin contributes (floating/docking windows). A short panel id (no ':')
   *  is auto-prefixed to `<id>:<panelId>`; an id that already has a ':' is left as-is. */
  panels?: ZenPanelDef[]
  /** Full-screen apps this plugin contributes (each a route namespace; covers the graph). */
  apps?: ZenAppDef[]
  /** Permanent-taskbar widgets (orderable/toggleable in Zen Settings). */
  taskbarWidgets?: TaskbarWidget[]
  /** Theme packs to register (semantic token packs; data, not code). */
  themes?: ThemePack[]
  /** Canvas backgrounds rendered behind the node graph (register only; activate via the API). */
  backgrounds?: ZenBackground[]
  /** Channels to declare up front on the named media bus (so they're listed before any
   *  publish). A bare name, or `{ name, label }`. */
  channels?: (string | { name: string; label?: string })[]
  /** Canvas slot-link compositions: middle-click the matched slot → spawn + wire the node. */
  slotLinks?: { on: SlotMatch; spawn: string }[]
  /** Node-widget renderers, keyed by widget `type` — registered cross-bundle so any node's
   *  matching widget renders through it. */
  widgetViews?: Record<string, WidgetView>
  /** Imperative escape hatch for anything the declarative surfaces don't cover. Runs once
   *  ZenKit is ready, with the live API + this plugin's resolved identity; return a cleanup. */
  setup?: (zen: ZenKitApi, plugin: { id: string; namespace: string }) => void | (() => void)
  /** ComfyUI's `app` (from '@comfy/app') — only needed when `sidebarFallback` is on,
   *  to register the sidebar tabs. */
  app?: unknown
  /** When ZenKit is absent, register ComfyUI sidebar tabs for the panels (needs
   *  `app`). OFF by default — ZenKit's ZenBar is the launcher, and we don't clutter
   *  ComfyUI's sidebar otherwise. Ignored if `fallback` is given. */
  sidebarFallback?: boolean
  /** Custom fallback when ZenKit is absent (e.g. your own floating panel). Takes
   *  precedence over `sidebarFallback`. */
  fallback?: () => void
  /** ms to wait for ZenKit before falling back (default {@link ZEN_CONNECT_TIMEOUT}). */
  timeout?: number
}

/** Result of {@link registerZenPlugin}. */
export interface ZenPluginHandle {
  /** true = registered with ZenKit; false = ZenKit absent, fallback used. */
  connected: boolean
  zen: ZenKitApi | null
  /** Unregister all of this plugin's panels (no-op when a fallback was used). */
  unregister: () => void
}

function specOf(p: ZenPanelDef, instanceId?: string): PanelSpec {
  const { id, multi, spawnOnly, sidebarIcon, open, ...spec } = p
  return multi ? { ...spec, id: instanceId, instanceOf: id } : { ...spec, id }
}

/** Kebab a display name to a canonical id — IDENTICAL to @nynxz/zenkit-core's namespace slug, so a
 *  derived `id`/`namespace` matches the routing key core would compute (no persisted-key drift). */
function slug(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Auto-prefix a SHORT panel id with the plugin id (`viewer` → `zensuite:viewer`); leave an
 *  already-namespaced id (one containing ':') untouched, so existing full ids never shift. */
function prefixId(pluginId: string, id: string): string {
  return id.includes(':') ? id : `${pluginId}:${id}`
}

/** Build the flat introspection record reported to `zen.plugins.register` (the Inspector's
 *  client-side half; Python nodes/routes are merged in by the Inspector via /zenkit/manifest). */
function buildRecord(def: ZenPluginDef, id: string, namespace: string): RegisteredPlugin {
  return {
    id,
    name: def.plugin,
    namespace,
    version: def.version,
    logo: def.logo,
    description: def.description,
    panels: (def.panels ?? []).map((p) => ({
      id: prefixId(id, p.id),
      title: p.title,
      multi: p.multi,
      spawnOnly: p.spawnOnly,
    })),
    apps: (def.apps ?? []).map((a) => ({
      id: a.id,
      title: a.title,
      namespace,
      routes: (a.routes ?? []).map((r) => r.path),
    })),
    taskbarWidgets: (def.taskbarWidgets ?? []).map((w) => ({ id: w.id, label: w.label })),
    themes: (def.themes ?? []).map((t) => ({ id: t.id, name: t.name })),
    backgrounds: (def.backgrounds ?? []).map((b) => ({ id: b.id, label: b.label })),
    channels: (def.channels ?? []).map((c) => (typeof c === 'string' ? c : c.name)),
    slotLinks: (def.slotLinks ?? []).map((s) => ({
      node: s.on.node,
      slot: s.on.output ?? s.on.input ?? '',
      spawn: s.spawn,
    })),
    widgetViews: Object.keys(def.widgetViews ?? {}),
  }
}

function registerSidebarTabs(appLike: unknown, panels: ZenPanelDef[]): void {
  const mgr = (
    appLike as { extensionManager?: { registerSidebarTab?: (t: unknown) => void } } | undefined
  )?.extensionManager
  if (!mgr?.registerSidebarTab) return
  for (const p of panels) {
    if (p.spawnOnly) continue // not user-openable on its own
    mgr.registerSidebarTab({
      id: p.id.replace(/[^a-z0-9]/gi, '-'),
      icon: p.sidebarIcon || p.icon || 'mdi mdi-application-outline',
      title: p.title,
      tooltip: p.title,
      type: 'custom',
      render: (el: HTMLElement) => {
        p.render(el)
      },
    })
  }
}

/** Plug a plugin into ZenKit in ONE call — the single registration point. Resolves ZenKit in
 *  either load order, then wires up every surface the def declares (panels, apps, taskbar
 *  widgets, themes, backgrounds, channels, slot-links, node-widget views),
 *  reports the plugin to the introspection registry (so the Inspector sees it), logs a clean
 *  "<plugin> → connected (…)" line, and runs `setup` for anything imperative. If ZenKit never
 *  appears, runs the fallback (custom `fallback`, else auto sidebar tabs when `app` is given).
 *  Returns a handle whose `unregister` tears down everything this call registered. */
export async function registerZenPlugin(def: ZenPluginDef): Promise<ZenPluginHandle> {
  const id = def.id ?? def.namespace ?? slug(def.plugin)
  const namespace = def.namespace ?? id

  // Widget-view renderers live in a cross-bundle window global — register them regardless of
  // ZenKit, since a node's widget needs its renderer even while the runtime is still connecting.
  for (const [type, view] of Object.entries(def.widgetViews ?? {})) registerWidgetView(type, view)

  const zen = await whenZen(def.timeout ?? ZEN_CONNECT_TIMEOUT)
  if (zen) {
    const offs: Array<() => void> = []

    // Panels — auto-prefix short ids; thread plugin identity for the ZenBar grouping.
    for (const p of def.panels ?? []) {
      const pid = prefixId(id, p.id)
      const pp: ZenPanelDef = { ...p, id: pid }
      offs.push(
        zen.panels.register({
          plugin: def.plugin,
          logo: def.logo,
          version: def.version,
          id: pid,
          title: p.title,
          icon: p.icon,
          multi: p.multi,
          spawnOnly: p.spawnOnly,
          persist: p.persist,
          render: p.render,
          open: (instanceId) =>
            p.open ? p.open(zen, instanceId) : zen.panels.open(specOf(pp, instanceId)),
        }),
      )
    }
    // Apps — thread identity; `namespace` drives the routing key ('<namespace>/<id>').
    for (const a of def.apps ?? []) {
      offs.push(
        zen.apps.register({
          ...a,
          plugin: def.plugin,
          namespace,
          logo: def.logo,
          version: def.version,
        }),
      )
    }
    // Taskbar widgets (returns an unregister fn).
    for (const w of def.taskbarWidgets ?? []) offs.push(zen.taskbar.register(w))
    // Themes / backgrounds / channels register-only (no unregister in the contract — they're
    // process-lifetime by nature; the introspection record still tracks them).
    for (const t of def.themes ?? []) zen.theme.registerPack(t)
    for (const b of def.backgrounds ?? []) zen.background.register(b)
    for (const c of def.channels ?? []) {
      const decl = typeof c === 'string' ? { name: c } : c
      zen.channels.declare(decl.name, decl.label ? { label: decl.label } : undefined)
    }
    // Canvas slot-links.
    for (const s of def.slotLinks ?? []) offs.push(zen.graph.slotLink(s))

    // Imperative escape hatch.
    let setupCleanup: void | (() => void)
    if (def.setup) {
      try {
        setupCleanup = def.setup(zen, { id, namespace })
      } catch (e) {
        zwarn(`${def.plugin} → setup() threw`, e)
      }
    }

    // Report to the introspection registry (the Inspector's data source).
    const offRecord = zen.plugins.register(buildRecord(def, id, namespace))

    // Clean "<plugin> → connected (3 panels, 1 app, …)" summary.
    const counts: Array<[number, string]> = [
      [def.panels?.length ?? 0, 'panel'],
      [def.apps?.length ?? 0, 'app'],
      [def.taskbarWidgets?.length ?? 0, 'widget'],
      [def.themes?.length ?? 0, 'theme'],
      [def.backgrounds?.length ?? 0, 'background'],
      [def.channels?.length ?? 0, 'channel'],
      [def.slotLinks?.length ?? 0, 'slot-link'],
    ]
    const parts = counts.filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`)
    zlog(`${def.plugin} → connected (${parts.join(', ') || 'no surfaces'})`)

    return {
      connected: true,
      zen,
      unregister: () => {
        offs.forEach((off) => off())
        if (typeof setupCleanup === 'function') setupCleanup()
        offRecord()
      },
    }
  }
  // ZenKit absent — fall back only if the consumer opted in.
  if (def.fallback) {
    def.fallback()
    zwarn(`${def.plugin} → ZenKit not detected, using custom fallback`)
  } else if (def.sidebarFallback && def.app) {
    registerSidebarTabs(
      def.app,
      (def.panels ?? []).map((p) => ({ ...p, id: prefixId(id, p.id) })),
    )
    zwarn(`${def.plugin} → ZenKit not detected, using sidebar fallback`)
  } else {
    zwarn(`${def.plugin} → ZenKit not detected; panels available once ComfyUI-ZenKit is installed`)
  }
  return { connected: false, zen: null, unregister: () => {} }
}

export async function onBus(event: string, cb: BusHandler): Promise<() => void> {
  const zen = await whenZen()
  return zen ? zen.bus.on(event, cb) : () => {}
}

export async function emitBus(event: string, payload?: unknown): Promise<void> {
  const zen = await whenZen()
  zen?.bus.emit(event, payload)
}

/** White-label the taskbar Start button if ZenKit is present (no-op otherwise). `logo` takes an
 *  image URL/data URI or an MDI class ("mdi mdi-rocket-launch"); '' restores the default. A
 *  local override set in Zen Settings wins over this. */
export async function setBranding(branding: { logo?: string; title?: string }): Promise<void> {
  const zen = await whenZen()
  zen?.setBranding(branding)
}

/** Register a permanent-taskbar widget (orderable/toggleable in Zen Settings). Returns an
 *  unregister fn; a no-op unregister if ZenKit isn't present. */
export async function registerTaskbarWidget(widget: TaskbarWidget): Promise<() => void> {
  const zen = await whenZen()
  return zen ? zen.taskbar.register(widget) : () => {}
}

/** Override middle-click on a node slot → create `spawn` and auto-connect it to that slot.
 *  Returns an unregister fn; no-op if ZenKit isn't installed. */
export async function registerSlotLink(spec: {
  on: SlotMatch
  spawn: string
}): Promise<() => void> {
  const zen = await whenZen()
  return zen ? zen.graph.slotLink(spec) : () => {}
}

/** Override middle-click on a node slot with custom compose logic (build + wire nodes). */
export async function onSlotMiddleClick(
  match: SlotMatch,
  handler: (ctx: SlotMiddleClickCtx) => void,
): Promise<() => void> {
  const zen = await whenZen()
  return zen ? zen.graph.onSlotMiddleClick(match, handler) : () => {}
}

/** Subscribe to backend job updates if ZenKit is present (no-op otherwise). */
export async function onJob(cb: (job: Job) => void): Promise<() => void> {
  const zen = await whenZen()
  return zen ? zen.jobs.on(cb) : () => {}
}

/** Open the shared ZenKit viewer (fullscreen lightbox) over `items`. Falls back to opening
 *  the current item in a new browser tab when ZenKit isn't installed. */
export async function openViewer(
  items: ViewerItem[],
  opts: { index?: number } = {},
): Promise<ViewerHandle | null> {
  const zen = await whenZen()
  if (zen) return zen.viewer.open(items, opts)
  const item = items[opts.index ?? 0]
  if (item && typeof window !== 'undefined') window.open(item.src, '_blank', 'noopener')
  return null
}

/** Launch a full-screen app (optionally at a route) if ZenKit is present, else null. */
export async function openApp(
  id: string,
  opts?: { path?: string; query?: Record<string, string> },
): Promise<AppHandle | null> {
  const zen = await whenZen()
  return zen ? zen.apps.open(id, opts) : null
}

/** Navigate the global app router by full path ('datasets/item/42'); '' = the graph.
 *  No-op when ZenKit is absent. */
export async function navigateApp(
  path: string,
  opts?: { query?: Record<string, string>; replace?: boolean },
): Promise<void> {
  const zen = await whenZen()
  zen?.apps.navigate(path, opts)
}

/** Subscribe to app/route changes if ZenKit is present. Returns an unsubscribe fn (no-op
 *  unsubscribe when ZenKit is absent). */
export async function onAppChange(cb: (loc: AppLocation) => void): Promise<() => void> {
  const zen = await whenZen()
  return zen ? zen.apps.on(cb) : () => {}
}

/** Publish an image to a named channel (no-op when ZenKit is absent). */
export async function publishChannel(channel: string, img: ChannelInput): Promise<void> {
  const zen = await whenZen()
  zen?.channels.publish(channel, img)
}

/** Declare a channel up front so it's visible (empty) before any image. No-op without ZenKit. */
export async function declareChannel(channel: string, opts?: { label?: string }): Promise<void> {
  const zen = await whenZen()
  zen?.channels.declare(channel, opts)
}

/** Subscribe to a channel (or LAST_CHANNEL for the most recent). Returns an unsubscribe fn. */
export async function onChannel(
  channel: string,
  cb: (img: ChannelImage) => void,
): Promise<() => void> {
  const zen = await whenZen()
  return zen ? zen.channels.subscribe(channel, cb) : () => {}
}

/** MIME type carrying a draggable image for ZenKit's drag-to-graph bridge. */
export const ZEN_IMAGE_MIME = 'application/x-zenkit-image'

/** ComfyUI's own "this asset already lives on the server" drag MIME. Its payload is a
 *  ResultItem ({ filename, subfolder, type }) — the same shape /view takes. Nodes built on
 *  useNodeDragAndDrop (LoadImage, LoadAudio, …) parse this and set their widget directly,
 *  skipping the download+re-upload round trip. Frontend >= ~1.45; older versions ignore it
 *  and fall back to text/uri-list. */
export const COMFY_ASSET_MIME = 'application/x-comfy-asset-info'

/** Where a file already lives in ComfyUI (matches its ResultItem `type`). */
export type ComfyAssetType = 'input' | 'output' | 'temp'

/** Populate a drag event's dataTransfer so dropping the image on the ComfyUI graph
 *  imports it (sets the image widget of the node under the cursor, or loads the file
 *  when dropped on empty canvas). Call from an element's `dragstart`:
 *    <img draggable @dragstart="e => setImageDragData(e, { url, filename })">
 *  `url` should be the full-resolution image URL (e.g. ComfyUI's /view route).
 *
 *  Pass `type` (+ `filename`/`subfolder`) whenever the file is ALREADY in ComfyUI's
 *  input/output/temp folders — that advertises it as a native Comfy asset, so dropping it
 *  on a loader node just points the widget at the existing file instead of re-uploading a
 *  duplicate copy. Omit `type` for files ComfyUI doesn't host (they upload on drop).
 *
 *  Pass `dragImage` (usually the thumbnail <img>) for a nicer drag cursor. */
export function setImageDragData(
  e: DragEvent,
  img: {
    url: string
    filename?: string
    subfolder?: string
    type?: ComfyAssetType
    hasWorkflow?: boolean
  },
  dragImage?: HTMLImageElement | null,
): void {
  const dt = e.dataTransfer
  if (!dt) return
  dt.setData(ZEN_IMAGE_MIME, JSON.stringify(img))
  // Native Comfy asset → let loader nodes reuse the server-side file as-is.
  if (img.filename && img.type) {
    dt.setData(
      COMFY_ASSET_MIME,
      JSON.stringify({
        filename: img.filename,
        subfolder: img.subfolder || '',
        type: img.type,
        display_name: img.filename,
      }),
    )
  }
  // Fallback for drops that can't use the asset path (empty canvas, older frontends):
  // ComfyUI fetches this URL and treats the bytes as a dropped file.
  dt.setData('text/uri-list', img.url)
  dt.setData('text/plain', img.url)
  dt.effectAllowed = 'copy'
  if (dragImage) {
    try {
      dt.setDragImage(dragImage, 16, 16)
    } catch {
      /* ignore */
    }
  }
}

// Cross-plugin widget renderer registry (window-global so it spans separate bundles).
export type WidgetViewCtx = { widget: any; node: any }
export type WidgetView = (container: HTMLElement, ctx: WidgetViewCtx) => (() => void) | void

function widgetViewRegistry(): Map<string, WidgetView> {
  const w = window as any
  return (w.__zenkitWidgetViews ??= new Map<string, WidgetView>())
}
/** Register a renderer for a widget `type` (e.g. a custom node's widget). */
export function registerWidgetView(type: string, view: WidgetView): void {
  if (type && typeof view === 'function') widgetViewRegistry().set(type, view)
}
/** Get a registered widget renderer, or null. */
export function getWidgetView(type: string): WidgetView | null {
  return widgetViewRegistry().get(type) ?? null
}
