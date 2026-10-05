/**
 * The public ZenKit contract — the `window.ZenKit` surface. Types only; nothing here emits code.
 *
 * `core` implements this surface (it builds `window.ZenKit`); every plugin consumes it through
 * `@nynxz/zenkit-client`, which re-exports it. Import it with `import type` so no runtime
 * dependency is created. It is the single source of truth: bump the runtime version when it
 * changes.
 *
 * Organized as: primitives & unions, data shapes, then the root `ZenKitApi`.
 */

/* ───────────────────────── primitives & unions ──────────────────────────── */

export type PanelStatus = 'open' | 'minimized' | 'folded'
/** Where a panel docks. `'right'` and `'bottom'` are ZenKit's docks. `'sidebar'` pins it into
 *  ComfyUI's own sidebar (one rail tab per panel). `'left'` is the left edge: ComfyUI's sidebar
 *  when the frontend has one (the same as `'sidebar'`), otherwise ZenKit's own left dock — and
 *  `'sidebar'` without a ComfyUI sidebar falls back to that left dock too. `null` floats it. */
export type DockSide = 'left' | 'right' | 'bottom' | 'sidebar' | null
/** One of ZenKit's own docks (see `ZenKitApi.docks`). */
export type DockZoneSide = 'left' | 'right' | 'bottom'
export type PanelEvent = 'open' | 'close' | 'minimize' | 'restore' | 'fold' | 'maximize' | 'focus'
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
  /** Let others (another plugin, an agent) read this panel's state and drive it while it is
   *  mounted. Call it on mount; the returned function withdraws it (call it on unmount). */
  expose: (api: PanelApi) => () => void
}

/** A command a panel accepts through `PanelHandle.run`. */
export interface PanelCommand {
  /** One line for whoever calls it, including what `args` it takes. */
  description?: string
  run: (args: Record<string, unknown>) => unknown
}

/** What a mounted panel exposes about itself (see `PanelContext.expose`). */
export interface PanelApi {
  /** A small, JSON-able summary of what the panel is showing. */
  describe?: () => unknown
  commands?: Record<string, PanelCommand>
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
  /** Close the panel. `keep` closes it for now but remembers where it was — its geometry and its
   *  workspace tile — so opening the same id again puts it back. Use it when the panel goes away
   *  because its owner did (a workflow switched out), not because the user closed it. */
  close(opts?: { keep?: boolean }): void
  minimize(): void
  restore(): void
  fold(): void
  /** Toggle maximize: fill the viewport, or restore the prior float rect. */
  maximize(): void
  /** Bring it into view wherever it lives: un-minimize it, raise a floating one, make a docked
   *  one the active tab of its dock (expanding the dock), switch ComfyUI's sidebar to it when
   *  pinned there, and show the workspace it is tiled in. */
  focus(): void
  setTitle(title: string): void
  /** Swap the icon at runtime (MDI class or image URL/data URI). Not persisted. */
  setIcon(icon: string): void
  /** Dock it (see `DockSide`), or float it with `null`. */
  dock(side: DockSide): void
  /** Resize/move a floating panel; omitted fields unchanged; clamped to viewport + min size.
   *  A docked panel takes its size from its dock — use `docks.set(side, { size })`. */
  setSize(size: { w?: number; h?: number; x?: number; y?: number }, persist?: boolean): void
  /** Where the panel renders, in px — measured, so it is right for a floating, docked, tiled
   *  or sidebar-pinned panel alike. While it isn't showing (minimized, a background dock tab,
   *  another workspace) it is the rect it last laid out to. Null if it isn't open. */
  getRect(): Rect | null
  /** The panel's own summary of its state, if it exposes one and is mounted. */
  describe(): unknown
  /** The commands the panel accepts right now (empty when it exposes none or isn't mounted). */
  commands(): { name: string; description?: string }[]
  /** Run one of the panel's commands; rejects if the panel doesn't offer it. */
  run(command: string, args?: Record<string, unknown>): Promise<unknown>
  on(event: PanelEvent, cb: () => void): () => void
}

/** A reusable panel registered once; the Start menu lists/opens these. */
export interface PanelRegistration {
  id: string
  title: string
  icon?: string
  /** Groups entries under an owning plugin in the Start menu. */
  plugin?: string
  logo?: string
  /** Plugin version (e.g. "0.3.1"), shown in Zen Settings. */
  version?: string
  /** Allow multiple live instances (default false = singleton). */
  multi?: boolean
  /** Hide from the Start menu; opened only programmatically. */
  spawnOnly?: boolean
  /** Persist + restore geometry/state (default true). */
  persist?: boolean
  open: (instanceId?: string) => PanelHandle
  render?: (container: HTMLElement, ctx?: PanelContext) => void | (() => void)
}

/** A long-running task reporting progress: from Python over the `zenkit.job` websocket event,
 *  or from the frontend through `jobs.start`. `total` 0 means indeterminate. */
export interface Job {
  id: string
  name: string
  status: JobStatus
  current: number
  total: number
  message: string
  startedAt: number
  updatedAt: number
  /** Who is doing the work (a plugin name), shown beside the job. */
  source?: string
}

export interface JobStartOptions {
  /** Defaults to a fresh id. Starting with the id of a job still running continues it: it keeps
   *  its progress and start time, and takes only the options given here. */
  id?: string
  total?: number
  message?: string
  source?: string
}

export interface JobUpdate {
  current?: number
  total?: number
  message?: string
}

/** A frontend job, returned by `jobs.start`. Finish it with `done` or `fail`. */
export interface JobHandle {
  readonly id: string
  update(progress: JobUpdate): void
  done(message?: string): void
  fail(message?: string): void
}

/** An image (or video / audio) published to a channel (the named media bus). */
export interface ChannelImage {
  channel: string
  url: string
  /** Its media ref when known (see `ZenMedia`), so it can be handed on to other capabilities. */
  ref?: string
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
  /** Its media ref, when the producer knows it. Otherwise ZenKit derives one: from
   *  `filename`/`subfolder`/`type` for a ComfyUI file, else the `url` itself. */
  ref?: string
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
  /** The startup sequence ComfyUI shows while loading, from the next load on.
   *  `preset` names a built-in one (`hearts`, `lotus`); `html` + `css` supply your own,
   *  written into `#splash-loader` (scope the CSS under that id). Without it the
   *  pack still gets ComfyUI's logo, drawn in its colours. */
  splash?: ThemeSplash
}

/** See {@link ThemePack.splash}. */
export interface ThemeSplash {
  preset?: string
  html?: string
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

/** How a background image is scaled into the viewport. Mirrors CSS `background-size`
 *  plus `tile` (repeat at natural size). */
export type BackgroundFit = 'cover' | 'contain' | 'stretch' | 'center' | 'tile'

/** The image background's settings. Every field is optional: a call patches only the keys it
 *  passes, so a fit change never has to restate the url.
 *
 *  `url` is anything the browser can load — an http(s) URL, a `data:` URI, or a same-origin
 *  path such as ComfyUI's `/api/view?filename=…`. */
export interface BackgroundImageOptions {
  url?: string
  fit?: BackgroundFit
  /** 0–1. Below 1 the theme background shows through — a cheap wash without a finish. */
  opacity?: number
}

/** The finish drawn OVER the background and UNDER the nodes: a themed dim plus an optional
 *  frost. It is a CSS layer (`backdrop-filter`), so it costs nothing per frame and composites
 *  over ANY background — the shader grid as readily as an image. */
export interface BackgroundFinish {
  /** 0–100. Veils the background in the theme's own `--zen-bg`, so it tints with the theme
   *  rather than muddying toward black. */
  dim?: number
  /** Frost radius in CSS px (0 = off). Blurs whatever the background layer painted. */
  blur?: number
  /** Saturation of the backdrop, 1 = untouched. < 1 desaturates, > 1 punches. */
  saturate?: number
  /** 0–100. Darkens the edges toward `--zen-bg` so the middle of the graph reads first. */
  vignette?: number
}

/** An overlay pass drawn above the background + finish and below the nodes — grid lines,
 *  scanlines, vignette, whatever. Same contract as a background, but several can be active at
 *  once and each gets its own canvas, so a WebGL background and a 2D effect coexist happily. */
export interface ZenBackgroundEffect {
  id: string
  label: string
  /** Paint order, low → high (default 0). Ties break on registration order. */
  order?: number
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
  /** Point the built-in `image` background at a picture. Applies live when it is active. */
  setImage(opts: BackgroundImageOptions): void
  /** The dim / frost layer over the background. Merges with what is already set. */
  setFinish(finish: BackgroundFinish): void
  /** Overlay passes. Register your own, then switch them on by id. */
  effects: {
    register(fx: ZenBackgroundEffect): void
    /** Enable exactly this set of effects (order is resolved from each effect's `order`). */
    set(ids: string[]): void
    /** Currently enabled effect ids. */
    active(): string[]
    /** All registered effects. */
    list(): { id: string; label: string }[]
    /** 0–100 — how strongly the effect layers read. Applied as layer opacity, so it scales
     *  any effect uniformly, including ones registered by other plugins. */
    setIntensity(pct: number): void
  }
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

/** One opened viewer. Its methods act on that viewer only: once another `open()` has replaced
 *  it, they do nothing. */
export interface ViewerHandle {
  close(): void
  setIndex(index: number): void
}

export interface ViewerOpenOptions {
  /** Which item to show first. */
  index?: number
  /** Called whenever the shown item changes (arrows, thumbnails, slideshow). */
  onIndex?(index: number): void
  /** Called once when this viewer closes — by the user, `close()`, or another `open()`. */
  onClose?(): void
}

/** Shared, host-owned image/video viewer. The lightbox lives once in the host; plugins just
 *  open it (graceful: `@nynxz/zenkit-client`'s openViewer falls back to a new tab when absent). */
export interface ZenViewer {
  /** Open a fullscreen lightbox over `items` at `index`, replacing any open viewer. */
  open(items: ViewerItem[], opts?: ViewerOpenOptions): ViewerHandle
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
  /** Per-app persisted state blob + its setter. Live, like `PanelContext.state`: it reads what
   *  was last set. */
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

/** A full-screen app registered once; launched from the Start menu or programmatically.
 *  An app covers the graph (the "desktop"); the taskbar stays as the way back. */
export interface AppRegistration {
  /** App id (kebab-case), e.g. 'datasets'. Unique within its plugin namespace. */
  id: string
  title: string
  /** MDI class ("mdi mdi-database") OR an image URL / data URI. */
  icon?: string
  /** Groups this app under an owning plugin in the Start menu. */
  plugin?: string
  /** Route namespace this app's routes live under — its key becomes '<namespace>/<id>'
   *  (e.g. 'zendatasets/datasets'). Injected by registerZenPlugin (explicit
   *  ZenPluginDef.namespace, else a slug of the display `plugin` name). */
  namespace?: string
  logo?: string
  /** Plugin version (e.g. "0.3.1"), shown in Zen Settings. */
  version?: string
  /** Hide from the Start menu; opened only programmatically. */
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

/* ───────────────────────────── capabilities ───────────────────────────── */

/** A JSON Schema for a capability's arguments (an object schema; a subset is enough). */
export interface CapabilitySchema {
  type: 'object'
  properties?: Record<string, Record<string, unknown>>
  required?: string[]
}

/** What a running capability gets besides its arguments. */
export interface CapabilityContext {
  /** Aborted when the caller gives up (e.g. the user stops an agent turn). */
  signal: AbortSignal
}

/** A named action a plugin offers to the rest of ZenKit — and to agents, which see every
 *  registered capability as a tool. Ids are `<plugin>.<action>` (e.g. `stash.search`). */
export interface Capability {
  id: string
  /** What it does, written for whoever calls it (an agent reads exactly this). */
  description: string
  params?: CapabilitySchema
  /** `read` only looks; `write` changes something (graph, files, panels). Default `read`. */
  effect?: 'read' | 'write'
  /** Owning plugin's id; `registerZenPlugin` fills it in. */
  plugin?: string
  /** Return something JSON-able: it is what the caller (or the model) gets back. Media in the
   *  result should be given as media refs (see `ZenMedia`). */
  run(args: Record<string, unknown>, ctx: CapabilityContext): unknown
}

/** A capability as listed: everything but `run`. */
export type CapabilityInfo = Omit<Capability, 'run'>

export interface ZenCapabilities {
  /** Register (or replace) a capability; returns its unregister. */
  register(capability: Capability): () => void
  list(): CapabilityInfo[]
  get(id: string): CapabilityInfo | null
  /** Run a capability by id; rejects when it is unknown or throws. */
  run(id: string, args?: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<unknown>
  /** Called whenever capabilities are registered or removed. */
  onChange(cb: () => void): () => void
}

/* ───────────────────────────────── media ──────────────────────────────── */

/** A short string naming one image / video / audio wherever it lives, so results can be
 *  handed from one capability to the next. Built in: ComfyUI files as
 *  `output/<subfolder/>name.png` (also `input/…`, `temp/…`); plugins add their own prefixes
 *  (e.g. `stash:…`); any http(s) or data URL also works. */
export type MediaRef = string

export interface MediaInfo {
  ref: MediaRef
  url: string
  kind: 'image' | 'video' | 'audio'
  label?: string
}

/** Resolves the refs under one prefix (everything before the first ':' or '/'). */
export interface MediaSource {
  prefix: string
  resolve(ref: MediaRef): MediaInfo | Promise<MediaInfo>
  /** Make the media loadable by ComfyUI's loader nodes; returns the value for their file
   *  widget (e.g. `name.png [output]`). Omit when the source can't. */
  toInput?(ref: MediaRef): Promise<string>
}

export interface ZenMedia {
  registerSource(source: MediaSource): () => void
  resolve(ref: MediaRef): Promise<MediaInfo>
  /** A ComfyUI loader widget value for the media, copying it into the input folder if needed. */
  toInput(ref: MediaRef): Promise<string>
  /** The ref for a ComfyUI file, as `executed` / history outputs describe them. */
  fromComfyFile(file: { filename: string; subfolder?: string; type?: string }): MediaRef
}

/* ─────────────────────────────── plugins ────────────────────────────────── */

/** A summary of everything one plugin contributes, recorded in the introspection
 *  registry. `registerZenPlugin` (from @nynxz/zenkit-client) builds this and reports it via
 *  `plugins.register`; the Zen Inspector reads it back. Only the client (browser) surfaces are
 *  recorded here; the Inspector joins the record to the pack on disk (its nodes, pyproject
 *  identity, git ref) from its own `/zeninspector/inspect` route, matching `id` against the
 *  pack's `[tool.zenkit] id`. Keep these summaries flat and serializable — they describe
 *  registrations, they don't carry render fns. */
export interface RegisteredPlugin {
  /** Canonical kebab id — the single identity that derives the namespace and the prefix of
   *  short panel / taskbar-widget / capability ids. The Inspector joins client + Python by it. */
  id: string
  /** Display name (the Start-menu group name). */
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
  /** Capability ids this plugin offers. */
  capabilities: string[]
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

/* ──────────────────────────── chrome & layout ───────────────────────────── */

/** ZenKit's chrome preferences — the same switches Zen Settings shows. Each persists in this
 *  browser (localStorage) and applies at once. */
export interface ChromeSettings {
  /** Which edge the taskbar sits on. */
  taskbarPos: 'top' | 'bottom'
  /** The bottom taskbar as an inset, rounded card over the canvas instead of an embedded strip.
   *  Only the bottom taskbar floats; on top it is ignored. */
  floatingTaskbar: boolean
  /** Hide ComfyUI's sidebar-bottom buttons and list them in the Start menu instead. */
  absorbComfyButtons: boolean
  /** Show ComfyUI's canvas controls in the taskbar (the `zenkit:canvas-controls` widget). */
  absorbCanvasControls: boolean
  /** Mirror the active app route into the URL hash (`#zen=…`) for shareable links and browser
   *  back/forward. Off by default, and refused (it stays false) while ComfyUI's own router owns
   *  the hash, which it does inside ComfyUI. */
  appUrlSync: boolean
  /** Slide ComfyUI's left toolbar away until the screen edge is hovered. */
  sidebarAutohide: boolean
  /** Restyle ComfyUI's open sidebar as a floating card. */
  floatingSidebar: boolean
  /** Verbose `ZenKit` console logging. */
  debug: boolean
}

/** The Start button's brand. `logo` is an image URL / data URI or an MDI class. */
export interface Branding {
  logo: string
  title: string
}

/** A workspace: a named surface that covers the graph and tiles panels side by side. */
export interface WorkspaceInfo {
  id: string
  name: string
}

/** One of ZenKit's docks: its tabs in order and how it is laid out. */
export interface DockState {
  /** Ids of the panels docked here, in tab order (minimized ones aren't listed). */
  members: string[]
  /** The tab that shows, or null when the dock is empty. */
  active: string | null
  /** Requested extent in px — width for a side dock, height for the bottom one. Layout clamps
   *  it to the window. */
  size: number
  /** Folded to its tab rail. */
  collapsed: boolean
}

/* ───────────────────────────────── root API ─────────────────────────────── */

export interface ZenKitApi {
  version: string
  ready: Promise<ZenKitApi>
  /** semver-ish guard, e.g. require('^1.0.0'). */
  require(range: string): boolean

  panels: {
    /** Open a panel. A string opens the registered panel with that id — a new instance for a
     *  `multi` panel — or brings an already-open panel with that id into view; null when there
     *  is neither. A `PanelSpec` opens an ad-hoc panel (focusing it if its id is already open). */
    open(spec: PanelSpec): PanelHandle
    open(id: string): PanelHandle | null
    /** Close a panel. `keep` remembers its place for when the same id opens again (see
     *  `PanelHandle.close`). */
    close(id: string, opts?: { keep?: boolean }): void
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

  /** Running jobs plus those that finished in the last minute. Mirrored on the bus as
   *  'job' / 'job:<id>'. */
  jobs: {
    list(): Job[]
    get(id: string): Job | null
    on(cb: (job: Job) => void): () => void
    start(name: string, opts?: JobStartOptions): JobHandle
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
   *  panels / apps / widgets / themes / etc. `registerZenPlugin` reports into this; the Zen
   *  Inspector reads it back (joining each record to its pack on disk via `/zeninspector/inspect`). */
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

  /** Named actions plugins offer each other and agents (see `Capability`). */
  capabilities: ZenCapabilities

  /** Media refs: one string per image/video/audio, resolvable to a URL or a loader input. */
  media: ZenMedia

  /** Full-screen apps + a built-in namespaced router. An app covers the graph (the
   *  "desktop"); routes inside it are addressed `<appId>/<route>` (e.g. 'datasets/item/42').
   *  The graph stays live underneath, so apps keep using jobs / channels / the backend. */
  apps: {
    /** Register a full-screen app. Registering a key that exists replaces it, like
     *  `panels.register`. Returns an unregister fn that removes only this registration. */
    register(reg: AppRegistration): () => void
    /** All registered apps (drives the Start menu). */
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

  /** ZenKit's chrome preferences (taskbar, sidebar, debug logging) — what Zen Settings shows. */
  chrome: {
    get(): ChromeSettings
    /** Change some settings; the rest stay. Persisted, and applied at once. */
    set(patch: Partial<ChromeSettings>): void
    /** Called with the new settings after any change, from here or from Zen Settings. */
    onChange(cb: (settings: ChromeSettings) => void): () => void
  }

  /** White-label the taskbar's Start button. */
  branding: {
    /** The brand that shows: the user's Zen Settings override, else the distributor's, else
     *  ComfyUI's own name and logo — field by field. */
    get(): Branding
    /** Set the distributor's brand. `''` for a field clears it. Not persisted: call it on every
     *  load. A local override typed into Zen Settings still wins over it. */
    set(branding: Partial<Branding>): void
  }

  /** Workspaces: named surfaces that cover the graph and tile panels. At most one is on
   *  screen; none means the graph itself. */
  workspaces: {
    list(): WorkspaceInfo[]
    /** The workspace on screen, or null when the graph is showing. */
    current(): string | null
    /** Add a workspace (named "Workspace <n>" by default) and return its id. It isn't shown. */
    create(name?: string): string
    /** Show a workspace, or the graph with `null`. Unknown ids are ignored. */
    activate(id: string | null): void
    rename(id: string, name: string): void
    /** Remove a workspace; its panels float again. The last workspace can't be removed. */
    remove(id: string): void
    /** Tile an open panel into the current workspace (or the last one shown) and show it. */
    tile(panelId: string): void
    /** Called when workspaces are added, removed or renamed, or another one is shown. */
    onChange(cb: (current: string | null) => void): () => void
  }

  /** ZenKit's docks. The bottom dock has no rail of its own: the taskbar is its tab strip. */
  docks: {
    get(side: DockZoneSide): DockState
    /** Pick the tab that shows (a panel docked on that side), resize, or fold the dock. */
    set(side: DockZoneSide, patch: { active?: string; size?: number; collapsed?: boolean }): void
  }
}

declare global {
  interface Window {
    ZenKit?: ZenKitApi
    /** Set by the ComfyUI-ZenKit host as soon as its script loads, before the runtime
     *  installs, so `whenZen` knows to wait for `zen:ready` instead of timing out. */
    ZenKitPending?: boolean
  }
}
