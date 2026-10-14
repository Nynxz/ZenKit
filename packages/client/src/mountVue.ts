import { createApp } from 'vue'
import type { Component } from 'vue'
import type { AppContext, PanelContext } from './contract'

function declaresCtx(component: Component): boolean {
  const props = (component as { props?: unknown }).props
  if (Array.isArray(props)) return props.includes('ctx')
  return typeof props === 'object' && props !== null && 'ctx' in props
}

/**
 * A `render` for a panel, taskbar widget or app that mounts a Vue component into the
 * container and unmounts it when ZenKit tears the container down. A component that
 * declares a `ctx` prop receives the panel's persisted PanelContext through it.
 */
export function mountVue(component: Component, props: Record<string, unknown> = {}) {
  const wantsCtx = declaresCtx(component)
  return (el: HTMLElement, ctx?: PanelContext) => {
    const app = createApp(component, wantsCtx ? { ...props, ctx } : props)
    app.mount(el)
    return () => app.unmount()
  }
}

/**
 * An app's `mount` that mounts a Vue component once, for as long as the app runs, and unmounts
 * it when the app closes. The component gets the AppContext as its `ctx` prop; pair it with
 * `useAppLocation(ctx.router)` to follow the app's routes.
 */
export function mountVueApp(component: Component, props: Record<string, unknown> = {}) {
  return (el: HTMLElement, ctx: AppContext) => {
    const app = createApp(component, { ...props, ctx })
    app.mount(el)
    return () => app.unmount()
  }
}
