// Result handed back by the mask editor on `apply` (ComfyUI-agnostic; the consumer persists it).
// Lives here with the editor, parked until it's wired as the window.ZenKit.maskEditor service.
export interface MaskResult {
  width: number
  height: number
  /** Mask as an RGBA canvas — alpha = painted coverage (white RGB). */
  maskCanvas: HTMLCanvasElement
  /** RGB paint layer when used (Phase C); null otherwise. */
  paintCanvas: HTMLCanvasElement | null
  hasPaint: boolean
  /** PNG blob of the mask. `invert` ⇒ alpha = 255 − coverage (ComfyUI /upload/mask). */
  toMaskBlob(invert?: boolean): Promise<Blob>
  /** PNG blob of the (optionally paint-composited) base image. */
  toImageBlob(): Promise<Blob>
}
