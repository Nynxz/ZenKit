// The canvas background's controls, as NATIVE ComfyUI settings.
//
// They live here rather than in the Zen Settings panel on purpose. ComfyUI's own settings dialog
// persists them (comfy.settings.json), fires `onChange` on load and on every edit, and gives them
// a searchable home next to every other canvas preference — so the background behaves like part of
// ComfyUI rather than a thing hidden behind a ZenKit panel. It also means the settings work before
// any Zen panel is opened.
//
// This is registered by the ComfyUI-ZenKit plugin, not by `@nynxz/zenkit-core`, so that core stays free
// of ComfyUI's settings API and a plugin embedding core doesn't get a second copy of these.
//
// The setters in `@nynxz/zenkit-core` are idempotent and safe to call before the graph canvas exists —
// the background host waits for it — so the ordering here doesn't matter.
//
// Core keeps the background's state itself (so `zen.background` calls from any plugin persist), and
// these settings mirror it: an edit here sets core, a change made through the API is written back
// here. On load ComfyUI replays every stored value through `onChange`; those replays are ignored
// once core has saved a look of its own, so stale settings never overwrite it. Until then (the
// first load after upgrading) they seed it.
import { app } from '@comfy/app'
import {
  backgroundEffectIntensity,
  backgroundEffectList,
  backgroundEffects,
  backgroundEnabled,
  backgroundFinish,
  backgroundImage,
  backgroundKind,
  backgroundList,
  backgroundStored,
  onBackgroundChange,
  setBackgroundBlobFlow,
  setBackgroundEffectIntensity,
  setBackgroundEffects,
  setBackgroundEnabled,
  setBackgroundFinish,
  setBackgroundFollow,
  setBackgroundFollowSpeed,
  setBackgroundImage,
  setBackgroundKind,
} from '@nynxz/zenkit-core'

const ENABLED_ID = 'zenkit.background.enabled'
const KIND_ID = 'zenkit.background.kind'
const IMAGE_URL_ID = 'zenkit.background.imageUrl'
const IMAGE_FIT_ID = 'zenkit.background.imageFit'
const IMAGE_OPACITY_ID = 'zenkit.background.imageOpacity'
const DIM_ID = 'zenkit.background.finishDim'
const BLUR_ID = 'zenkit.background.finishBlur'
const VIGNETTE_ID = 'zenkit.background.finishVignette'
const EFFECT_ID = 'zenkit.background.effect'
const EFFECT_STRENGTH_ID = 'zenkit.background.effectStrength'
const FOLLOW_ID = 'zenkit.background.follow'
const FOLLOW_SPEED_ID = 'zenkit.background.followSpeed'
const BLOB_FLOW_ID = 'zenkit.background.blobFlow'

// ComfyUI builds its settings tree by the FULL category path and assigns `node.data = setting`
// as it walks — so two settings sharing one category array collapse into a single node and only
// the last one registered is ever rendered, with no error. Every path here must therefore be
// unique; the third element is a key, not a group label. What the user reads is `name`, and what
// groups them in the dialog is the second element ('Canvas'). Ordering is `sortOrder`, descending.
const cat = (key: string) => ['ZenKit', 'Canvas', key]

// Read from the live registries each time the dialog renders, so a background or effect another
// plugin registers — at any point — shows up here without this file knowing about it.
const kindOptions = () => backgroundList().map((b) => ({ text: b.label, value: b.id }))
const effectOptions = () => [
  { text: 'None', value: 'none' },
  ...backgroundEffectList().map((f) => ({ text: f.label, value: f.id })),
]

// What each setting reads as, from core's state — compared before applying (so the echo of a
// mirrored write changes nothing) and written back when the API changed it.
const fromCore: Record<string, () => unknown> = {
  [ENABLED_ID]: () => backgroundEnabled(),
  [KIND_ID]: () => backgroundKind(),
  [IMAGE_URL_ID]: () => backgroundImage().url,
  [IMAGE_FIT_ID]: () => backgroundImage().fit,
  [IMAGE_OPACITY_ID]: () => Math.round(backgroundImage().opacity * 100),
  [DIM_ID]: () => backgroundFinish().dim,
  [BLUR_ID]: () => backgroundFinish().blur,
  [VIGNETTE_ID]: () => backgroundFinish().vignette,
  [EFFECT_ID]: () => backgroundEffects()[0] ?? 'none',
  [EFFECT_STRENGTH_ID]: () => backgroundEffectIntensity(),
}

// Settings ComfyUI replays on load seed core only while it has nothing saved; the answer is taken
// at the first replay, before any of them saves.
let seedFromSettings: boolean | null = null
function mirrored<T>(id: string, apply: (value: T) => void) {
  return (value: T, oldValue?: unknown) => {
    if (oldValue === undefined) {
      seedFromSettings ??= !backgroundStored()
      if (!seedFromSettings) return
    }
    if (value === fromCore[id]!()) return
    apply(value)
  }
}

type SettingsApi = {
  get(id: string): unknown
  set(id: string, value: unknown): Promise<void> | void
}
const settingsApi = () =>
  (app as unknown as { extensionManager?: { setting?: SettingsApi } }).extensionManager?.setting

// Write core's state back into the settings, so the dialog shows what the API set. Batched: an
// API caller dragging a value would otherwise save the settings file on every step.
let mirrorTimer = 0
function mirrorToSettings() {
  clearTimeout(mirrorTimer)
  mirrorTimer = window.setTimeout(() => {
    const s = settingsApi()
    if (!s) return
    for (const [id, read] of Object.entries(fromCore)) {
      const value = read()
      if (s.get(id) === value) continue
      try {
        void Promise.resolve(s.set(id, value)).catch(() => {})
      } catch {
        // The settings API shape varies between ComfyUI versions; core still holds the state.
      }
    }
  }, 400)
}

const FIT_OPTIONS = [
  { text: 'Cover (fill, crop edges)', value: 'cover' },
  { text: 'Contain (fit whole image)', value: 'contain' },
  { text: 'Stretch (ignore aspect)', value: 'stretch' },
  { text: 'Center (natural size)', value: 'center' },
  { text: 'Tile (repeat)', value: 'tile' },
]

export function registerBackgroundSettings(): void {
  app.registerExtension({
    name: 'zenkit.background.settings',
    settings: [
      {
        id: ENABLED_ID,
        name: 'Graph background',
        category: cat('Graph background'),
        type: 'boolean',
        defaultValue: false,
        sortOrder: 100,
        tooltip:
          'Draw a ZenKit background behind the node graph, replacing ComfyUI’s own. ' +
          'Pick which one below. Off by default.',
        onChange: mirrored<boolean>(ENABLED_ID, (value) => setBackgroundEnabled(!!value)),
      },
      {
        id: KIND_ID,
        name: 'Background',
        category: cat('Background kind'),
        type: 'combo',
        defaultValue: 'grid',
        options: kindOptions,
        sortOrder: 95,
        tooltip:
          'Interactive Grid is the WebGL field of glowing dots that reacts to your cursor and ' +
          'follows your theme. Image puts a picture back there instead.',
        onChange: mirrored<string>(KIND_ID, (value) => setBackgroundKind(String(value))),
      },
      {
        id: IMAGE_URL_ID,
        name: 'Background image',
        category: cat('Background image'),
        // ComfyUI's own image-setting widget: a URL field plus upload + clear buttons. Older
        // frontends without this input type fall back to a plain text box, which still works.
        type: 'backgroundImage',
        defaultValue: '',
        sortOrder: 90,
        tooltip:
          'Used when Background is set to Image. Upload a file, or paste any URL — including a ' +
          'ComfyUI output such as /api/view?filename=…&type=output.',
        onChange: mirrored<string>(IMAGE_URL_ID, (value) =>
          setBackgroundImage({ url: String(value ?? '') }),
        ),
      },
      {
        id: IMAGE_FIT_ID,
        name: 'Image fit',
        category: cat('Image fit'),
        type: 'combo',
        defaultValue: 'cover',
        options: FIT_OPTIONS,
        sortOrder: 85,
        tooltip:
          'How the picture is scaled into the viewport, like CSS background-size. Contain and ' +
          'Center letterbox with your theme’s background colour.',
        onChange: mirrored<string>(IMAGE_FIT_ID, (value) =>
          setBackgroundImage({ fit: value as never }),
        ),
      },
      {
        id: IMAGE_OPACITY_ID,
        name: 'Image opacity',
        category: cat('Image opacity'),
        type: 'slider',
        defaultValue: 100,
        attrs: { min: 10, max: 100, step: 1 },
        sortOrder: 80,
        tooltip: 'Fades the picture toward your theme background. 100 = the picture as-is.',
        onChange: mirrored<number>(IMAGE_OPACITY_ID, (value) =>
          setBackgroundImage({ opacity: Number(value) / 100 }),
        ),
      },
      {
        id: DIM_ID,
        name: 'Dim',
        category: cat('Finish dim'),
        type: 'slider',
        defaultValue: 0,
        attrs: { min: 0, max: 100, step: 1 },
        sortOrder: 75,
        tooltip:
          'Veils the background in your theme’s own background colour so nodes read clearly ' +
          'over it. Applies to any background, grid or image.',
        onChange: mirrored<number>(DIM_ID, (value) => setBackgroundFinish({ dim: Number(value) })),
      },
      {
        id: BLUR_ID,
        name: 'Frost (blur)',
        category: cat('Finish frost'),
        type: 'slider',
        defaultValue: 0,
        attrs: { min: 0, max: 40, step: 1 },
        sortOrder: 70,
        tooltip:
          'Blur radius in pixels applied to whatever is behind the nodes. A little frost keeps a ' +
          'busy photo from competing with the graph.',
        onChange: mirrored<number>(BLUR_ID, (value) =>
          setBackgroundFinish({ blur: Number(value) }),
        ),
      },
      {
        id: VIGNETTE_ID,
        name: 'Vignette',
        category: cat('Finish vignette'),
        type: 'slider',
        defaultValue: 0,
        attrs: { min: 0, max: 100, step: 1 },
        sortOrder: 65,
        tooltip: 'Darkens the edges toward your theme background so the middle reads first.',
        onChange: mirrored<number>(VIGNETTE_ID, (value) =>
          setBackgroundFinish({ vignette: Number(value) }),
        ),
      },
      {
        id: EFFECT_ID,
        name: 'Overlay effect',
        category: cat('Overlay effect'),
        type: 'combo',
        defaultValue: 'none',
        options: effectOptions,
        sortOrder: 60,
        tooltip:
          'An extra pass drawn over the background and finish, in graph space, so it pans and ' +
          'zooms with your nodes. Only visible while the background is on.',
        onChange: mirrored<string>(EFFECT_ID, (value) => {
          const id = String(value ?? 'none')
          setBackgroundEffects(id && id !== 'none' ? [id] : [])
        }),
      },
      {
        id: EFFECT_STRENGTH_ID,
        name: 'Effect strength',
        category: cat('Effect strength'),
        type: 'slider',
        defaultValue: 60,
        attrs: { min: 0, max: 100, step: 1 },
        sortOrder: 55,
        tooltip:
          'How strongly the overlay effect reads. Lower it to a hint, raise it to a statement.',
        onChange: mirrored<number>(EFFECT_STRENGTH_ID, (value) =>
          setBackgroundEffectIntensity(Number(value)),
        ),
      },
      {
        id: FOLLOW_ID,
        name: 'Cursor follow',
        category: ['ZenKit', 'Canvas', 'Cursor follow'],
        type: 'combo',
        defaultValue: 'snap',
        options: [
          { text: 'Snap (1:1)', value: 'snap' },
          { text: 'Follow (eased)', value: 'follow' },
          { text: 'Blob (droplet)', value: 'blob' },
        ],
        tooltip:
          'How the glow tracks your cursor. Snap sits exactly on it; Follow eases in behind it; ' +
          'Blob trails a tapered droplet that curves along the path you draw, like water being dragged.',
        onChange(value: string) {
          setBackgroundFollow(String(value))
        },
      },
      {
        id: FOLLOW_SPEED_ID,
        name: 'Follow speed',
        category: ['ZenKit', 'Canvas', 'Follow speed'],
        type: 'slider',
        defaultValue: 45,
        attrs: { min: 1, max: 100, step: 1 },
        tooltip:
          'How quickly the glow catches up to your cursor. Higher is snappier. No effect in Snap mode.',
        onChange(value: number) {
          setBackgroundFollowSpeed(Number(value))
        },
      },
      {
        id: BLOB_FLOW_ID,
        name: 'Blob flow',
        category: ['ZenKit', 'Canvas', 'Blob flow'],
        type: 'slider',
        defaultValue: 55,
        attrs: { min: 0, max: 100, step: 1 },
        tooltip:
          'Length and pointiness of the Blob droplet tail. Low = a short rounded blob; high = a ' +
          'long tapered comet tail. Only used in Blob mode.',
        onChange(value: number) {
          setBackgroundBlobFlow(Number(value))
        },
      },
    ],
    // Some ComfyUI builds don't fire `onChange` for stored values on load. The cursor settings
    // live only here, so they are applied again; the rest follow the same rule as a replay —
    // they seed core only while it has nothing saved. Then core's state is written back, so the
    // dialog shows it, and so is every later change made through the API.
    //
    // Order matters in one place only: the image's url/fit/opacity are applied together before the
    // kind is chosen, so switching to 'image' finds its source already set and never flashes empty.
    async setup() {
      try {
        const s = settingsApi()
        if (!s) return
        const follow = s.get(FOLLOW_ID)
        if (follow !== undefined) setBackgroundFollow(String(follow))
        const speed = s.get(FOLLOW_SPEED_ID)
        if (speed !== undefined) setBackgroundFollowSpeed(Number(speed))
        const flow = s.get(BLOB_FLOW_ID)
        if (flow !== undefined) setBackgroundBlobFlow(Number(flow))

        seedFromSettings ??= !backgroundStored()
        if (seedFromSettings) {
          const fit = s.get(IMAGE_FIT_ID)
          const opacity = s.get(IMAGE_OPACITY_ID)
          setBackgroundImage({
            url: String(s.get(IMAGE_URL_ID) ?? ''),
            ...(fit === undefined ? {} : { fit: fit as never }),
            ...(opacity === undefined ? {} : { opacity: Number(opacity) / 100 }),
          })
          setBackgroundFinish({
            dim: Number(s.get(DIM_ID) ?? 0),
            blur: Number(s.get(BLUR_ID) ?? 0),
            vignette: Number(s.get(VIGNETTE_ID) ?? 0),
          })
          setBackgroundEffectIntensity(Number(s.get(EFFECT_STRENGTH_ID) ?? 60))
          const effect = String(s.get(EFFECT_ID) ?? 'none')
          setBackgroundEffects(effect && effect !== 'none' ? [effect] : [])
          const kind = s.get(KIND_ID)
          if (kind !== undefined) setBackgroundKind(String(kind))
          // Last: enabling activates whatever the settings above just described.
          const on = s.get(ENABLED_ID)
          if (on !== undefined) setBackgroundEnabled(!!on)
        }
      } catch {
        // The settings API shape varies between ComfyUI versions; onChange covers the common path.
      }
      mirrorToSettings()
      onBackgroundChange(mirrorToSettings)
    },
  } as never)
}
