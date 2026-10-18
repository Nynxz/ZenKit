// Shared types for @nynxz/zenkit-ui components.

/** A ZenCombo option. `value` is the model value; `label`/`keywords` feed the filter. */
export interface ComboItem {
  value: string | number
  label?: string
  keywords?: string
  [k: string]: unknown
}

export interface LightboxItem {
  /** Full/large image (or video / audio) URL. */
  src: string
  kind?: 'image' | 'video' | 'audio'
  /** Title shown in the toolbar. */
  label?: string
  /** Small caption line under the title (e.g. dimensions / size). */
  meta?: string
  /** Smaller image for the thumbnails sidebar (defaults to `src`). */
  thumb?: string
  /** Image laid over the picture (e.g. a training mask), multiplied in; zooms, pans and
   *  rotates with it. M or the toolbar toggles it. */
  overlay?: string
  /** how the overlay shows: "multiply" (default) darkens through it; "mask" reads it as a mask:
   *  the picture dims and only the overlay's white part shows at full strength */
  overlayMode?: 'multiply' | 'mask'
  /** If set, the lightbox shows a "Load workflow" button that calls this. */
  onWorkflow?: () => void
}
