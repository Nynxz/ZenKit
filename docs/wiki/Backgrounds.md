# Backgrounds

ZenKit can draw a background behind the node graph: an interactive WebGL grid, a picture, or one
you register. Over it sit a **finish** (dim, frost, vignette) and optional **effects** (extra
overlay passes such as grid lines). All of it pans and zooms with the graph and takes its colours
from the active theme.

## Minimal example

```ts
import { registerZenPlugin, type ZenBackground } from '@nynxz/zenkit-client'

const pulse: ZenBackground = {
  id: 'myplugin-pulse',
  label: 'Pulse',
  init: (ctx) => ({ g: ctx.layer.getContext('2d')! }),
  frame(ctx, state) {
    const { g } = state as { g: CanvasRenderingContext2D }
    const a = 0.5 + 0.5 * Math.sin(ctx.time / 600)
    g.fillStyle = ctx.color('--zen-bg')
    g.fillRect(0, 0, ctx.w, ctx.h)
    g.globalAlpha = a * 0.3
    g.fillStyle = ctx.color('--zen-accent')
    g.beginPath()
    g.arc(ctx.mouse.x, ctx.mouse.y, 80 * ctx.dpr, 0, Math.PI * 2)
    g.fill()
    g.globalAlpha = 1
  },
}

const { zen } = await registerZenPlugin({
  id: 'myplugin',
  plugin: 'My Plugin',
  backgrounds: [pulse],
})
zen?.background.set('myplugin-pulse')
```

## What users control

ComfyUI Settings → **ZenKit → Canvas**. These are native ComfyUI settings that mirror ZenKit's
own background state: an edit there applies here, and a change made through the API is written
back there.

| Setting                                    | Default          | Maps to                    |
| ------------------------------------------ | ---------------- | -------------------------- |
| Graph background                           | off              | on/off                     |
| Background                                 | Interactive Grid | which background           |
| Background image, Image fit, Image opacity | none, cover, 100 | `setImage`                 |
| Dim, Frost (blur), Vignette                | 0, 0, 0          | `setFinish`                |
| Overlay effect                             | None             | `effects.set` (one effect) |
| Effect strength                            | 60               | `effects.setIntensity`     |
| Cursor follow, Follow speed, Blob flow     |                  | grid cursor behaviour      |

ZenKit saves the background state itself (`localStorage`, `zenkit.bg.v2`), so a `set`, `setImage`,
`setFinish` or `effects.set` from any plugin survives a reload, and the values ComfyUI replays on
load don't overwrite it. (On the first load after upgrading, before ZenKit has saved anything, the
stored settings seed it once.) The Background and Overlay effect dropdowns list the live
registries, so a background or effect a plugin registers at any point shows up there. A saved
choice whose plugin registers late is kept, and switches on when it registers.

## Built-ins

| Kind       | Id          | Label                                  |
| ---------- | ----------- | -------------------------------------- |
| Background | `grid`      | Interactive Grid (WebGL2, 2D fallback) |
| Background | `image`     | Image                                  |
| Effect     | `gridlines` | Mecha grid (`order: 10`)               |

## API

| `window.ZenKit.background`                         | Meaning                                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `register(bg)`                                     | Add a `ZenBackground`. Re-registering an id replaces it.                                |
| `set(id)`                                          | Activate a registered background by id; `null` or `'none'` turns it off. Persisted.     |
| `current()`                                        | Active id or `null`.                                                                    |
| `list()`                                           | `{ id, label }[]`                                                                       |
| `setImage({ url?, fit?, opacity? })`               | Configure the `image` background. Only the keys you pass change. Does not switch to it. |
| `setFinish({ dim?, blur?, saturate?, vignette? })` | Merge into the finish.                                                                  |
| `effects.register(fx)`                             | Add a `ZenBackgroundEffect`.                                                            |
| `effects.set(ids)`                                 | Enable exactly these effects. An id not registered yet switches on when it registers.   |
| `effects.active()`                                 | Enabled ids.                                                                            |
| `effects.list()`                                   | `{ id, label }[]`                                                                       |
| `effects.setIntensity(pct)`                        | 0–100, applied as layer opacity to every effect.                                        |

## Image background

```ts
zen.background.setImage({
  url: '/api/view?filename=bg.png&type=input',
  fit: 'contain',
  opacity: 0.8,
})
zen.background.set('image')
```

| Option    | Values                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `url`     | http(s), `data:`, or a same-origin path such as ComfyUI's `/api/view?…`                                   |
| `fit`     | `'cover'`, `'contain'`, `'stretch'`, `'center'`, `'tile'`. Letterboxing uses the theme background colour. |
| `opacity` | 0–1. Below 1 the theme background shows through.                                                          |

## Finish

A CSS `backdrop-filter` layer over the background and under the nodes. It costs nothing per frame
and works over any background.

| Field      | Range         | Effect                               |
| ---------- | ------------- | ------------------------------------ |
| `dim`      | 0–100         | Veil in the theme's `--zen-bg`.      |
| `blur`     | px, 0 = off   | Frost.                               |
| `saturate` | 1 = untouched | Below 1 desaturates, above 1 boosts. |
| `vignette` | 0–100         | Darken edges toward `--zen-bg`.      |

## Writing a background

```ts
interface ZenBackground {
  id: string
  label: string
  init?(ctx: BackgroundContext): unknown // returns your state
  frame(ctx: BackgroundContext, state: unknown): void
  dispose?(state: unknown): void
}
```

`ZenBackgroundEffect` is the same plus `order?: number` (paint order, low first). Each effect gets
its own transparent canvas, so a WebGL background and 2D effects can coexist. Several effects can
be active at once.

### `BackgroundContext`

| Field                      | Meaning                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `layer`                    | Your canvas, device-pixel sized. Create your own 2D or WebGL context on it.                    |
| `w`, `h`, `dpr`            | Layer size in device pixels, device pixel ratio.                                               |
| `scale`, `offset`          | Graph zoom and pan (LiteGraph `ds.scale` / `ds.offset`).                                       |
| `mouse`                    | `{ x, y, over }` in device px; `over` is false when the cursor is off the canvas.              |
| `trail`                    | Recent cursor path in graph space: `pts` (flat x,y list), `radii`, `n`. `n < 2` means no tail. |
| `time`, `dt`               | ms timestamps for animation.                                                                   |
| `color(cssVar, fallback?)` | Resolve a token such as `'--zen-accent'` to a canvas-usable colour (handles `oklch`).          |

Gotchas:

- If `frame` throws, the background is switched off; if an effect's `frame` throws, that effect is
  dropped. Errors are logged.
- Rendering pauses while a workspace covers the graph.
- Effects are only drawn while a background is active.
- `dispose` runs on every switch away, including a toggle of the setting; free GPU resources there.
