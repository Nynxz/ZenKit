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
  /** If set, the lightbox shows a "Load workflow" button that calls this. */
  onWorkflow?: () => void
}
