/**
 * @nynxz/zenkit-types — the public ZenKit contract. Types only; no runtime, no build.
 *
 * `core` implements this surface (it builds `window.ZenKit`); `client` and every
 * plugin consume it. It is the single source of truth: keep changes
 * backward-compatible and bump the runtime version when it changes.
 *
 * Organized as: primitives & unions, data shapes, then the root `ZenKitApi`.
 */

/* ───────────────────────── primitives & unions ──────────────────────────── */

export type PanelStatus = 'open' | 'minimized' | 'folded'
export type DockSide = 'left' | 'right' | 'bottom' | null
export type PanelEvent = 'close' | 'minimize' | 'restore' | 'fold' | 'focus'
export type JobStatus = 'start' | 'progress' | 'done' | 'error'
export type ThemeMode = 'light' | 'dark'
export type BusHandler = (payload?: unknown) => void

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/* ─────────────────────────────── data shapes ────────────────────────────── */

/** Per-panel persisted state handed to render(): last-saved blob + a setter. */
export interface PanelContext {
  id: string
  state: unknown
  setState: (state: unknown) => void
}

/** What a plugin passes to open a panel. `render` fills the body and returns an
 *  optional cleanup; the optional 2nd `ctx` arg gives per-panel persisted state. */
export interface PanelSpec {
  /** Unique id. Optional when `instanceOf` is set — ZenKit mints `${instanceOf}#<n>`. */
  id?: string
  title: string
  /** MDI class ("mdi mdi-movie") OR an image URL / data URI (custom favicon/logo). */
  icon?: string
  render: (container: HTMLElement, ctx?: PanelContext) => void | (() => void)
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  dock?: DockSide
  /** Marks this open as an instance of a registered panel TYPE (its registration id). */
  instanceOf?: string
  /** Persist geometry + state across reloads and restore next session (default true). */
  persist?: boolean
  /** Chrome style. `'none'` = a bare, transparent, click-through panel — no header, border,
   *  background, or resize handles; the consumer renders everything (e.g. a floating
   *  animated character). Mark draggable areas with `class="zen-grip"`. Default = full chrome. */
  frame?: 'default' | 'none'
}

/** Live controls for an open panel, returned by `panels.open`. */
export interface PanelHandle {
  readonly id: string
  close(): void
  minimize(): void
  restore(): void
  fold(): void
  /** Toggle maximize: fill the viewport, or restore the prior float rect. */
  maximize(): void
  focus(): void
  setTitle(title: string): void
  /** Swap the icon at runtime (MDI class or image URL/data URI). Not persisted. */
  setIcon(icon: string): void
  dock(side: DockSide): void
  /** Resize/move; omitted fields unchanged; clamped to viewport + min size. */
  setSize(size: { w?: number; h?: number; x?: number; y?: number }, persist?: boolean): void
  /** Current rect in px, or null if not open. */
  getRect(): Rect | null
  on(event: PanelEvent, cb: () => void): () => void
}

/** A reusable panel registered once; the ZenBar lists/opens these. */
export interface PanelRegistration {
  id: string
  title: string
  icon?: string
  /** Groups entries under an owning plugin in the ZenBar. */
  plugin?: string
  logo?: string
  /** Plugin version (e.g. "0.3.1"), shown in Zen Settings. */
  version?: string
  /** Allow multiple live instances (default false = singleton). */
  multi?: boolean
  /** Hide from the ZenBar; opened only programmatically. */
  spawnOnly?: boolean
  /** Persist + restore geometry/state (default true). */
  persist?: boolean
  open: (instanceId?: string) => PanelHandle
  render?: (container: HTMLElement, ctx?: PanelContext) => void | (() => void)
}

/** A unit of backend work reported over the `zenkit.job` websocket; mirrored on the bus. */
export interface Job {
  id: string
  name: string
  status: JobStatus
  current: number
  total: number
  message: string
  startedAt: number
  updatedAt: number
}

/** An image (or video / audio) published to a channel (the named media bus). */
export interface ChannelImage {
  channel: string
  url: string
  filename?: string
  label?: string
  /** Media kind so consumers (Media Viewer) can render a <video>/<audio> instead of <img>.
   *  Absent = image (back-compat with producers that only ever published images). */
  kind?: 'image' | 'video' | 'audio'
  width?: number
  height?: number
  ts: number
}

/** What a producer hands to `channels.publish` (or arrives on `zenkit.channel`).
 *  Give an explicit `url`, or `filename`(+subfolder/type) to resolve via /view. */
export interface ChannelInput {
  url?: string
  filename?: string
  subfolder?: string
  type?: string
  label?: string
  kind?: 'image' | 'video' | 'audio'
  width?: number
  height?: number
}

/** A widget mounted into the permanent taskbar (orderable + toggleable). */
export interface TaskbarWidget {
  id: string
  label: string
  icon?: string
  /** Position hint (lower = further left); a user reorder overrides it. */
  order?: number
  /** Shown by default; the user can still toggle it (default true). */
  defaultOn?: boolean
  render: (el: HTMLElement) => (() => void) | void
}

/** A theme pack: semantic token overrides for light and/or dark, plus optional
 *  custom CSS. This is the shape of a theme JSON file and of what
 *  `theme.registerPack` accepts — themes are data, not code, so users/plugins can
 *  add them at runtime. */
export interface ThemePack {
  /** Unique id (kebab-case). */
  id: string
  /** Display name shown in the picker. */
  name: string
  /** Modes the author supports; omit to derive from which token sets exist. */
  modes?: ThemeMode[]
  tokens: {
    light?: Record<string, string>
    dark?: Record<string, string>
  }
  /** Resolved CSS text, injected verbatim into a `<style>` while this pack is the
   *  active theme (removed when it isn't, so it never leaks across packs). It is
   *  CSS *text*, NOT a file path — the build inlines a theme folder's `.css`
   *  file(s) here. Scope selectors under ZenKit's stable theming contract
   *  (`.zenkit-panel-header`, `.zenkit-panel-button`, the `data-zen-*` panel-state
   *  attributes) and ComfyUI's node DOM (`.lg-node`, `.lg-node-header`); use
   *  `!important` to beat ZenKit's own scoped panel styles. Trusted, local content
   *  only (a `<style>` can't run script, but `url()` can fetch) — same
   *  single-user/localhost trust model as `ZenStorage`. */
  css?: string
}

/** A namespaced key→value store. Values are JSON-serializable. */
export interface ZenStore {
  /** Read a value, or null if absent. */
  get<T = unknown>(key: string): Promise<T | null>
  /** Write a value (JSON-serialized). */
  set(key: string, value: unknown): Promise<void>
  /** Delete a key. */
  remove(key: string): Promise<void>
  /** List the keys present in this scope. */
  keys(): Promise<string[]>
}

/** Persistence for plugins. NOT a secrets vault — both tiers are plaintext and
 *  ComfyUI is single-user / localhost by default, so never store secrets here. */
export interface ZenStorage {
  /** Browser localStorage — instant, per-browser, not synced. UI state / drafts. */
  local: ZenStore
  /** ComfyUI server disk via /api/userdata — survives browser wipes and is portable
   *  across browsers hitting the same server. Files live under `user/<id>/zen/<scope>/`. */
  server: ZenStore
  /** Namespace storage under a plugin id (recommended) so plugins don't collide. */
  scope(name: string): ZenStorage
}

/** Per-frame drawing context handed to a background's `frame()`. */
export interface BackgroundContext {
  /** The background canvas (device-pixel sized) — grab your own 2D / WebGL context. */
  layer: HTMLCanvasElement
  /** Layer size in device pixels. */
  w: number
  h: number
  dpr: number
  /** Graph zoom + pan (LiteGraph `ds.scale` / `ds.offset`). */
  scale: number
  offset: { x: number; y: number }
  /** Cursor in device px relative to the layer (`over=false` when off-canvas). */
  mouse: { x: number; y: number; over: boolean }
  /** Blob trail: recent cursor path in graph space, head→tail. `pts` is flat
   *  [x0,y0,x1,y1,…], `radii` the per-point influence radius (tapering head→tail), `n` the
   *  point count. `n < 2` ⇒ no tail; a renderer should fall back to a plain circle at `mouse`. */
  trail: { pts: number[]; radii: number[]; n: number }
  time: number
  dt: number
  /** Resolve a CSS variable (e.g. '--zen-accent') to a canvas-usable color. */
  color(cssVar: string, fallback?: string): string
}

/** A canvas background rendered behind the node graph. */
export interface ZenBackground {
  id: string
  label: string
  init?(ctx: BackgroundContext): unknown
  frame(ctx: BackgroundContext, state: unknown): void
  dispose?(state: unknown): void
}

export interface ZenBackgrounds {
  /** Register a background (then activate it with `set`). */
  register(bg: ZenBackground): void
  /** Activate a background by id, or null / 'none' to turn it off. */
  set(id: string | null): void
  /** The active background id, or null. */
  current(): string | null
  /** All registered backgrounds. */
  list(): { id: string; label: string }[]
}

/* ───────────────────────────────── graph ────────────────────────────────── */

/** Identify one input/output slot of a node type on the ComfyUI canvas. */
export interface SlotMatch {
  /** Node type id, e.g. "IdeogramStudio". */
  node: string
  /** Match an OUTPUT slot by name (mutually exclusive with `input`). */
  output?: string
  /** Match an INPUT slot by name. */
  input?: string
}

/** Passed to an `onSlotMiddleClick` handler when the user middle-clicks the matched slot. */
export interface SlotMiddleClickCtx {
  /** The clicked LGraphNode (typed loosely — it's a litegraph node). */
  node: unknown
  slotIndex: number
  slotName: string
  isOutput: boolean
  /** The live LGraph. */
  graph: unknown
  /** Suggested spawn position in graph coords (offset off the slot). */
  pos: [number, number]
  /** Spawn a node of `type` and auto-connect it to the clicked slot — the common case.
   *  Uses ComfyUI's own create-for-slot machinery (resolves the type + wires + positions).
   *  Returns truthy on success. */
  spawn(type: string): unknown
  /** Escape hatch: raw-create a node (you `graph.add()` + wire it). May be unavailable on
   *  ComfyUI builds that don't expose LiteGraph — prefer `spawn`. */
  createNode(type: string, pos?: [number, number]): unknown
}

/** Compose nodes on the canvas: override middle-click on a node's slots to spawn + wire a
 *  companion node, instead of ComfyUI's default reroute. (Graceful no-op off-canvas.) */
export interface ZenGraph {
  /** Middle-click the matched slot → create `spawn` and auto-connect it to that slot. */
  slotLink(spec: { on: SlotMatch; spawn: string }): () => void
  /** Middle-click the matched slot → run `handler` (for custom compose logic). */
  onSlotMiddleClick(match: SlotMatch, handler: (ctx: SlotMiddleClickCtx) => void): () => void
  /** Create a litegraph node by type (you still `graph.add()` it). */
  createNode(type: string, pos?: [number, number]): unknown
}

/* ───────────────────────────────── viewer ───────────────────────────────── */

/** One image/video/audio in the shared viewer (mirrors @nynxz/zenkit-ui's LightboxItem). */
export interface ViewerItem {
  /** Full/large image (or video / audio) URL. */
  src: string
  kind?: 'image' | 'video' | 'audio'
  /** Title shown in the viewer toolbar. */
  label?: string
  /** Small caption line (e.g. dimensions / size). */
  meta?: string
  /** If set, the viewer shows a "Load workflow" button that calls this (e.g. load the
   *  image's embedded workflow). The viewer stays ComfyUI-agnostic; the consumer wires it. */
  onWorkflow?: () => void
}

export interface ViewerHandle {
  close(): void
  setIndex(index: number): void
}

/** Shared, host-owned image/video viewer. The lightbox lives once in the host; plugins just
 *  open it (graceful: `@nynxz/zenkit-client`'s openViewer falls back to a new tab when absent). */
export interface ZenViewer {
  /** Open a fullscreen lightbox over `items` at `index`, replacing any open viewer. */
  open(items: ViewerItem[], opts?: { index?: number }): ViewerHandle
  /** Close the current viewer, if any. */
  close(): void
}

/* ───────────────────────────────── apps ─────────────────────────────────── */

/** Where you are in the global app router. `app` is null at the graph (the "desktop"
 *  root); otherwise it's the active app's routing key — '<namespace>/<id>' (e.g.
 *  'zendatasets/datasets'), or a bare '<id>' for an app with no plugin namespace.
 *  `path` is the route within that app (no key prefix), e.g. '' (index) or 'item/42'. */
export interface AppLocation {
  app: string | null
  path: string
  /** Path params from the matched route pattern (e.g. { id: '42' } for 'item/:id'). */
  params: Record<string, string>
  /** Query-string params (?k=v). */
  query: Record<string, string>
}

/** A navigator scoped to one app — paths are relative to that app's namespace. Handed
 *  to a route's render via `RouteContext.router`. */
export interface AppRouter {
  /** Navigate within the app: `go('item/42')`. An absolute path ('/datasets/item/42')
   *  also works. `replace` overwrites the current history entry instead of pushing. */
  go(path: string, opts?: { query?: Record<string, string>; replace?: boolean }): void
  /** Step back / forward through history (the graph is the root entry). */
  back(): void
  forward(): void
  /** The current location. */
  location(): AppLocation
  /** Subscribe to location changes for this app. Returns an unsubscribe fn. */
  on(cb: (loc: AppLocation) => void): () => void
}

/** Per-route render context — mirrors `PanelContext` and adds routing. The render fills
 *  the route surface and returns an optional cleanup (run when the route is left). */
export interface RouteContext {
  /** Owning app id. */
  app: string
  /** The matched route path pattern (e.g. 'item/:id'). */
  route: string
  params: Record<string, string>
  query: Record<string, string>
  /** App-scoped navigator. */
  router: AppRouter
  /** Per-app persisted state blob (like `PanelContext.state`) + its setter. */
  state: unknown
  setState: (state: unknown) => void
}

/** One screen ("page") inside an app, matched by a namespaced path pattern. */
export interface AppRoute {
  /** Path pattern relative to the app: '' (index), 'item/:id', 'settings'. */
  path: string
  /** Title for the chrome bar / breadcrumb — a string or a fn of the matched params. */
  title?: string | ((params: Record<string, string>) => string)
  render: (container: HTMLElement, ctx: RouteContext) => void | (() => void)
}

/** A full-screen app registered once; launched from the ZenBar or programmatically.
 *  An app covers the graph (the "desktop"); the taskbar stays as the way back. */
export interface AppRegistration {
  /** App id (kebab-case), e.g. 'datasets'. Unique within its plugin namespace. */
  id: string
  title: string
  /** MDI class ("mdi mdi-database") OR an image URL / data URI. */
  icon?: string
  /** Groups this app under an owning plugin in the ZenBar. */
  plugin?: string
  /** Route namespace this app's routes live under — its key becomes '<namespace>/<id>'
   *  (e.g. 'zendatasets/datasets'). Injected by registerZenPlugin (explicit
   *  ZenPluginDef.namespace, else a slug of the display `plugin` name). */
  namespace?: string
  logo?: string
  /** Plugin version (e.g. "0.3.1"), shown in Zen Settings. */
  version?: string
  /** Hide from the ZenBar launcher; opened only programmatically. */
  spawnOnly?: boolean
  /** Restore the active app + route across reloads (default true). */
  persist?: boolean
  /** Keep ZenKit's slim app chrome bar (home / back / forward + title). Default true. */
  chrome?: boolean
  /** Default route opened when the app is launched without one (default ''). */
  home?: string
  routes: AppRoute[]
}

/** Live controls for the active app, returned by `apps.open`. */
export interface AppHandle {
  readonly id: string
  /** App-scoped navigator (same instance as `RouteContext.router`). */
  readonly router: AppRouter
  /** Close the app → back to the graph. */
  close(): void
}

/* ─────────────────────────────── plugins ────────────────────────────────── */

/** A summary of everything one plugin contributes, recorded in the introspection
 *  registry. `registerZenPlugin` (from @nynxz/zenkit-client) builds this and reports it via
 *  `plugins.register`; the Zen Inspector reads it back. The client (browser) surfaces are
 *  filled here; a plugin's Python-side nodes/routes are merged in by the Inspector from the
 *  backend `/zenkit/manifest` route, keyed by the same `id`. Keep these summaries flat and
 *  serializable — they describe registrations, they don't carry render fns. */
export interface RegisteredPlugin {
  /** Canonical kebab id — the single identity that derives the namespace, the `<id>:` panel-id
   *  prefix, and the `/<id>/` route prefix. The Inspector joins client + Python by this. */
  id: string
  /** Display name (the ZenBar group name). */
  name: string
  /** Route namespace for this plugin's apps (defaults to `id`). */
  namespace?: string
  version?: string
  logo?: string
  description?: string
  panels: { id: string; title: string; multi?: boolean; spawnOnly?: boolean }[]
  apps: { id: string; title: string; namespace?: string; routes: string[] }[]
  taskbarWidgets: { id: string; label: string }[]
  themes: { id: string; name: string }[]
  backgrounds: { id: string; label: string }[]
  /** Channel names this plugin declares (the named media bus). */
  channels: string[]
  /** Canvas slot-link compositions (middle-click a slot → spawn + wire a node). */
  slotLinks: { node: string; slot: string; spawn: string }[]
  /** Node-widget renderer types this plugin registers (cross-bundle widget views). */
  widgetViews: string[]
}

/** The introspection registry: an ownership ledger of which plugin contributed what. It is
 *  the data source for the Zen Inspector and for a clean "what's installed" view. Registration
 *  of the actual surfaces still happens through the specific namespaces (`panels`, `apps`, …);
 *  this records *who owns them* so the picture can be assembled per plugin. */
export interface ZenPlugins {
  /** Record a plugin's contributed surfaces. `registerZenPlugin` (the one-call SDK entry)
   *  calls this for you. Returns an unregister fn that drops the record. */
  register(plugin: RegisteredPlugin): () => void
  /** Every registered plugin and what it contributes (drives the Inspector). */
  registered(): RegisteredPlugin[]
  /** One plugin's record by canonical id, or null. */
  get(id: string): RegisteredPlugin | null
}

/* ───────────────────────────────── root API ─────────────────────────────── */

export interface ZenKitApi {
  version: string
  ready: Promise<ZenKitApi>
  /** semver-ish guard, e.g. require('^1.0.0'). */
  require(range: string): boolean

  panels: {
    open(spec: PanelSpec): PanelHandle
    close(id: string): void
    get(id: string): PanelHandle | null
    list(): string[]
    register(reg: PanelRegistration): () => void
    registered(): PanelRegistration[]
    /** Currently-open instances of a panel type (its registration id). */
    instances(typeId: string): { id: string; title: string }[]
  }

  theme: {
    tokens: readonly string[]
    packs(): string[]
    packLabel(id: string): string
    /** Modes a pack supports. Some packs are dark-only or light-only; use this to
     *  avoid offering (or applying) a mode the pack wasn't designed for. */
    packModes(id: string): ThemeMode[]
    setPack(name: string): void
    current(): string
    currentMode(): ThemeMode
    /** Ignored if the current pack doesn't support `mode` (see `packModes`). */
    setMode(mode: ThemeMode): void
    onChange(cb: (pack: string) => void): () => void
    /** Register a theme pack at runtime (a user/plugin-provided JSON theme).
     *  Returns false if the data isn't a valid pack. */
    registerPack(pack: ThemePack): boolean
  }

  bus: {
    on(event: string, cb: BusHandler): () => void
    emit(event: string, payload?: unknown): void
    off(event: string, cb: BusHandler): void
  }

  /** Live backend jobs (progress). Mirrored on the bus as 'job' / 'job:*'. */
  jobs: {
    list(): Job[]
    get(id: string): Job | null
    on(cb: (job: Job) => void): () => void
  }

  /** Named image bus. Mirrored on the bus as 'channel' / 'channel:<name>'. */
  channels: {
    publish(channel: string, img: ChannelInput): void
    /** Register a channel so it's listed/visible before any image is published. */
    declare(channel: string, opts?: { label?: string }): void
    get(channel: string): ChannelImage | null
    last(): ChannelImage | null
    list(): string[]
    subscribe(channel: string, cb: (img: ChannelImage) => void): () => void
  }

  /** Permanent-taskbar widgets (orderable/toggleable in Zen Settings). */
  taskbar: {
    register(widget: TaskbarWidget): () => void
  }

  /** Plugin introspection registry — the ownership ledger of which plugin contributed which
   *  panels / apps / widgets / tabs / themes / etc. `registerZenPlugin` reports into this; the
   *  Zen Inspector reads it back (merging Python-side nodes/routes from `/zenkit/manifest`). */
  plugins: ZenPlugins

  /** Persistence for plugins — `local` (browser) + `server` (ComfyUI disk).
   *  Not for secrets. Use `storage.scope('my-plugin')` to namespace. */
  storage: ZenStorage

  /** Themed canvas background behind the node graph (register / set / list). */
  background: ZenBackgrounds

  /** Canvas composition — override middle-click on node slots to spawn + wire companions. */
  graph: ZenGraph

  /** Shared image/video viewer — one fullscreen lightbox the host owns; any plugin opens it. */
  viewer: ZenViewer

  /** Full-screen apps + a built-in namespaced router. An app covers the graph (the
   *  "desktop"); routes inside it are addressed `<appId>/<route>` (e.g. 'datasets/item/42').
   *  The graph stays live underneath, so apps keep using jobs / channels / the backend. */
  apps: {
    /** Register a full-screen app. Returns an unregister fn. */
    register(reg: AppRegistration): () => void
    /** All registered apps (drives the ZenBar launcher). */
    registered(): AppRegistration[]
    /** Launch an app (optionally at a route) full-screen over the graph. */
    open(id: string, opts?: { path?: string; query?: Record<string, string> }): AppHandle
    /** Close the active app → back to the graph (the desktop). It stays MINIMIZED: the
     *  taskbar keeps its chip so the user can get back to where they were. */
    close(): void
    /** Re-enter the app last closed, at the route it was left on. False if there isn't one. */
    restore(): boolean
    /** The app that was closed but is still on the taskbar, or null. */
    minimized(): AppLocation | null
    /** The active app id, or null when the graph is showing. */
    current(): string | null
    /** Global navigation by full path: `navigate('datasets/item/42')`. '' or '/' = the graph. */
    navigate(path: string, opts?: { query?: Record<string, string>; replace?: boolean }): void
    back(): void
    forward(): void
    /** The current global location (app + route). */
    location(): AppLocation
    /** Subscribe to any location change (app switch or route change). Returns an unsubscribe fn. */
    on(cb: (loc: AppLocation) => void): () => void
  }

  // Chrome & settings toggles (persisted; surfaced in Zen Settings). These flat
  // setters are the least-settled part of the contract — they may be regrouped
  // (e.g. under `chrome.*`) after the alpha.
  /** White-label the taskbar's Start button. `logo` is an image URL/data URI OR an MDI class
   *  ("mdi mdi-rocket-launch"); '' restores the default. This is the distributor's brand — a
   *  local override typed into Zen Settings still wins over it. */
  setBranding(branding: { logo?: string; title?: string }): void
  setMinimizedAnchor(anchor: 'left' | 'center' | 'right'): void
  setTaskbarPos(pos: 'top' | 'bottom'): void
  setAbsorbComfyButtons(on: boolean): void
  setAbsorbCanvasControls(on: boolean): void
  /** Mirror the active app route into the URL hash (#zen=…) for shareable links + browser
   *  back/forward (on by default). */
  setAppUrlSync(on: boolean): void
  setSidebarAutohide(on: boolean): void
  setFloatingSidebar(on: boolean): void
  setDebug(verbose: boolean): void
}

declare global {
  interface Window {
    ZenKit?: ZenKitApi
  }
}
