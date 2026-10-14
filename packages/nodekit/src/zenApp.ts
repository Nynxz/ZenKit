// A pack's full-screen ZenKit app: one Vue component mounted once and kept for as long as the
// app runs (minimized included), following its routes through the `ctx` prop. Like
// registerZenPanel it waits for ZenKit and does nothing without it.

import { createApp, type Component } from 'vue'

import { whenZen, type AppContext, type AppRegistration } from './zenkit'

export interface ZenAppEntry extends Omit<AppRegistration, 'mount' | 'routes'> {
  /** The pages, by pattern ('', 'item/:id'), for matching and chrome titles. Default: one
   *  index route. The component decides what each looks like (`useAppLocation`). */
  routes?: { path: string; title?: string | ((params: Record<string, string>) => string) }[]
  /** Props handed to the component beside `ctx`. */
  props?: Record<string, unknown>
}

/**
 * List `component` in ZenKit's Start menu as a full-screen app. It is mounted once, when the
 * app is first shown, with the app's AppContext as its `ctx` prop, and unmounted when the app
 * closes. Resolves to an unregister fn, or null without ZenKit — the pack then offers its own
 * way in.
 */
export async function registerZenApp(
  entry: ZenAppEntry,
  component: Component,
): Promise<(() => void) | null> {
  const zen = await whenZen()
  if (!zen?.apps?.register) return null
  const { props, routes, ...rest } = entry
  return zen.apps.register({
    ...rest,
    routes: routes ?? [{ path: '' }],
    mount(el: HTMLElement, ctx: AppContext) {
      const app = createApp(component, { ...props, ctx })
      app.mount(el)
      return () => app.unmount()
    },
  })
}
