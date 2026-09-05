// ComfyUI's host modules. Provided by the page, externalised at build, so they have no npm
// package and need an ambient declaration. `any` because ComfyUI's frontend is untyped here
// and `core` walks `app.canvas.…`.

declare module '@comfy/app' {
  export const app: any

  export const ComfyApp: any
}

declare module '@comfy/api' {
  export const api: any
}
