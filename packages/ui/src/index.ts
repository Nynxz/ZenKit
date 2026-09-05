// @nynxz/zenkit-ui — shared Vue components plugins bundle and use. Token-driven, theme-consistent,
// runtime-free (no window.ZenKit dependency). Organized by kind:
//   primitives/ inputs/ overlays/ feature/ data/ lib/
// Heavy host-owned tools (the mask editor) live in @nynxz/zenkit-core as runtime services, NOT here.

// layout — node bodies and compact forms.
//   ZenWidget  the outer shell for a whole node body: baseline padding/typography, and the
//              `cursor: default` that stops ComfyUI's node grab-cursor bleeding into content.
//   ZenRow     a row whose children WRAP instead of squashing — see its header for why that
//              matters at node-body widths.
//   ZenField   a labelled control.
export { default as ZenWidget } from './layout/ZenWidget.vue'
export { default as ZenRow } from './layout/ZenRow.vue'
export { default as ZenField } from './layout/ZenField.vue'

// primitives
export { default as ZenView } from './primitives/ZenView.vue'
export { default as ZenToolbar } from './primitives/ZenToolbar.vue'
export { default as ZenScroll } from './primitives/ZenScroll.vue'
export { default as ZenButton } from './primitives/ZenButton.vue'
export { default as ZenIconButton } from './primitives/ZenIconButton.vue'
// ZenIcon: an MDI class OR an image-URL/data-URI icon (custom favicons/logos).
export { default as ZenIcon } from './primitives/ZenIcon.vue'
export { isIconUrl } from './lib/icon'

// inputs (zero-dep, token-driven)
export { default as ZenInput } from './inputs/ZenInput.vue'
export { default as ZenNumber } from './inputs/ZenNumber.vue'
export { default as ZenSelect } from './inputs/ZenSelect.vue'
export { default as ZenCombo } from './inputs/ZenCombo.vue'
// booleans, heaviest to lightest — pick by how much the control should assert itself:
//   ZenSwitch   42×23 pill + sliding knob. A setting.
//   ZenCheckbox 16px box + tick, optional label. An option in a list.
//   ZenDot      ~13px coloured shape, no glyph. On/off STATE in a repeated row.
export { default as ZenSwitch } from './inputs/ZenSwitch.vue'
export { default as ZenCheckbox } from './inputs/ZenCheckbox.vue'
export { default as ZenDot } from './inputs/ZenDot.vue'
export { default as ZenToggleGroup } from './inputs/ZenToggleGroup.vue'
export { default as ZenSlider } from './inputs/ZenSlider.vue'
export { default as ZenColorPicker } from './inputs/ZenColorPicker.vue'
// width + height as one control, plus the shared dimension math
export { default as ZenDimensions } from './inputs/ZenDimensions.vue'
export {
  aspectRatio,
  clamp,
  clampDimension,
  snap,
  megapixels,
  formatMegapixels,
  scaleToMegapixels,
  findClosestPreset,
  MIN_DIMENSION,
  MAX_DIMENSION,
  type DimensionsValue,
} from './lib/dimensions'

// Click-to-focus for a node body that needs the wheel (zoomable picture, scrollable list).
// The canvas only yields the wheel to a focused `data-capture-wheel` element — this is what
// makes that focus happen on a PRESS rather than on hover.
export { useFocusSurface, type FocusSurface, type FocusSurfaceOptions } from './lib/useFocusSurface'

// overlays (anchored, teleported, auto-flipping; hover-intent submenus)
export { default as ZenPopover } from './overlays/ZenPopover.vue'
export { default as ZenMenuItem } from './overlays/ZenMenuItem.vue'
export { default as ZenMenuSeparator } from './overlays/ZenMenuSeparator.vue'
export { default as ZenModal } from './overlays/ZenModal.vue'
export { default as ZenWindow } from './overlays/ZenWindow.vue'

// feature
export { default as ZenLightbox } from './feature/ZenLightbox.vue'

// data
export { default as JsonTree } from './data/JsonTree.vue'

export type { LightboxItem, ComboItem } from './types'
