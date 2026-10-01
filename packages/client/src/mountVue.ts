import { createApp } from 'vue'
import type { Component } from 'vue'
import type { PanelContext } from '@nynxz/zenkit-types'

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
