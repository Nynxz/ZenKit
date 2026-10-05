# API reference

The whole `window.ZenKit` object, then every export of `@nynxz/zenkit-client`. Import types from
`@nynxz/zenkit-client`, which owns the contract, with `import type`. One line per member; follow
the links for details.

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
| `open`       | `(id: string) => PanelHandle \| null` (registered id) |
| `close`      | `(id: string, opts?: { keep?: boolean }) => void`     |
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

### `workspaces` ([guide](Panels-and-Workspaces.md#zenworkspaces))

| Member     | Signature                                               |
| ---------- | ------------------------------------------------------- |
| `list`     | `() => WorkspaceInfo[]` (`{ id, name }`)                |
| `current`  | `() => string \| null`                                  |
| `create`   | `(name?: string) => string`                             |
| `activate` | `(id: string \| null) => void`                          |
| `rename`   | `(id: string, name: string) => void`                    |
| `remove`   | `(id: string) => void`                                  |
| `tile`     | `(panelId: string) => void`                             |
| `onChange` | `(cb: (current: string \| null) => void) => () => void` |

### `docks` ([guide](Panels-and-Workspaces.md#zendocks))

| Member | Signature                                                                    |
| ------ | ---------------------------------------------------------------------------- |
| `get`  | `(side: DockZoneSide) => DockState` (`{ members, active, size, collapsed }`) |
| `set`  | `(side: DockZoneSide, patch: { active?; size?; collapsed? }) => void`        |

`DockZoneSide` is `'left' | 'right' | 'bottom'`.

### `chrome` ([guide](Storage-and-Bus.md#chrome-settings))

| Member     | Signature                                         |
| ---------- | ------------------------------------------------- |
| `get`      | `() => ChromeSettings`                            |
| `set`      | `(patch: Partial<ChromeSettings>) => void`        |
| `onChange` | `(cb: (s: ChromeSettings) => void) => () => void` |

### `branding` ([guide](Storage-and-Bus.md#branding))

| Member | Signature                            |
| ------ | ------------------------------------ |
| `get`  | `() => Branding` (`{ logo, title }`) |
| `set`  | `(b: Partial<Branding>) => void`     |

### Globals

| Name                       | Meaning                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `window.ZenKit`            | The API, once installed.                                            |
| `window.ZenKitPending`     | `true` from the moment ComfyUI-ZenKit's script loads until install. |
| `zen:ready` (window event) | Fired when the runtime installs, or fails to.                       |

## `@nynxz/zenkit-client`

The client exports only what adds something over `window.ZenKit`: a fallback when ZenKit is
absent, the one-call plugin registration, Vue integration, and DOM and drag helpers. For
everything else, call the runtime directly:

```ts
import { getZenKit, whenZen } from '@nynxz/zenkit-client'

const zen = await whenZen() // null when ZenKit isn't installed
zen?.bus.emit('myplugin:selected', { id: 42 })
const off = zen?.channels.subscribe('preview', (img) => show(img)) ?? (() => {})

getZenKit()?.apps.navigate('datasets/item/42') // sync code, once ZenKit is up
```

See [Working without ZenKit](Working-Without-ZenKit.md) for what each export does when ZenKit is
absent.

### Detection

| Export                | Signature                                          | Notes                                                                                                                            |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `getZenKit`           | `() => ZenKitApi \| null`                          | Synchronous                                                                                                                      |
| `hasZenKit`           | `() => boolean`                                    |                                                                                                                                  |
| `whenZen`             | `(timeout?: number) => Promise<ZenKitApi \| null>` | Waits as long as installing takes once `window.ZenKitPending` is set. After one call has timed out, later calls resolve at once. |
| `ZEN_CONNECT_TIMEOUT` | `6000`                                             |                                                                                                                                  |

### Registration

| Export              | Signature                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `registerZenPlugin` | `(def: ZenPluginDef) => Promise<ZenPluginHandle>` ([guide](Your-First-Plugin.md#registerzenplugin-at-a-glance)) |
| `ZenPluginDef`      | type: the plugin definition                                                                                     |
| `ZenPluginHandle`   | type: `{ connected, zen, unregister }`                                                                          |
| `ZenPanelDef`       | type: a panel in `panels` ([guide](Panels-and-Workspaces.md#zenpaneldef))                                       |
| `ZenAppDef`         | type: an app in `apps` ([guide](Apps-and-Routing.md#zenappdef--appregistration))                                |

Ids in a `ZenPluginDef` follow one rule. What the plugin owns is namespaced by its `id` when given
short: panels and taskbar widgets become `<id>:<short>`, capabilities `<id>.<short>`. An id that
already contains the separator is kept as given. Channels, themes and backgrounds are global by
design and never prefixed: plugins share them on purpose.

### Vue

| Export        | Signature                                                          |
| ------------- | ------------------------------------------------------------------ |
| `mountVue`    | `(component, props?) => (el, ctx?) => () => void`                  |
| `useJob`      | `(match: (job: Job) => boolean) => DeepReadonly<Ref<Job \| null>>` |
| `useLightbox` | `() => Lightbox` (`isOpen`, `index`, `open`, `show`, `close`)      |
| `Lightbox`    | type                                                               |

### Fallbacks

| Export       | Signature                                                                          | Without ZenKit                              |
| ------------ | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| `startJob`   | `(name, opts?) => Promise<JobHandle>`                                              | A handle that does nothing                  |
| `openViewer` | `(items: ViewerItem[], opts?: ViewerOpenOptions) => Promise<ViewerHandle \| null>` | Opens the item in a new tab, returns `null` |

### Media and drag and drop ([guide](Channels-and-Media.md#drag-and-drop))

| Export                                      | Signature                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `thumbUrl`                                  | `(ref: { filename; subfolder?; type? }, size = 256) => string`             |
| `mediaKindOf`                               | `(nameOrUrl: string) => 'image' \| 'video' \| 'audio'` (GIF is an image)   |
| `setImageDragData`                          | `(e: DragEvent, img, dragImage?) => void`                                  |
| `readImageDragData`                         | `(e: DragEvent) => DroppedImage[]`                                         |
| `hasImageDragData`                          | `(e: DragEvent) => boolean`                                                |
| `setMediaListDragData`                      | `(e: DragEvent, list: MediaListRef) => void`                               |
| `readMediaListDrop`                         | `(e: DragEvent) => Promise<{ title?; items: DroppedImage[] }>`             |
| `ZEN_IMAGE_MIME`                            | `'application/x-zenkit-image'`                                             |
| `COMFY_ASSET_MIME`                          | `'application/x-comfy-asset-info'`                                         |
| `LAST_CHANNEL`                              | `'$last'`: the channel to subscribe to for the newest image on any channel |
| `ZEN_MEDIA_LIST_MIME`                       | `'application/x-zenkit-media-list'`                                        |
| `ComfyAssetType`                            | type: `'input' \| 'output' \| 'temp'`                                      |
| `DroppedImage`, `MediaListRef`, `MediaList` | types                                                                      |

### Contract types

The `window.ZenKit` contract, types only: `ZenKitApi`, `PanelSpec`, `PanelHandle`, `PanelContext`,
`PanelApi`, `PanelCommand`, `PanelRegistration`, `PanelStatus`, `PanelEvent`, `DockSide`,
`DockZoneSide`, `DockState`, `WorkspaceInfo`, `ChromeSettings`, `Branding`, `Rect`,
`AppRegistration`, `AppRoute`, `AppHandle`, `AppRouter`, `AppLocation`, `RouteContext`, `Job`,
`JobStatus`, `JobStartOptions`, `JobUpdate`, `JobHandle`, `ChannelImage`, `ChannelInput`,
`TaskbarWidget`, `ThemePack`, `ThemeSplash`, `ThemeMode`, `ZenStore`, `ZenStorage`,
`ZenBackground`, `ZenBackgroundEffect`, `ZenBackgrounds`, `BackgroundContext`, `BackgroundFit`,
`BackgroundImageOptions`, `BackgroundFinish`, `SlotMatch`, `SlotMiddleClickCtx`, `ZenGraph`,
`ViewerItem`, `ViewerHandle`, `ViewerOpenOptions`, `ZenViewer`, `Capability`, `CapabilityInfo`,
`CapabilitySchema`, `CapabilityContext`, `ZenCapabilities`, `MediaRef`, `MediaInfo`, `MediaSource`,
`ZenMedia`, `RegisteredPlugin`, `ZenPlugins`, `BusHandler`.
