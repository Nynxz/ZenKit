# UI components

`@nynxz/zenkit-ui` is ZenKit's Vue 3 component library: 41 components (plus three new layout
components in progress) styled entirely from `--zen-*` CSS tokens. It does not touch
`window.ZenKit`, so it works in ZenKit plugins and in plain node packs alike.

## Install

```sh
pnpm add @nynxz/zenkit-ui      # peer: vue ^3.5.0
```

```ts
import '@nynxz/zenkit-ui/style.css' // component styles
import '@nynxz/zenkit-ui/comfy-bridge.css' // only when the ZenKit runtime may be absent
import { ZenButton, ZenNumber, ZenSelect } from '@nynxz/zenkit-ui'
```

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { ZenField, ZenNumber, ZenRow, ZenSelect, ZenWidget, ZenButton } from '@nynxz/zenkit-ui'

const steps = ref(20)
const sampler = ref('euler')
</script>

<template>
  <ZenWidget>
    <ZenRow>
      <ZenField label="Steps"><ZenNumber v-model="steps" :min="1" :max="150" :step="1" /></ZenField>
      <ZenSelect v-model="sampler" :options="['euler', 'dpmpp_2m']" data-grow />
    </ZenRow>
    <template #footer><ZenButton variant="primary" block>Run</ZenButton></template>
  </ZenWidget>
</template>
```

How you get the package depends on what you build:

| Consumer               | Resolves `@nynxz/zenkit-ui` to                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| In-repo ZenKit plugins | Package source (Vite alias), served at runtime from `/zenkit/runtime/ui.js` (`sharedRuntime`) |
| External node packs    | npm (or a `link:` to `packages/ui`), bundled into the pack's `main.js`                        |

With `sharedRuntime`, the runtime's `ui.js` already includes the styles; the CSS imports above are
for bundled consumers.

## Theming

Every component reads `--zen-*` custom properties, with inline fallbacks.

| Situation                | Who sets the tokens                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| ZenKit runtime installed | `core` sets the full set from the active theme pack (see [Themes](Themes.md))                                           |
| No runtime               | `comfy-bridge.css` maps them at `:root` onto ComfyUI's own variables, so components follow the ComfyUI theme with no JS |

Tokens `comfy-bridge.css` defines:

| Token                                                              | From ComfyUI variable                                |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| `--zen-bg`                                                         | `--comfy-menu-bg`                                    |
| `--zen-surface`, `--zen-surface-2`                                 | `--comfy-menu-secondary-bg`                          |
| `--zen-input`                                                      | `--comfy-input-bg`                                   |
| `--zen-border`                                                     | `--border-color`                                     |
| `--zen-text`                                                       | `--input-text`, then `--fg-color`                    |
| `--zen-muted`                                                      | `--descrip-text`                                     |
| `--zen-accent`, `--zen-accent-text`                                | `--p-primary-color`, `--p-button-text-primary-color` |
| `--zen-radius`                                                     | `--border-radius-base` (7px)                         |
| `--zen-danger`, `--zen-warn`, `--zen-ok`, `--zen-info` (+ `-text`) | ComfyUI status colours                               |
| `--zen-mono`                                                       | a monospace stack                                    |

Other tokens components read (`--zen-chrome-bg`, `--zen-control-bg`, `--zen-control-border`,
`--zen-control-hover-*`, `--zen-field-bg`, `--zen-surface-border`, `--zen-radius-surface`,
`--zen-glass`, `--zen-scrollbar`, `--zen-switch-radius`) are not in the bridge; they fall back
inline to the core tokens. Override any token on an ancestor to restyle a subtree.

### Floating layers

Overlays (popovers, menus, modals, windows, pickers) are teleported to `<body>`. Each floating root
carries a `data-zen-layer` attribute:

- Click-outside handlers ignore clicks inside another `[data-zen-layer]`, so a ZenSelect inside a
  ZenPopover does not close the popover.
- Layers render above ComfyUI's own dialogs and the ZenKit taskbar. Escape closes the innermost
  layer that handles it.
- `[data-zen-layer]` re-tints scrollbars (see below).

If you build your own teleported overlay, set `data-zen-layer` on its root so the components
above treat clicks inside it as "inside".

### Scrollbars

`lib/scrollbar.css` styles the `.zen-scroll` class: a thin scrollbar coloured by `--zen-scrollbar`
(falling back to ComfyUI's `--dialog-surface`). Inside `[data-zen-layer]` the thumb is tinted from
`--zen-text` instead. ZenScroll and the overlays apply it; add `class="zen-scroll"` to your own
scroll containers.

## Conventions

| Convention           | Detail                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v-model`            | Plain `modelValue` unless noted. Some components use named models (`v-model:open`, `v-model:width`, `v-model:volume`, …).                                                              |
| Icons                | Material Design Icons classes. Every icon prop accepts either the full class (`'mdi mdi-cog'`) or the bare glyph (`'mdi-cog'`). The package does not load the MDI font; the page must. |
| Wrapping rows        | Use `ZenRow` in node bodies: children wrap instead of squashing. Mark the child that should stretch with `data-grow`.                                                                  |
| Wheel in node bodies | ComfyUI only gives the wheel to a focused `data-capture-wheel` element. Use `useFocusSurface` ([Layout and primitives](UI-Layout-and-Primitives.md#usefocussurface)).                  |
| Persistence          | A few components remember UI state in `localStorage` under `zenkit.*` keys (noted per component).                                                                                      |
| Boolean controls     | Pick by weight: ZenSwitch (a setting), ZenCheckbox (an option in a list), ZenDot (state in a repeated row).                                                                            |

## Component index

"On npm" says whether `@nynxz/zenkit-ui@0.2.0` exports it. The rest are in the source (and the
ZenKit runtime) but unreleased, not yet on npm; node packs get them through a `link:` override.

| Component        | Purpose                                      | On npm | Page                                                                 |
| ---------------- | -------------------------------------------- | ------ | -------------------------------------------------------------------- |
| ZenWidget        | Shell for a whole node body                  | 0.2.0  | [Layout and primitives](UI-Layout-and-Primitives.md#zenwidget)       |
| ZenRow           | Row whose children wrap                      | 0.2.0  | [Layout and primitives](UI-Layout-and-Primitives.md#zenrow)          |
| ZenField         | Labelled control                             | 0.2.0  | [Layout and primitives](UI-Layout-and-Primitives.md#zenfield)        |
| ZenSection       | Collapsible titled block (new)               | no     | [Layout and primitives](UI-Layout-and-Primitives.md#zensection)      |
| ZenSections      | Groups ZenSections, optional accordion (new) | no     | [Layout and primitives](UI-Layout-and-Primitives.md#zensections)     |
| ZenSplit         | Resizable panes (new)                        | no     | [Layout and primitives](UI-Layout-and-Primitives.md#zensplit)        |
| ZenResizeHandle  | Shared resize grip and input lifecycle (new) | no     | [Layout and primitives](UI-Layout-and-Primitives.md#zenresizehandle) |
| ZenView          | Standard panel layout                        | 0.2.0  | [Layout and primitives](UI-Layout-and-Primitives.md#zenview)         |
| ZenToolbar       | Panel header bar                             | 0.2.0  | [Layout and primitives](UI-Layout-and-Primitives.md#zentoolbar)      |
| ZenScroll        | Themed scroll container                      | 0.2.0  | [Layout and primitives](UI-Layout-and-Primitives.md#zenscroll)       |
| ZenButton        | Text button                                  | 0.2.0  | [Layout and primitives](UI-Layout-and-Primitives.md#zenbutton)       |
| ZenIconButton    | Icon-only button                             | 0.2.0  | [Layout and primitives](UI-Layout-and-Primitives.md#zeniconbutton)   |
| ZenIcon          | MDI or image-URL icon                        | 0.2.0  | [Layout and primitives](UI-Layout-and-Primitives.md#zenicon)         |
| ZenEmpty         | Empty state with the lotus mark (new)        | no     | [Layout and primitives](UI-Layout-and-Primitives.md#zenempty)        |
| ZenInput         | Text, number, password, textarea             | 0.2.0  | [Inputs](UI-Inputs.md#zeninput)                                      |
| ZenMentionInput  | Textarea with `@mentions`                    | no     | [Inputs](UI-Inputs.md#zenmentioninput)                               |
| ZenNumber        | Numeric field with scrub and steppers        | 0.2.0  | [Inputs](UI-Inputs.md#zennumber)                                     |
| ZenResolution    | Aspect-ratio and megapixel size picker       | no     | [Inputs](UI-Inputs.md#zenresolution)                                 |
| ZenDimensions    | Inline width × height                        | 0.2.0  | [Inputs](UI-Inputs.md#zendimensions)                                 |
| ZenSelect        | Dropdown                                     | 0.2.0  | [Inputs](UI-Inputs.md#zenselect)                                     |
| ZenCombo         | Searchable, virtualised picker               | 0.2.0  | [Inputs](UI-Inputs.md#zencombo)                                      |
| ZenSwitch        | Toggle switch                                | 0.2.0  | [Inputs](UI-Inputs.md#zenswitch)                                     |
| ZenCheckbox      | Checkbox                                     | 0.2.0  | [Inputs](UI-Inputs.md#zencheckbox)                                   |
| ZenDot           | Small on/off dot                             | 0.2.0  | [Inputs](UI-Inputs.md#zendot)                                        |
| ZenToggleGroup   | Segmented single-select                      | 0.2.0  | [Inputs](UI-Inputs.md#zentogglegroup)                                |
| ZenSlider        | Range slider                                 | 0.2.0  | [Inputs](UI-Inputs.md#zenslider)                                     |
| ZenVolume        | Volume and mute                              | no     | [Inputs](UI-Inputs.md#zenvolume)                                     |
| ZenCurveEditor   | 0–1 curve editor                             | no     | [Inputs](UI-Inputs.md#zencurveeditor)                                |
| ZenColorPicker   | Colour picker                                | 0.2.0  | [Inputs](UI-Inputs.md#zencolorpicker)                                |
| ZenPopover       | Anchored floating panel                      | 0.2.0  | [Overlays](UI-Overlays.md#zenpopover)                                |
| ZenMenuItem      | Menu row, optional submenu                   | 0.2.0  | [Overlays](UI-Overlays.md#zenmenuitem)                               |
| ZenMenuSeparator | Menu divider                                 | 0.2.0  | [Overlays](UI-Overlays.md#zenmenuseparator)                          |
| ZenContextMenu   | Right-click menu                             | no     | [Overlays](UI-Overlays.md#zencontextmenu)                            |
| ZenModal         | Centred dialog                               | 0.2.0  | [Overlays](UI-Overlays.md#zenmodal)                                  |
| ZenWindow        | Draggable, resizable window                  | 0.2.0  | [Overlays](UI-Overlays.md#zenwindow)                                 |
| ZenLightbox      | Image/video/audio viewer                     | 0.2.0  | [Media and LoRA](UI-Media-and-LoRA.md#zenlightbox)                   |
| ZenMediaControls | Player controls for a media element          | no     | [Media and LoRA](UI-Media-and-LoRA.md#zenmediacontrols)              |
| ZenMediaPicker   | Media browser modal                          | no     | [Media and LoRA](UI-Media-and-LoRA.md#zenmediapicker)                |
| ZenTimeline      | Multi-track timeline                         | no     | [Media and LoRA](UI-Media-and-LoRA.md#zentimeline)                   |
| ZenStepChart     | Sampler run chart                            | no     | [Media and LoRA](UI-Media-and-LoRA.md#zenstepchart)                  |
| LoraPicker       | LoRA combo                                   | no     | [Media and LoRA](UI-Media-and-LoRA.md#lorapicker)                    |
| LoraBrowser      | Full LoRA library modal                      | no     | [Media and LoRA](UI-Media-and-LoRA.md#lorabrowser)                   |
| LoraThumb        | LoRA preview tile                            | no     | [Media and LoRA](UI-Media-and-LoRA.md#lorathumb)                     |
| LoraDetail       | Everything about one LoRA                    | no     | [Media and LoRA](UI-Media-and-LoRA.md#loradetail)                    |
| JsonTree         | Collapsible JSON viewer                      | 0.2.0  | [Data](UI-Data.md#jsontree)                                          |
| ZenFolderTree    | Folder tree                                  | no     | [Data](UI-Data.md#zenfoldertree)                                     |

Non-component exports:

| Export                                                                                                                                                                                                                                                                         | Page                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `useFocusSurface`, `FocusSurface`, `FocusSurfaceOptions`                                                                                                                                                                                                                       | [Layout and primitives](UI-Layout-and-Primitives.md#usefocussurface) |
| `isIconUrl`                                                                                                                                                                                                                                                                    | [Layout and primitives](UI-Layout-and-Primitives.md#zenicon)         |
| Dimension math (`aspectRatio`, `snap`, `megapixels`, …)                                                                                                                                                                                                                        | [Inputs](UI-Inputs.md#dimension-helpers)                             |
| `setLoraSource`, `openLoraDetail`, `setLoraDetailOpener`, `loraLibrary`                                                                                                                                                                                                        | [Media and LoRA](UI-Media-and-LoRA.md#lora-setup)                    |
| Types: `SplitPane`, `ComboItem`, `LightboxItem`, `MentionItem`, `ResolutionRatio`, `CurvePoint`, `CurvePreset`, `DimensionsValue`, `ContextMenuAction`, `ContextMenuItem`, `MediaPickerItem`, `MediaPickerKind`, `MediaPickerLibrary`, `Timeline*`, `Lora*`, `FolderTreeEntry` | On each component's page                                             |
