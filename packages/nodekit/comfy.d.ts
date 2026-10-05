// ComfyUI's host modules. Provided by the page, externalised at build, so they have no npm
// package and need an ambient declaration. `any` because ComfyUI's frontend is untyped here
// and `core` walks `app.canvas.…`.
//
// The source is packages/client/comfy.d.ts, which every in-repo tsconfig lists. nodekit's build
// copies it to packages/nodekit/comfy.d.ts, the copy node packs list in `files`. Edit the source.

declare module '@comfy/app' {
  export const app: any

  export const ComfyApp: any
}

declare module '@comfy/api' {
  export const api: any

  // The client class behind `api`. Constructing a second one pins it to the page's own
  // origin, which is how ZenKit keeps its own storage on home across an instance switch.
  export const ComfyApi: new () => any
}

// Plugin builds inline every asset (assetsInlineLimit: Infinity), so an SVG import is a
// data URI — what `logo` / `icon` take.
declare module '*.svg' {
  const src: string
  export default src
}
