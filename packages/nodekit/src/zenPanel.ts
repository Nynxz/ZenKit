// Mount a component in a ZenKit panel when the runtime is present, and report when it isn't so
// the caller can fall back to its own dialog. A pack has no runtime dependency on ZenKit: the
// client code this uses is bundled into nodekit (see zenkit.ts).
//
// A panel rather than a modal: it is dockable and survives clicking back onto a node, which is
// what anything edited *while* looking at the graph needs.

import { createApp, type Component } from 'vue'

import { getZenKit, whenZen } from './zenkit'

export interface ZenPanelSpec {
  /** Stable id. Opening the same id again focuses the existing panel instead of duplicating. */
  id: string
  title: string
  icon?: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  /** Remember geometry across reloads (ZenKit default: true). */
  persist?: boolean
  /** Props handed to the component. */
  props?: Record<string, unknown>
  /** Called once when the panel closes — by its own ✕ or by `handle.close()`. For a caller
   *  that keeps state about the panel being open, so that state can't outlive it. */
  onClose?: () => void
}

export interface ZenPanelHandle {
  /** `keep`: remember its place (geometry, workspace tile) for when the same id opens again. */
  close(opts?: { keep?: boolean }): void
  setTitle(title: string): void
  /** Bring the panel to the front (and out of a minimized state, where ZenKit supports it). */
  focus(): void
}

/** Whether a ZenKit panel can be opened right now. Components use this to decide between a
 *  panel and their own in-node dialog BEFORE rendering, so nothing flashes. */
export function hasZenPanels(): boolean {
  return typeof getZenKit()?.panels?.open === 'function'
}

/**
 * Open `component` in a ZenKit panel. Returns null when ZenKit isn't installed — the caller
 * is expected to fall back (a ZenModal, typically), NOT to silently do nothing.
 *
 * The Vue app is created here and unmounted when the panel closes, so the caller owns only
 * the handle. Props are passed by value at open time; for live two-way state, hand in a
 * reactive object or callbacks rather than expecting re-renders from the caller's scope.
 */
export function openZenPanel(spec: ZenPanelSpec, component: Component): ZenPanelHandle | null {
  const zen = getZenKit()
  if (!zen?.panels?.open) return null
  try {
    const handle = zen.panels.open({
      id: spec.id,
      title: spec.title,
      icon: spec.icon,
      width: spec.width,
      height: spec.height,
      minWidth: spec.minWidth,
      minHeight: spec.minHeight,
      persist: spec.persist,
      render(el: HTMLElement) {
        const app = createApp(component, spec.props ?? {})
        app.mount(el)
        // ZenKit calls the returned teardown when the panel closes — without it the app
        // keeps its watchers and timers alive for the rest of the session.
        return () => app.unmount()
      },
    })
    if (spec.onClose && handle?.on) {
      let fired = false
      const off = handle.on('close', () => {
        if (fired) return
        fired = true
        off?.()
        spec.onClose?.()
      })
    }
    return {
      close: (opts) => handle?.close?.(opts),
      setTitle: (title) => handle?.setTitle?.(title),
      focus: () => handle?.focus?.(),
    }
  } catch {
    return null
  }
}

export interface ZenPanelEntry extends Omit<ZenPanelSpec, 'onClose'> {
  /** Groups it under the pack in ZenKit's Start menu. */
  plugin?: string
}

/**
 * List `component` in ZenKit's Start menu (the taskbar launcher) as a panel anyone can open,
 * and reopen it after a reload if it was open. Waits for ZenKit; resolves to an unregister fn,
 * or null without ZenKit — the pack then offers its own way in.
 */
export async function registerZenPanel(
  entry: ZenPanelEntry,
  component: Component,
): Promise<(() => void) | null> {
  const zen = await whenZen()
  if (!zen?.panels?.register) return null
  try {
    const off = zen.panels.register({
      id: entry.id,
      title: entry.title,
      icon: entry.icon,
      plugin: entry.plugin,
      persist: entry.persist,
      open: () =>
        zen.panels.open({
          id: entry.id,
          title: entry.title,
          icon: entry.icon,
          width: entry.width,
          height: entry.height,
          minWidth: entry.minWidth,
          minHeight: entry.minHeight,
          persist: entry.persist,
          render(el: HTMLElement) {
            const app = createApp(component, entry.props ?? {})
            app.mount(el)
            return () => app.unmount()
          },
        }),
    })
    return typeof off === 'function' ? off : () => {}
  } catch {
    return () => {}
  }
}
