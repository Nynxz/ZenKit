// Mount a component in a ZenKit panel when the runtime is present, and report when it isn't so
// the caller can fall back to its own dialog. Talks to `window.ZenKit` directly rather than
// importing @nynxz/zenkit-client, so a pack has no runtime dependency on ZenKit.
//
// A panel rather than a modal: it is dockable and survives clicking back onto a node, which is
// what anything edited *while* looking at the graph needs.

import { createApp, type Component } from 'vue'

export interface ZenPanelSpec {
  /** Stable id. Opening the same id again focuses the existing panel instead of duplicating. */
  id: string
  title: string
  icon?: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  /** Props handed to the component. */
  props?: Record<string, unknown>
}

export interface ZenPanelHandle {
  close(): void
}

interface PanelHandleLike {
  close?: () => void
}

interface ZenKitLike {
  panels?: {
    open(spec: Record<string, unknown>): PanelHandleLike | null
    get?(id: string): PanelHandleLike | null
  }
}

function getZenKit(): ZenKitLike | null {
  return (
    (typeof window !== 'undefined' && (window as unknown as { ZenKit?: ZenKitLike }).ZenKit) || null
  )
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
      render(el: HTMLElement) {
        const app = createApp(component, spec.props ?? {})
        app.mount(el)
        // ZenKit calls the returned teardown when the panel closes — without it the app
        // keeps its watchers and timers alive for the rest of the session.
        return () => app.unmount()
      },
    })
    return { close: () => handle?.close?.() }
  } catch {
    return null
  }
}
