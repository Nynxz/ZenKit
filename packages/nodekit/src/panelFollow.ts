// The pure half of a popped-out panel following its workspace (see openZenPanel): whether a panel
// tiled in a workspace should be on screen, given which workspace is. No ZenKit, no Vue, so the
// rules are testable on their own.

export interface FollowState {
  /** The workspace whose tiles hold the panel (`zen.workspaces.of`); null when it isn't tiled. */
  tiledIn: string | null
  /** The workspace on screen (`zen.workspaces.current`); null when the graph is. */
  current: string | null
  /** Closed (with `keep`) because its workspace went off screen, waiting for it to come back. */
  parked: boolean
}

/**
 * What a followed panel does when the workspaces change:
 * - `hide`: open, tiled, and its workspace isn't on screen — close it, keeping its tile.
 * - `show`: parked and its workspace is on screen again — reopen it into that tile.
 * - `stay`: anything else. A floating panel (not tiled) stays as it is, and so does a parked one
 *   whose tile went away (a workflow switch or a removed workspace): it waits for an explicit open.
 */
export function followDecision(s: FollowState): 'hide' | 'show' | 'stay' {
  if (!s.tiledIn) return 'stay'
  if (!s.parked && s.current !== s.tiledIn) return 'hide'
  if (s.parked && s.current === s.tiledIn) return 'show'
  return 'stay'
}

/**
 * What the first open of a followed panel does:
 * - `open`: not tiled, or tiled in the workspace on screen — open it as usual.
 * - `park`: tiled in a workspace that isn't on screen and nobody asked to see it (a node restoring
 *   its popped-out panel on load) — don't flash it open; it shows when that workspace does.
 * - `reveal`: tiled off screen, but the user asked for it — show its workspace, then open it.
 */
export function initialDecision(s: {
  tiledIn: string | null
  current: string | null
  reveal: boolean
}): 'open' | 'park' | 'reveal' {
  if (!s.tiledIn || s.tiledIn === s.current) return 'open'
  return s.reveal ? 'reveal' : 'park'
}
