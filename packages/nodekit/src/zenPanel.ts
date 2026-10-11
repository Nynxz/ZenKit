// Mount a component in a ZenKit panel when the runtime is present, and report when it isn't so
// the caller can fall back to its own dialog. A pack has no runtime dependency on ZenKit: the
// client code this uses is bundled into nodekit (see zenkit.ts).
//
// A panel rather than a modal: it is dockable and survives clicking back onto a node, which is
// what anything edited *while* looking at the graph needs.

import { createApp, type Component } from 'vue'

import { followDecision, initialDecision } from './panelFollow'
import { getZenKit, whenZen, type PanelHandle, type ZenKitApi } from './zenkit'

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
   *  that keeps state about the panel being open, so that state can't outlive it. NOT called
   *  when the panel steps aside for its workspace (see `followWorkspace`). */
  onClose?: () => void
  /** Default true. While the panel is tiled in a workspace that isn't on screen (the graph or
   *  another workspace is), close it and keep its tile; reopen it there when that workspace shows
   *  again. Its component unmounts meanwhile, so a node that shows its editor inline while it
   *  isn't popped out gets it back. A floating panel (not tiled) stays open as before. The
   *  handle stays valid throughout. */
  followWorkspace?: boolean
  /** The open is the user asking to see the panel (a pop-out button): when it is tiled in a
   *  workspace that isn't on screen, show that workspace. Default false — an open from code (a
   *  node restoring its popped-out panel on load) then leaves it closed until the workspace shows,
   *  so nothing flashes open over the graph. Opening an id that is already followed and waiting
   *  counts as asking, unless this is explicitly `false`. */
  reveal?: boolean
}

export interface ZenPanelHandle {
  /** `keep`: remember its place (geometry, workspace tile) for when the same id opens again. */
  close(opts?: { keep?: boolean }): void
  setTitle(title: string): void
  /** Bring the panel to the front (and out of a minimized state, where ZenKit supports it) — its
   *  workspace too, reopening it if it stepped aside for that workspace. */
  focus(): void
}

/** Whether a ZenKit panel can be opened right now. Components use this to decide between a
 *  panel and their own in-node dialog BEFORE rendering, so nothing flashes. */
export function hasZenPanels(): boolean {
  return typeof getZenKit()?.panels?.open === 'function'
}

/** Panels following their workspace, by id: opening one again reuses it. */
const followed = new Map<string, Follower>()

interface Follower {
  handle: ZenPanelHandle
  /** Another open of the same id: take its spec and `onClose` (replacing the earlier one), and
   *  reveal it unless told not to. */
  again(spec: ZenPanelSpec, component: Component): void
}

/**
 * Open `component` in a ZenKit panel. Returns null when ZenKit isn't installed — the caller
 * is expected to fall back (a ZenModal, typically), NOT to silently do nothing.
 *
 * The Vue app is created here and unmounted when the panel closes, so the caller owns only
 * the handle. Props are passed by value at open time; for live two-way state, hand in a
 * reactive object or callbacks rather than expecting re-renders from the caller's scope.
 *
 * A panel tiled in a workspace follows it (`followWorkspace`): it closes while that workspace is
 * off screen and reopens, remounting the component, when it is back.
 */
export function openZenPanel(spec: ZenPanelSpec, component: Component): ZenPanelHandle | null {
  const zen = getZenKit()
  if (!zen?.panels?.open) return null
  try {
    const known = followed.get(spec.id)
    if (known && spec.followWorkspace !== false) {
      known.again(spec, component)
      return known.handle
    }
    return follow(zen, spec, component)
  } catch {
    return null
  }
}

function follow(zen: ZenKitApi, first: ZenPanelSpec, firstComponent: Component): ZenPanelHandle {
  const id = first.id
  const ws = zen.workspaces
  const following =
    first.followWorkspace !== false &&
    typeof ws?.of === 'function' &&
    typeof ws.current === 'function' &&
    typeof ws.onChange === 'function'
  let spec = first
  let component = firstComponent
  let title = first.title
  let onClose = first.onClose
  let panel: PanelHandle | null = null
  let offClose: (() => void) | undefined
  let parked = false
  let done = false
  let stopFollowing: (() => void) | undefined

  /** Closed for real: stop following and tell the caller, once. */
  const finish = () => {
    if (done) return
    done = true
    offClose?.()
    stopFollowing?.()
    if (followed.get(id) === self) followed.delete(id)
    const cb = onClose
    onClose = undefined
    try {
      cb?.()
    } catch (e) {
      console.error('[ZenKit] panel onClose failed', id, e)
    }
  }
  const mount = () => {
    parked = false
    panel = zen.panels.open({
      id,
      title,
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
    offClose?.()
    offClose = panel?.on?.('close', finish) ?? undefined
  }
  /** Step aside for the workspace: close, keeping the tile, without it counting as a close. */
  const park = () => {
    parked = true
    offClose?.()
    offClose = undefined
    const p = panel
    panel = null
    p?.close?.({ keep: true })
  }
  const sync = () => {
    if (done || !following) return
    const d = followDecision({ tiledIn: ws.of(id), current: ws.current(), parked })
    if (d === 'hide') park()
    else if (d === 'show') mount()
  }
  /** Show the panel wherever it is — its workspace first if it waits for one. */
  const reveal = () => {
    if (done) return
    if (!parked) return panel?.focus?.()
    const home = following ? ws.of(id) : null
    if (home && home !== ws.current()) ws.activate(home)
    mount()
  }

  const handle: ZenPanelHandle = {
    close: (opts) => {
      if (done) return
      if (panel) panel.close?.(opts)
      // Waiting for its workspace: nothing is open, but the close still reaches ZenKit. One that
      // doesn't keep forgets its tile and geometry, as it would have if the panel were on screen;
      // one that keeps (its node leaving) lets ZenKit check whether the node was deleted, and drop
      // its tile if so.
      else zen.panels.close?.(id, opts)
      finish()
    },
    setTitle: (t) => {
      title = t
      panel?.setTitle?.(t)
    },
    focus: reveal,
  }
  const self: Follower = {
    handle,
    again(next, nextComponent) {
      if (done) return
      spec = { ...next, id }
      component = nextComponent
      title = next.title
      // The latest caller's: one close, one callback, never a stale caller's twice.
      if (next.onClose) onClose = next.onClose
      if (next.reveal ?? true) reveal()
    },
  }

  const home = following ? ws.of(id) : null
  const start = initialDecision({
    tiledIn: home,
    current: following ? ws.current() : null,
    reveal: !!first.reveal,
  })
  if (start === 'park') {
    parked = true
    // Tell ZenKit it waits there, so the workspace counts and lists it (after a reload too).
    if (!zen.panels.get?.(id)) zen.panels.close?.(id, { keep: true })
  } else {
    if (start === 'reveal' && home) ws.activate(home)
    mount()
  }
  if (following) {
    followed.set(id, self)
    stopFollowing = ws.onChange(sync)
  }
  return handle
}

export interface ZenPanelEntry extends Omit<
  ZenPanelSpec,
  'onClose' | 'followWorkspace' | 'reveal'
> {
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
