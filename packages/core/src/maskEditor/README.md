# maskEditor (parked)

`ZenMaskCanvas` + `ZenMaskEditor` moved here from `@nynxz/zenkit-ui` — they're a heavy node **tool**,
not a plugin-facing primitive, so they don't belong in the components package plugins bundle.

They are **not wired yet**. The plan (see the `zenkit-runtime-services` principle) is to expose
them as a host runtime service — `window.ZenKit.maskEditor`, mirroring `viewer.ts` + `ZenLightbox`
— with a graceful fallback (the bundled `ZenWindow` standalone window) when the runtime is absent.

Until then they're parked here, unexported, and bundled by nothing.

- `ZenMaskCanvas.vue` — the paint/mask canvas (imports its controls from `@nynxz/zenkit-ui`).
- `ZenMaskEditor.vue` — wraps the canvas in a `@nynxz/zenkit-ui` `ZenWindow` (no-runtime fallback host).
- `types.ts` — `MaskResult`, the apply payload.
