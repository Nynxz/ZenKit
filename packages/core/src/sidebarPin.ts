// Hold ComfyUI's sidebar at an EXACT pixel width.
//
// ComfyUI sizes its sidebar as a PERCENTAGE of the graph area (`SIDE_PANEL_SIZE = 20` fed to a
// PrimeVue SplitterPanel). The graph area is the `1fr` centre column of the page grid, so anything
// that reserves width in the side cells — a ZenKit dock, notably — narrows it, and the sidebar
// loses its share of those pixels. Open a 320px dock on the right and the left sidebar quietly
// shrinks with it, reflowing whatever it contains.
//
// So: remember the sidebar's width in px, and whenever the splitter container changes size,
// rewrite the percentage so the pixel width comes out the same. Dragging the gutter is untouched —
// we stand aside for the duration and read the user's new width when they let go.
//
// This deliberately reads and writes PrimeVue's own inline `flex-basis`. It writes the percentage
// back into whatever expression PrimeVue already put there (`calc(20% - 8px)`), so the gutter
// arithmetic stays theirs and this keeps working if they change it.
const PIN_LS = 'zenkit.sidebarpin.v1'
const WIDTH_LS = 'zenkit.sidebarpx.v1'

/** Sane bounds for a sidebar, in px. Keeps a bad stored value from wedging the layout. */
const MIN_PX = 160
const MAX_PX = 1200
/** Never let the donor panel (the graph) be squeezed below this share of the splitter. */
const MIN_DONOR_PCT = 15

/** PrimeVue writes `flex-basis: calc(<pct>% - <n>px)`. Swap only the percentage. */
const PCT_RE = /(-?\d*\.?\d+)%/

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function readPct(el: HTMLElement): number | null {
  const m = PCT_RE.exec(el.style.flexBasis || '')
  return m ? parseFloat(m[1]!) : null
}
function writePct(el: HTMLElement, pct: number) {
  const basis = el.style.flexBasis
  const v = pct.toFixed(4)
  el.style.flexBasis = basis && PCT_RE.test(basis) ? basis.replace(PCT_RE, `${v}%`) : `${v}%`
}

/** The visible sidebar splitter panel, whichever side it is on (ComfyUI puts `.side-bar-panel`
 *  on the first panel when the sidebar is left, the last when it is right). */
function findSidebar(): HTMLElement | null {
  const el = document.querySelector('.p-splitterpanel.side-bar-panel')
  if (!(el instanceof HTMLElement)) return null
  // offsetParent is null while it is display:none (collapsed / focus mode).
  return el.offsetParent === null ? null : el
}

/** The panel that gives up the width the sidebar takes: the widest sibling, i.e. the graph. */
function donorFor(splitter: HTMLElement, sidebar: HTMLElement): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestW = -1
  for (const child of Array.from(splitter.children)) {
    if (!(child instanceof HTMLElement)) continue
    if (child === sidebar || !child.classList.contains('p-splitterpanel')) continue
    const w = child.getBoundingClientRect().width
    if (w > bestW) {
      bestW = w
      best = child
    }
  }
  return best
}

let enabled = loadEnabled()
let desiredPx = loadWidth()
let dragging = false
let lastW = -1
let ro: ResizeObserver | null = null
let observed: HTMLElement | null = null
let started = false
let queued = false

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(PIN_LS) !== '0'
  } catch {
    return true
  }
}
function loadWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_LS))
    return Number.isFinite(v) && v > 0 ? clamp(v, MIN_PX, MAX_PX) : 0
  } catch {
    return 0
  }
}
function saveWidth(px: number) {
  desiredPx = clamp(px, MIN_PX, MAX_PX)
  try {
    localStorage.setItem(WIDTH_LS, String(Math.round(desiredPx)))
  } catch {
    /* ignore */
  }
}

/** Re-point the ResizeObserver when the splitter element is replaced (ComfyUI rebuilds it via
 *  `splitterRefreshKey`, and the old observation dies with the old node). */
function observe(splitter: HTMLElement) {
  if (observed === splitter) return
  ro?.disconnect()
  observed = splitter
  if (typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(() => schedule())
  ro.observe(splitter)
}

function apply() {
  if (!enabled || dragging) return
  const sb = findSidebar()
  if (!sb) return
  const splitter = sb.parentElement
  if (!splitter) return
  observe(splitter)

  const W = splitter.clientWidth
  if (W <= 0) return
  const curPct = readPct(sb)
  if (curPct == null) return // PrimeVue hasn't sized it yet — try again on the next event

  // First sighting: adopt whatever width it currently has as the one to hold.
  if (!desiredPx) {
    const px = sb.getBoundingClientRect().width
    if (px <= 0) return
    saveWidth(px)
    lastW = W
    return
  }
  if (W === lastW) return // container unchanged; the sidebar is already where we put it
  lastW = W

  // A CSS min-width (ComfyUI's `min-w-78`) would win over any smaller basis we set, and the
  // donor would be handed width the sidebar never gives back. Respect it.
  const minPx = parseFloat(getComputedStyle(sb).minWidth) || 0
  const want = clamp(Math.max(desiredPx, minPx), MIN_PX, Math.min(MAX_PX, W))

  const donor = donorFor(splitter, sb)
  if (!donor) return
  void curPct // the pass below re-reads it; kept above only to know PrimeVue has sized things

  // Correct by MEASUREMENT rather than by deriving a percentage from `want / W`. A splitter panel
  // is `flex-grow: 1`, so its rendered width is its basis PLUS a share of the leftover, and the
  // gutter and any min-width push it further off. Rather than model all that, nudge the
  // percentage by the observed error and re-measure; it is linear, so one correction lands it.
  for (let pass = 0; pass < 2; pass++) {
    const pct = readPct(sb)
    const donorPct = readPct(donor)
    if (pct == null || donorPct == null) return
    const errPx = want - sb.getBoundingClientRect().width
    if (Math.abs(errPx) < 0.5) return
    const wantPct = clamp(pct + (errPx / W) * 100, 1, 100 - MIN_DONOR_PCT)
    const moved = wantPct - pct
    if (Math.abs(moved) < 0.01) return
    if (donorPct - moved < MIN_DONOR_PCT) return
    writePct(sb, wantPct)
    writePct(donor, donorPct - moved)
  }
}

function schedule() {
  if (queued) return
  queued = true
  requestAnimationFrame(() => {
    queued = false
    try {
      apply()
    } catch (e) {
      console.error('[ZenKit] sidebar pin failed', e)
    }
  })
}

/** Start holding the sidebar width. Idempotent; safe before ComfyUI's layout exists. */
export function startSidebarPin(): void {
  if (started) return
  started = true

  // Stand aside for a gutter drag: the user is choosing a width, and whatever they land on
  // becomes the new one to hold.
  document.addEventListener(
    'pointerdown',
    (e) => {
      const t = e.target
      if (t instanceof Element && t.closest('.p-splitter-gutter')) dragging = true
    },
    true,
  )
  const endDrag = () => {
    if (!dragging) return
    dragging = false
    const sb = findSidebar()
    const px = sb?.getBoundingClientRect().width ?? 0
    if (px > 0) saveWidth(px)
    lastW = sb?.parentElement?.clientWidth ?? -1
  }
  window.addEventListener('pointerup', endDrag, true)
  window.addEventListener('pointercancel', endDrag, true)
  // ZenKit's dock reserve dispatches a window resize (tiling.ts nudgeCanvas), so this covers
  // dock changes as well as real window resizes.
  window.addEventListener('resize', schedule)

  // The splitter mounts after us; poll briefly until it appears, then the observers take over.
  let tries = 0
  const wait = () => {
    if (findSidebar()) return schedule()
    if (++tries > 240) return
    requestAnimationFrame(wait)
  }
  wait()
}

/** Whether the sidebar width is pinned (persisted; default on). */
export function sidebarPinEnabled(): boolean {
  return enabled
}

/** Turn the pin on/off and persist it. Turning it off leaves the sidebar wherever it is —
 *  ComfyUI's own percentage takes over again from the next resize. */
export function setSidebarPin(on: boolean): void {
  enabled = !!on
  try {
    localStorage.setItem(PIN_LS, on ? '1' : '0')
  } catch {
    /* ignore */
  }
  if (enabled) {
    lastW = -1 // force the next apply to correct
    schedule()
  }
}

/** Forget the remembered width and re-adopt whatever the sidebar is right now. */
export function resetSidebarPin(): void {
  desiredPx = 0
  try {
    localStorage.removeItem(WIDTH_LS)
  } catch {
    /* ignore */
  }
  lastW = -1
  schedule()
}
