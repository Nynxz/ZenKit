# API reference

The whole `window.ZenKit` object, then every export of `@nynxz/zenkit-client`. Import types from
`@nynxz/zenkit-client` (it re-exports `@nynxz/zenkit-types`). One line per member; follow the
links for details.

## `window.ZenKit`

### Root

| Member    | Signature                    | Notes                                            |
| --------- | ---------------------------- | ------------------------------------------------ |
| `version` | `string`                     | `'0.2.0'`                                        |
| `ready`   | `Promise<ZenKitApi>`         | Resolves once installed.                         |
| `require` | `(range: string) => boolean` | Supports `^x.y.z`, `>=x.y.z` and exact versions. |

### `panels` ([guide](Panels-and-Workspaces.md))

| Member       | Signature                                             |
| ------------ | ----------------------------------------------------- |
| `open`       | `(spec: PanelSpec) => PanelHandle`                    |
| `close`      | `(id: string) => void`                                |
| `get`        | `(id: string) => PanelHandle \| null`                 |
| `list`       | `() => string[]`                                      |
| `register`   | `(reg: PanelRegistration) => () => void`              |
| `registered` | `() => PanelRegistration[]`                           |
| `instances`  | `(typeId: string) => { id: string; title: string }[]` |

### `apps` ([guide](Apps-and-Routing.md))

| Member            | Signature                                                  |
| ----------------- | ---------------------------------------------------------- |
| `register`        | `(reg: AppRegistration) => () => void`                     |
| `registered`      | `() => AppRegistration[]`                                  |
| `open`            | `(idOrKey: string, opts?: { path?; query? }) => AppHandle` |
| `close`           | `() => void`                                               |
| `restore`         | `() => boolean`                                            |
| `minimized`       | `() => AppLocation \| null`                                |
| `current`         | `() => string \| null`                                     |
| `navigate`        | `(path: string, opts?: { query?; replace? }) => void`      |
| `back`, `forward` | `() => void`                                               |
| `location`        | `() => AppLocation`                                        |
| `on`              | `(cb: (loc: AppLocation) => void) => () => void`           |

### `theme` ([guide](Themes.md))

| Member         | Signature                                    |
| -------------- | -------------------------------------------- |
| `tokens`       | `readonly string[]` (the `--zen-*` names)    |
| `packs`        | `() => string[]`                             |
| `packLabel`    | `(id: string) => string`                     |
| `packModes`    | `(id: string) => ThemeMode[]`                |
| `setPack`      | `(id: string) => void`                       |
| `current`      | `() => string`                               |
| `currentMode`  | `() => ThemeMode`                            |
| `setMode`      | `(mode: ThemeMode) => void`                  |
| `onChange`     | `(cb: (pack: string) => void) => () => void` |
| `registerPack` | `(pack: ThemePack) => boolean`               |

### `bus` ([guide](Storage-and-Bus.md#bus))

| Member | Signature                                       |
| ------ | ----------------------------------------------- |
| `on`   | `(event: string, cb: BusHandler) => () => void` |
| `emit` | `(event: string, payload?: unknown) => void`    |
| `off`  | `(event: string, cb: BusHandler) => void`       |

### `jobs` ([guide](Jobs.md))

| Member  | Signature                                             |
| ------- | ----------------------------------------------------- |
| `list`  | `() => Job[]`                                         |
| `get`   | `(id: string) => Job \| null`                         |
| `on`    | `(cb: (job: Job) => void) => () => void`              |
| `start` | `(name: string, opts?: JobStartOptions) => JobHandle` |

### `channels` ([guide](Channels-and-Media.md#channels))

| Member      | Signature                                                          |
| ----------- | ------------------------------------------------------------------ |
| `publish`   | `(channel: string, img: ChannelInput) => void`                     |
| `declare`   | `(channel: string, opts?: { label? }) => void`                     |
| `get`       | `(channel: string) => ChannelImage \| null`                        |
| `last`      | `() => ChannelImage \| null`                                       |
| `list`      | `() => string[]`                                                   |
| `subscribe` | `(channel: string, cb: (img: ChannelImage) => void) => () => void` |

### `media` ([guide](Channels-and-Media.md#media-refs))

| Member           | Signature                                             |
| ---------------- | ----------------------------------------------------- |
| `registerSource` | `(source: MediaSource) => () => void`                 |
| `resolve`        | `(ref: MediaRef) => Promise<MediaInfo>`               |
| `toInput`        | `(ref: MediaRef) => Promise<string>`                  |
| `fromComfyFile`  | `(file: { filename; subfolder?; type? }) => MediaRef` |

### `viewer` ([guide](Channels-and-Media.md#viewer))

| Member  | Signature                                                         |
| ------- | ----------------------------------------------------------------- |
| `open`  | `(items: ViewerItem[], opts?: ViewerOpenOptions) => ViewerHandle` |
| `close` | `() => void`                                                      |

### `capabilities` ([guide](Capabilities.md))

| Member     | Signature                                                     |
| ---------- | ------------------------------------------------------------- |
| `register` | `(capability: Capability) => () => void`                      |
| `list`     | `() => CapabilityInfo[]`                                      |
| `get`      | `(id: string) => CapabilityInfo \| null`                      |
| `run`      | `(id: string, args?, opts?: { signal? }) => Promise<unknown>` |
| `onChange` | `(cb: () => void) => () => void`                              |

### `taskbar` ([guide](Panels-and-Workspaces.md#taskbar-widgets))

| Member     | Signature                               |
| ---------- | --------------------------------------- |
| `register` | `(widget: TaskbarWidget) => () => void` |

### `background` ([guide](Backgrounds.md))

| Member                 | Signature                                |
| ---------------------- | ---------------------------------------- |
| `register`             | `(bg: ZenBackground) => void`            |
| `set`                  | `(id: string \| null) => void`           |
| `current`              | `() => string \| null`                   |
| `list`                 | `() => { id; label }[]`                  |
| `setImage`             | `(opts: BackgroundImageOptions) => void` |
| `setFinish`            | `(finish: BackgroundFinish) => void`     |
| `effects.register`     | `(fx: ZenBackgroundEffect) => void`      |
| `effects.set`          | `(ids: string[]) => void`                |
| `effects.active`       | `() => string[]`                         |
| `effects.list`         | `() => { id; label }[]`                  |
| `effects.setIntensity` | `(pct: number) => void`                  |

### `storage` ([guide](Storage-and-Bus.md#storage))

| Member            | Signature                                   |
| ----------------- | ------------------------------------------- |
| `local`, `server` | `ZenStore` (`get`, `set`, `remove`, `keys`) |
| `scope`           | `(name: string) => ZenStorage`              |

### `graph`

Override middle-click on a node slot to spawn and wire a companion node instead of ComfyUI's
default. A no-op off-canvas or on ComfyUI builds where the hook isn't reachable.

| Member              | Signature                                                                        |
| ------------------- | -------------------------------------------------------------------------------- |
| `slotLink`          | `(spec: { on: SlotMatch; spawn: string }) => () => void`                         |
| `onSlotMiddleClick` | `(match: SlotMatch, handler: (ctx: SlotMiddleClickCtx) => void) => () => void`   |
| `createNode`        | `(type: string, pos?: [number, number]) => unknown` (you still `graph.add()` it) |

`SlotMatch` is `{ node, output? }` or `{ node, input? }` (node type id and slot name).
`SlotMiddleClickCtx` gives `node`, `slotIndex`, `slotName`, `isOutput`, `graph`, `pos`,
`spawn(type)` (create and auto-connect; preferred) and `createNode(type, pos?)`.

```ts
registerZenPlugin({
  id: 'myplugin',
  plugin: 'My Plugin',
  slotLinks: [{ on: { node: 'MyLoader', output: 'IMAGE' }, spawn: 'PreviewImage' }],
})
```

### `plugins`

The ownership ledger the Zen Inspector reads. `registerZenPlugin` reports into it for you.

| Member       | Signature                                  |
| ------------ | ------------------------------------------ |
| `register`   | `(plugin: RegisteredPlugin) => () => void` |
| `registered` | `() => RegisteredPlugin[]`                 |
| `get`        | `(id: string) => RegisteredPlugin \| null` |

### Chrome setters ([guide](Storage-and-Bus.md#chrome-setters))

| Member                    | Signature                                    |
| ------------------------- | -------------------------------------------- |
| `setBranding`             | `(b: { logo?; title? }) => void`             |
| `setTaskbarPos`           | `(pos: 'top' \| 'bottom') => void`           |
| `setMinimizedAnchor`      | `(a: 'left' \| 'center' \| 'right') => void` |
| `setAbsorbComfyButtons`   | `(on: boolean) => void`                      |
| `setAbsorbCanvasControls` | `(on: boolean) => void`                      |
| `setAppUrlSync`           | `(on: boolean) => void`                      |
| `setSidebarAutohide`      | `(on: boolean) => void`                      |
| `setFloatingSidebar`      | `(on: boolean) => void`                      |
| `setDebug`                | `(verbose: boolean) => void`                 |

### Globals

| Name                       | Meaning                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `window.ZenKit`            | The API, once installed.                                            |
| `window.ZenKitPending`     | `true` from the moment ComfyUI-ZenKit's script loads until install. |
| `zen:ready` (window event) | Fired when the runtime installs, or fails to.                       |

## `@nynxz/zenkit-client`

Every async helper waits for the runtime and degrades when it is absent; see
[Working without ZenKit](Working-Without-ZenKit.md).

### Detection

| Export                | Signature                                          |
| --------------------- | -------------------------------------------------- |
| `getZenKit`           | `() => ZenKitApi \| null`                          |
| `hasZenKit`           | `() => boolean`                                    |
| `whenZen`             | `(timeout?: number) => Promise<ZenKitApi \| null>` |
| `ZEN_CONNECT_TIMEOUT` | `6000`                                             |

### Registration

| Export              | Signature                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `registerZenPlugin` | `(def: ZenPluginDef) => Promise<ZenPluginHandle>` ([guide](Your-First-Plugin.md#registerzenplugin-at-a-glance)) |
| `ZenPluginDef`      | type: the plugin definition                                                                                     |
| `ZenPluginHandle`   | type: `{ connected, zen, unregister }`                                                                          |
| `ZenPanelDef`       | type: a panel in `panels` ([guide](Panels-and-Workspaces.md#zenpaneldef))                                       |
| `ZenAppDef`         | type: an app in `apps` ([guide](Apps-and-Routing.md#zenappdef--appregistration))                                |

### Panels and apps

| Export                  | Signature                                           |
| ----------------------- | --------------------------------------------------- |
| `openPanel`             | `(spec: PanelSpec) => Promise<PanelHandle \| null>` |
| `registerPanel`         | `(reg: PanelRegistration) => Promise<() => void>`   |
| `registerZenApp`        | `(reg: AppRegistration) => Promise<() => void>`     |
| `openApp`               | `(id: string, opts?) => Promise<AppHandle \| null>` |
| `navigateApp`           | `(path: string, opts?) => Promise<void>`            |
| `onAppChange`           | `(cb) => Promise<() => void>`                       |
| `registerTaskbarWidget` | `(widget: TaskbarWidget) => Promise<() => void>`    |
| `mountVue`              | `(component, props?) => (el, ctx?) => () => void`   |

### Bus and chrome

| Export        | Signature                                 |
| ------------- | ----------------------------------------- |
| `onBus`       | `(event, cb) => Promise<() => void>`      |
| `emitBus`     | `(event, payload?) => Promise<void>`      |
| `setBranding` | `(b: { logo?; title? }) => Promise<void>` |

### Jobs

| Export     | Signature                                                                |
| ---------- | ------------------------------------------------------------------------ |
| `startJob` | `(name, opts?) => Promise<JobHandle>`                                    |
| `onJob`    | `(cb: (job: Job) => void) => Promise<() => void>`                        |
| `useJob`   | `(match: (job: Job) => boolean) => DeepReadonly<Ref<Job \| null>>` (Vue) |

### Channels and viewer

| Export           | Signature                                                                          |
| ---------------- | ---------------------------------------------------------------------------------- |
| `publishChannel` | `(channel, img: ChannelInput) => Promise<void>`                                    |
| `declareChannel` | `(channel, opts?) => Promise<void>`                                                |
| `onChannel`      | `(channel, cb) => Promise<() => void>`                                             |
| `LAST_CHANNEL`   | `'$last'`                                                                          |
| `openViewer`     | `(items: ViewerItem[], opts?: ViewerOpenOptions) => Promise<ViewerHandle \| null>` |
| `useLightbox`    | `() => Lightbox` (Vue: `isOpen`, `index`, `open`, `show`, `close`)                 |
| `Lightbox`       | type                                                                               |

### Graph

| Export              | Signature                                                         |
| ------------------- | ----------------------------------------------------------------- |
| `registerSlotLink`  | `(spec: { on: SlotMatch; spawn: string }) => Promise<() => void>` |
| `onSlotMiddleClick` | `(match, handler) => Promise<() => void>`                         |

### Media and drag and drop ([guide](Channels-and-Media.md#drag-and-drop))

| Export                                      | Signature                                                      |
| ------------------------------------------- | -------------------------------------------------------------- |
| `thumbUrl`                                  | `(ref: { filename; subfolder?; type? }, size = 256) => string` |
| `mediaKindOf`                               | `(nameOrUrl: string) => 'image' \| 'video' \| 'audio'`         |
| `setImageDragData`                          | `(e: DragEvent, img, dragImage?) => void`                      |
| `readImageDragData`                         | `(e: DragEvent) => DroppedImage[]`                             |
| `hasImageDragData`                          | `(e: DragEvent) => boolean`                                    |
| `setMediaListDragData`                      | `(e: DragEvent, list: MediaListRef) => void`                   |
| `readMediaDrop`                             | `(e: DragEvent) => Promise<{ title?; items: DroppedImage[] }>` |
| `ZEN_IMAGE_MIME`                            | `'application/x-zenkit-image'`                                 |
| `COMFY_ASSET_MIME`                          | `'application/x-comfy-asset-info'`                             |
| `ZEN_MEDIA_LIST_MIME`                       | `'application/x-zenkit-media-list'`                            |
| `ComfyAssetType`                            | type: `'input' \| 'output' \| 'temp'`                          |
| `DroppedImage`, `MediaListRef`, `MediaList` | types                                                          |

### Widget views

A cross-bundle registry (on `window.__zenkitWidgetViews`) mapping a node widget `type` to a
renderer, so one plugin can render another pack's widget. Works without the runtime. ZenKit itself
doesn't call these renderers; the node pack that owns the widget looks one up with `getWidgetView`.

| Export               | Signature                                                                       |
| -------------------- | ------------------------------------------------------------------------------- |
| `registerWidgetView` | `(type: string, view: WidgetView) => void`                                      |
| `getWidgetView`      | `(type: string) => WidgetView \| null`                                          |
| `WidgetView`         | type: `(container: HTMLElement, ctx: { widget; node }) => (() => void) \| void` |
| `WidgetViewCtx`      | type: `{ widget; node }`                                                        |

Also settable as `registerZenPlugin({ widgetViews: { [type]: view } })`.

### Contract types

Re-exported from `@nynxz/zenkit-types`: `ZenKitApi`, `PanelSpec`, `PanelHandle`, `PanelContext`,
`PanelApi`, `PanelCommand`, `PanelRegistration`, `PanelStatus`, `PanelEvent`, `DockSide`, `Rect`,
`AppRegistration`, `AppRoute`, `AppHandle`, `AppRouter`, `AppLocation`, `RouteContext`, `Job`,
`JobStatus`, `JobStartOptions`, `JobUpdate`, `JobHandle`, `ChannelImage`, `ChannelInput`,
`TaskbarWidget`, `ThemePack`, `ThemeSplash`, `ThemeMode`, `ZenStore`, `ZenStorage`,
`ZenBackground`, `ZenBackgroundEffect`, `ZenBackgrounds`, `BackgroundContext`, `BackgroundFit`,
`BackgroundImageOptions`, `BackgroundFinish`, `SlotMatch`, `SlotMiddleClickCtx`, `ZenGraph`,
`ViewerItem`, `ViewerHandle`, `ViewerOpenOptions`, `ZenViewer`, `Capability`, `CapabilityInfo`,
`CapabilitySchema`, `CapabilityContext`, `ZenCapabilities`, `MediaRef`, `MediaInfo`, `MediaSource`,
`ZenMedia`, `RegisteredPlugin`, `ZenPlugins`, `BusHandler`.
