// @nynxz/zenkit-client — typed SDK for window.ZenKit; self-contained, no-ops when ZenKit is absent.
// It owns the ZenKit contract (./contract, types only): consumers import every ZenKit type from
// here, with `import type`.
export type * from './contract'
import type {
  Capability,
  AppRegistration,
  JobHandle,
  JobStartOptions,
  PanelContext,
  PanelHandle,
  PanelSpec,
  RegisteredPlugin,
  SlotMatch,
  TaskbarWidget,
  ThemePack,
  ViewerHandle,
  ViewerItem,
  ViewerOpenOptions,
  ZenBackground,
  ZenKitApi,
} from './contract'

// What this package adds over `window.ZenKit`: graceful fallback when ZenKit is absent
// (whenZen, startJob, openViewer), the one-call plugin registration, Vue integration and DOM
// helpers. Everything else is the runtime itself — call it directly:
//   (await whenZen())?.bus.emit('x')   or, in sync code once ZenKit is up,   getZenKit()?.bus.emit('x')

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

/** ms to wait for ZenKit before deciding it's absent, when the host never announced itself. */
export const ZEN_CONNECT_TIMEOUT = 6000

// Set once a wait has timed out with no host in sight, so later calls answer null at once instead
// of each waiting out the timeout again. A ZenKit that turns up after all is still found: the
// `getZenKit()` and `ZenKitPending` checks come first.
let _absent = false

/** Resolve ZenKit when ready. When the host has announced itself (`window.ZenKitPending`)
 *  this waits as long as installing takes; otherwise it gives up with null after `timeout`.
 *  Once one call has given up, later calls resolve null immediately. */
export function whenZen(timeout = ZEN_CONNECT_TIMEOUT): Promise<ZenKitApi | null> {
  const now = getZenKit()
  if (now) return now.ready ?? Promise.resolve(now)
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.ZenKitPending) {
    return new Promise((resolve) =>
      window.addEventListener('zen:ready', () => resolve(getZenKit()), { once: true }),
    )
  }
  if (_absent) return Promise.resolve(null)
  return new Promise((resolve) => {
    let done = false
    const finish = (v: ZenKitApi | null) => {
      if (done) return
      done = true
      window.removeEventListener('zen:ready', onReady)
      if (!v) {
        _absent = true
        warnAbsentOnce()
      }
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

/** One app a plugin contributes — an {@link AppRegistration} minus the fields the plugin
 *  supplies (`plugin` / `logo` / `version`), mirroring how {@link ZenPanelDef} relates to a
 *  panel registration. */
export type ZenAppDef = Omit<AppRegistration, 'plugin' | 'namespace' | 'logo' | 'version'>

/** One panel a plugin contributes — a panel spec plus Start-menu flags. */
export interface ZenPanelDef extends Omit<PanelSpec, 'id' | 'instanceOf'> {
  id: string
  /** Allow multiple live instances (the Start menu shows open-new + an instance list). */
  multi?: boolean
  /** Hide from the Start menu; opened only programmatically (popup/action-spawned). */
  spawnOnly?: boolean
  /** Icon for the sidebar-tab fallback when ZenKit is absent (defaults to `icon`). */
  sidebarIcon?: string
  /** Escape hatch: fully custom open (gets the live ZenKit + the instance id). */
  open?: (zen: ZenKitApi, instanceId?: string) => PanelHandle
}

/** A plugin's whole ZenKit integration — the single registration point. One call wires up
 *  every client surface (panels, apps, taskbar widgets, themes, backgrounds,
 *  channels, slot-links, capabilities), reports the plugin to the introspection registry
 *  (so the Zen Inspector can see it), and handles graceful fallback when ZenKit is absent.
 *  Passed to {@link registerZenPlugin}.
 *
 *  Ids follow one rule. What a plugin owns is namespaced by its `id` when given short: panels
 *  and taskbar widgets as `<id>:<short>`, capabilities as `<id>.<short>`; an id that already
 *  contains the separator is kept as given. Channels, themes and backgrounds are global by
 *  design and never prefixed — plugins share them on purpose. */
export interface ZenPluginDef {
  /** Canonical kebab id — the single identity that derives the app `namespace`, the id prefix
   *  of short panel / taskbar-widget / capability ids, and joins this plugin's client surfaces
   *  to its Python pack in the Inspector. Defaults to a slug of `plugin` ("ZenSuite" →
   *  "zensuite"). Set it (and the matching `[tool.zenkit] id` in pyproject.toml) to pin a
   *  stable identity across both runtimes. */
  id?: string
  /** Display/group name shown in the Start menu. */
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
  /** Permanent-taskbar widgets (orderable/toggleable in Zen Settings). A short widget id is
   *  auto-prefixed to `<id>:<widgetId>`, like panels. */
  taskbarWidgets?: TaskbarWidget[]
  /** Theme packs to register (semantic token packs; data, not code). Ids are global and never
   *  prefixed: a theme is picked by name, whichever plugin brought it. */
  themes?: ThemePack[]
  /** Canvas backgrounds rendered behind the node graph (register only; activate via the API).
   *  Ids are global and never prefixed, like themes. */
  backgrounds?: ZenBackground[]
  /** Channels to declare up front on the named media bus (so they're listed before any
   *  publish). A bare name, or `{ name, label }`. Names are global and never prefixed: a
   *  channel is how plugins share media, so every plugin addresses it by the same name. */
  channels?: (string | { name: string; label?: string })[]
  /** Canvas slot-link compositions: middle-click the matched slot → spawn + wire the node. */
  slotLinks?: { on: SlotMatch; spawn: string }[]
  /** Actions this plugin offers other plugins and agents (agents see each one as a tool). A
   *  short id ('search') becomes '<id>.search'; an id with a '.' is kept as given. */
  capabilities?: Capability[]
  /** Imperative escape hatch for anything the declarative surfaces don't cover. Runs once
   *  ZenKit is ready, with the live API + this plugin's resolved identity; return a cleanup. */
  setup?: (zen: ZenKitApi, plugin: { id: string; namespace: string }) => void | (() => void)
  /** ComfyUI's `app` (from '@comfy/app') — only needed when `sidebarFallback` is on,
   *  to register the sidebar tabs. */
  app?: unknown
  /** When ZenKit is absent, register ComfyUI sidebar tabs for the panels (needs
   *  `app`). OFF by default — ZenKit's Start menu is the launcher, and we don't clutter
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

/** Auto-prefix a SHORT panel or taskbar-widget id with the plugin id (`viewer` →
 *  `zensuite:viewer`); leave an already-namespaced id (one containing ':') untouched. */
function prefixId(pluginId: string, id: string): string {
  return id.includes(':') ? id : `${pluginId}:${id}`
}

/** The same rule for capabilities, with a '.' (`search` → `stash.search`). */
const capabilityId = (plugin: string, id: string) => (id.includes('.') ? id : `${plugin}.${id}`)

/** Build the flat introspection record reported to `zen.plugins.register` — the Inspector's
 *  client-side half. It joins this to the pack on disk (`/zeninspector/inspect`) by `id`. */
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
    taskbarWidgets: (def.taskbarWidgets ?? []).map((w) => ({
      id: prefixId(id, w.id),
      label: w.label,
    })),
    themes: (def.themes ?? []).map((t) => ({ id: t.id, name: t.name })),
    backgrounds: (def.backgrounds ?? []).map((b) => ({ id: b.id, label: b.label })),
    channels: (def.channels ?? []).map((c) => (typeof c === 'string' ? c : c.name)),
    slotLinks: (def.slotLinks ?? []).map((s) => ({
      node: s.on.node,
      slot: s.on.output ?? s.on.input ?? '',
      spawn: s.spawn,
    })),
    capabilities: (def.capabilities ?? []).map((c) => capabilityId(id, c.id)),
  }
}

/** The PanelContext a sidebar-tab fallback hands to `render`, so a panel behaves the same with or
 *  without ZenKit: its state persists in localStorage under the panel id, and `expose` is
 *  accepted but goes nowhere (there is no ZenKit to drive the panel through). */
function fallbackContext(id: string): PanelContext {
  const key = `zenkit:fallback:${id}`
  let state: unknown = null
  try {
    state = JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    /* unreadable or blocked storage: start empty */
  }
  const ctx: PanelContext = {
    id,
    state,
    setState: (next) => {
      ctx.state = next
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* storage full or blocked: keep it for this session only */
      }
    },
    expose: () => () => {},
  }
  return ctx
}

function registerSidebarTabs(appLike: unknown, panels: ZenPanelDef[]): void {
  const mgr = (
    appLike as { extensionManager?: { registerSidebarTab?: (t: unknown) => void } } | undefined
  )?.extensionManager
  if (!mgr?.registerSidebarTab) return
  for (const p of panels) {
    if (p.spawnOnly) continue // not user-openable on its own
    let cleanup: void | (() => void)
    mgr.registerSidebarTab({
      id: p.id.replace(/[^a-z0-9]/gi, '-'),
      icon: p.sidebarIcon || p.icon || 'mdi mdi-application-outline',
      title: p.title,
      tooltip: p.title,
      type: 'custom',
      render: (el: HTMLElement) => {
        cleanup = p.render(el, fallbackContext(p.id))
      },
      // ComfyUI calls this when the tab's content is torn down.
      destroy: () => {
        if (typeof cleanup === 'function') cleanup()
        cleanup = undefined
      },
    })
  }
}

/** Plug a plugin into ZenKit in ONE call — the single registration point. Resolves ZenKit in
 *  either load order, then wires up every surface the def declares (panels, apps, taskbar
 *  widgets, themes, backgrounds, channels, slot-links, capabilities),
 *  reports the plugin to the introspection registry (so the Inspector sees it), logs a clean
 *  "<plugin> → connected (…)" line, and runs `setup` for anything imperative. If ZenKit never
 *  appears, runs the fallback (custom `fallback`, else auto sidebar tabs when `app` is given).
 *  Returns a handle whose `unregister` tears down everything this call registered. */
export async function registerZenPlugin(def: ZenPluginDef): Promise<ZenPluginHandle> {
  const id = def.id ?? def.namespace ?? slug(def.plugin)
  const namespace = def.namespace ?? id

  const zen = await whenZen(def.timeout ?? ZEN_CONNECT_TIMEOUT)
  if (zen) {
    const offs: Array<() => void> = []

    // Panels — auto-prefix short ids; thread plugin identity for the Start-menu grouping.
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
    // Taskbar widgets — short ids prefixed like panels.
    for (const w of def.taskbarWidgets ?? [])
      offs.push(zen.taskbar.register({ ...w, id: prefixId(id, w.id) }))
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
    for (const c of def.capabilities ?? [])
      offs.push(zen.capabilities.register({ ...c, id: capabilityId(id, c.id), plugin: id }))

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
      [def.capabilities?.length ?? 0, 'capability'],
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

const NO_JOB: JobHandle = { id: '', update: () => {}, done: () => {}, fail: () => {} }

/** Report progress for frontend work; it shows in the taskbar's Jobs widget. Resolves to a
 *  handle that does nothing when ZenKit isn't installed, so callers never need to check. */
export async function startJob(name: string, opts?: JobStartOptions): Promise<JobHandle> {
  const zen = await whenZen()
  return zen ? zen.jobs.start(name, opts) : NO_JOB
}

export { useJob } from './useJob'

/** Open the shared ZenKit viewer (fullscreen lightbox) over `items`. Falls back to opening
 *  the current item in a new browser tab when ZenKit isn't installed. */
export async function openViewer(
  items: ViewerItem[],
  opts: ViewerOpenOptions = {},
): Promise<ViewerHandle | null> {
  const zen = await whenZen()
  if (zen) return zen.viewer.open(items, opts)
  const item = items[opts.index ?? 0]
  if (item && typeof window !== 'undefined') window.open(item.src, '_blank', 'noopener')
  return null
}

export { mountVue } from './mountVue'
export { useLightbox } from './useLightbox'
export type { Lightbox } from './useLightbox'

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

/** Resolve a possibly-relative asset URL against the current page. Returns the input
 *  unchanged if it cannot be parsed (nothing sensible to fall back to). */
function absoluteUrl(url: string): string {
  try {
    return new URL(url, window.location.href).toString()
  } catch {
    return url
  }
}

/** Populate a drag event's dataTransfer so dropping the image on the ComfyUI graph
 *  imports it (sets the image widget of the node under the cursor, or loads the file
 *  when dropped on empty canvas). Call from an element's `dragstart`:
 *    <img draggable @dragstart="e => setImageDragData(e, { url, filename })">
 *  `url` should be the full-resolution image URL (e.g. ComfyUI's /view route); relative
 *  paths are resolved against the page before they go on the clipboard.
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
    /** Its media ref (see `ZenMedia`); derived for ComfyUI files when omitted. */
    ref?: string
  },
  dragImage?: HTMLImageElement | null,
): void {
  const dt = e.dataTransfer
  if (!dt) return
  // `text/uri-list` MUST be absolute. Chromium validates that type and silently DROPS the
  // entry when the value is a relative path — and ComfyUI gates every drop path on the type
  // being present (`onDragOver` won't even mark the node droppable without it), so a
  // relative '/view?…' makes the whole drag a no-op with no error anywhere. Resolve it
  // against the page, exactly as ComfyUI's own asset cards do.
  const url = absoluteUrl(img.url)
  const ref = img.ref ?? (img.filename && img.type ? comfyRef(img.type, img.subfolder, img.filename) : refFromUrl(url))
  dt.setData(ZEN_IMAGE_MIME, JSON.stringify({ ...img, url, ref }))
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
  dt.setData('text/uri-list', url)
  dt.setData('text/plain', url)
  dt.effectAllowed = 'copy'
  if (dragImage) {
    try {
      dt.setDragImage(dragImage, 16, 16)
    } catch {
      /* ignore */
    }
  }
}

/** One media item recovered from a drop. */
export interface DroppedImage {
  url: string
  /** Its media ref (see `ZenMedia`) when the drag named one or it is a ComfyUI file. */
  ref?: string
  filename?: string
  kind?: 'image' | 'video' | 'audio'
  /** True when `url` is an object URL this call minted from a local File. The caller owns it and
   *  must `URL.revokeObjectURL` when done, or the blob is pinned for the life of the document. */
  objectUrl?: boolean
}

const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v)(\?|#|$)/i
const AUDIO_EXT = /\.(mp3|wav|flac|ogg|oga|m4a|aac|opus)(\?|#|$)/i

/** Guess the media kind from a filename or url. A `data:` URI is read from its media type,
 *  since it has no extension to go on. Anything else, GIF included, is an image (the default,
 *  matching ChannelImage). */
export function mediaKindOf(nameOrUrl: string): 'image' | 'video' | 'audio' {
  const s = nameOrUrl || ''
  const data = /^data:(image|video|audio)\//i.exec(s)
  if (data) return data[1]!.toLowerCase() as 'image' | 'video' | 'audio'
  if (VIDEO_EXT.test(s)) return 'video'
  if (AUDIO_EXT.test(s)) return 'audio'
  return 'image'
}

function fileNameFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url, window.location.href)
    // `data:`/`blob:` have no meaningful path — deriving a name yields the whole payload,
    // which then shows up as the caption. Better to have none.
    if (u.protocol === 'data:' || u.protocol === 'blob:') return undefined
    return u.searchParams.get('filename') || u.pathname.split('/').pop() || undefined
  } catch {
    return undefined
  }
}

/** The media ref of a ComfyUI file: `output/sub/name.png`. */
function comfyRef(type: string, subfolder: string | undefined, filename: string): string {
  return [type, subfolder, filename].filter(Boolean).join('/')
}

/** A ComfyUI `/view?filename=…` URL as a media ref; undefined for any other URL. */
function refFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url, window.location.href)
    const filename = u.searchParams.get('filename')
    if (!u.pathname.endsWith('/view') || !filename) return undefined
    return comfyRef(u.searchParams.get('type') || 'output', u.searchParams.get('subfolder') ?? '', filename)
  } catch {
    return undefined
  }
}

/** The inverse of `setImageDragData`: recover the media a drop is carrying.
 *
 *  Handles, in order of how much they tell us: ZenKit's own drag payload, ComfyUI's asset-info
 *  (so drags from ITS asset browser work too), a plain URL, and finally local files off the
 *  desktop. Returns [] when the drop carries nothing usable, so a caller can decline it and let
 *  the event fall through to ComfyUI.
 *
 *  Call `e.preventDefault()` yourself when you accept a drop — ComfyUI's document-level handler
 *  bails on `defaultPrevented`, which is what stops a drop on your panel from ALSO importing the
 *  file into the graph. */
export function readImageDragData(e: DragEvent): DroppedImage[] {
  const dt = e.dataTransfer
  if (!dt) return []

  // 1. ZenKit's own payload — the richest: it already carries a resolved absolute url.
  const zen = safeJson(dt.getData(ZEN_IMAGE_MIME))
  if (zen && typeof zen.url === 'string' && zen.url) {
    const filename = typeof zen.filename === 'string' ? zen.filename : fileNameFromUrl(zen.url)
    const ref = typeof zen.ref === 'string' ? zen.ref : refFromUrl(zen.url)
    return [{ url: zen.url, ref, filename, kind: mediaKindOf(filename || zen.url) }]
  }

  // 2. ComfyUI's asset-info — a ResultItem naming a file the server already hosts.
  const asset = safeJson(dt.getData(COMFY_ASSET_MIME))
  if (asset && typeof asset.filename === 'string' && asset.filename) {
    const q = new URLSearchParams({
      filename: String(asset.filename),
      subfolder: String(asset.subfolder || ''),
      type: String(asset.type || 'output'),
    })
    const name = String(asset.display_name || asset.filename)
    const ref = comfyRef(String(asset.type || 'output'), String(asset.subfolder || ''), String(asset.filename))
    return [{ url: absoluteUrl(`/api/view?${q}`), ref, filename: name, kind: mediaKindOf(name) }]
  }

  // 3. A plain URL. `file:` is unusable from an http document — fall through to the File below,
  //    which is how a drag from the desktop actually arrives.
  const uri = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split('\n')[0]?.trim()
  if (uri && /^(https?|data|blob):/i.test(uri)) {
    const filename = fileNameFromUrl(uri)
    return [{ url: uri, ref: refFromUrl(uri), filename, kind: mediaKindOf(filename || uri) }]
  }

  // 4. Local files off the desktop. Object URLs render immediately with no upload round trip;
  //    the caller revokes them.
  const files = Array.from(dt.files ?? []).filter((f) => /^(image|video|audio)\//.test(f.type))
  if (files.length) {
    return files.map((f) => ({
      url: URL.createObjectURL(f),
      filename: f.name,
      kind: (f.type.split('/')[0] as 'image' | 'video' | 'audio') ?? 'image',
      objectUrl: true,
    }))
  }
  return []
}

/** A whole collection in one drag — a gallery, an album, a folder. Dragging only lets a source
 *  attach data synchronously, so the items travel as a same-origin URL that returns them
 *  (`MediaList`), fetched by whoever accepts the drop. Set it alongside `setImageDragData` for a
 *  single representative picture, so targets that only take one image (a loader node) still get
 *  something sensible. */
export const ZEN_MEDIA_LIST_MIME = 'application/x-zenkit-media-list'

export interface MediaListRef {
  /** Returns a `MediaList` as JSON. */
  url: string
  title?: string
  count?: number
}

export interface MediaList {
  title?: string
  items: { url: string; filename?: string; kind?: 'image' | 'video' | 'audio'; label?: string }[]
}

export function setMediaListDragData(e: DragEvent, list: MediaListRef): void {
  e.dataTransfer?.setData(
    ZEN_MEDIA_LIST_MIME,
    JSON.stringify({ ...list, url: absoluteUrl(list.url) }),
  )
}

/** Everything a drop carries, with a dropped media list fetched and expanded; otherwise the same
 *  as `readImageDragData`. The drop's data is read before anything is awaited — a DataTransfer
 *  goes blank once its event returns — so call this from the drop handler itself. If the list
 *  can't be fetched, the drop's single picture (if any) is returned instead. */
export async function readMediaListDrop(
  e: DragEvent,
): Promise<{ title?: string; items: DroppedImage[] }> {
  const single = readImageDragData(e)
  const ref = safeJson(e.dataTransfer?.getData(ZEN_MEDIA_LIST_MIME) ?? '')
  if (!ref || typeof ref.url !== 'string') return { items: single }
  try {
    const response = await fetch(ref.url, { credentials: 'include' })
    if (!response.ok) throw new Error(String(response.status))
    const list = (await response.json()) as MediaList
    return {
      title: list.title ?? (typeof ref.title === 'string' ? ref.title : undefined),
      items: list.items.map((it) => {
        const url = absoluteUrl(it.url)
        const filename = it.filename ?? fileNameFromUrl(url)
        return { url, filename, kind: it.kind ?? mediaKindOf(filename || url) }
      }),
    }
  } catch {
    return { items: single }
  }
}

/** True when a dragover is carrying something `readImageDragData` could use. `dataTransfer` is in
 *  protected mode during dragover — `getData` returns '' — so this can only look at `types`. */
export function hasImageDragData(e: DragEvent): boolean {
  const t = e.dataTransfer?.types
  if (!t) return false
  return (
    t.includes(ZEN_MEDIA_LIST_MIME) ||
    t.includes(ZEN_IMAGE_MIME) ||
    t.includes(COMFY_ASSET_MIME) ||
    t.includes('text/uri-list') ||
    t.includes('Files')
  )
}

function safeJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
