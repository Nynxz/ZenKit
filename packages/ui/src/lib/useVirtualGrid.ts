// A virtualized card grid: of a long list, only the rows on screen (and a few either side) are
// rendered; spacers above and below keep the scrollbar honest. Columns fill the width like
// `repeat(auto-fill, minmax(minWidth, 1fr))`, and the row height is measured from a rendered row,
// so cards can be any shape.
//
//   const vg = useVirtualGrid(scroller, () => items.length, { minWidth: 148, gap: 10 })
//   <div ref="scroller" :style="vg.containerStyle"> <div :style="vg.padTop" /> …items.slice(vg.start, vg.end)… </div>

import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'

export interface VirtualGridOptions {
  /** Smallest column width, px. */
  minWidth: () => number
  gap?: number
  /** Inner padding of the scroller, px (all sides). */
  padding?: number
  /** Row height to assume before one has been measured. */
  estimate?: (columnWidth: number) => number
  /** Extra rows rendered above and below what is visible. The rendered slice also moves in steps
   *  of this many rows, so scrolling re-renders once per `overscan` rows rather than every row. */
  overscan?: number
  /** Every row is the same height: measure one once instead of after every scroll step. */
  fixedRows?: boolean
}

export function useVirtualGrid(
  scroller: Ref<HTMLElement | null>,
  count: () => number,
  opts: VirtualGridOptions,
) {
  const gap = opts.gap ?? 10
  const padding = opts.padding ?? 12
  const overscan = Math.max(1, opts.overscan ?? 2)
  const width = ref(0)
  const height = ref(0)
  const scrollTop = ref(0)
  const measured = ref(0)

  const columns = computed(() =>
    Math.max(1, Math.floor((width.value - padding * 2 + gap) / (opts.minWidth() + gap))),
  )
  const columnWidth = computed(
    () => (width.value - padding * 2 - gap * (columns.value - 1)) / columns.value,
  )
  const rowHeight = computed(
    () => measured.value || opts.estimate?.(columnWidth.value) || columnWidth.value,
  )
  const step = computed(() => rowHeight.value + gap)
  const rows = computed(() => Math.ceil(count() / columns.value))
  const firstRow = computed(() => {
    const visible = Math.max(0, Math.floor((scrollTop.value - padding) / step.value))
    return Math.max(0, (Math.floor(visible / overscan) - 1) * overscan)
  })
  const lastRow = computed(() => {
    const visible = Math.ceil((scrollTop.value + height.value) / step.value)
    return Math.min(rows.value, (Math.ceil(visible / overscan) + 1) * overscan)
  })
  const start = computed(() => firstRow.value * columns.value)
  const end = computed(() => Math.min(count(), lastRow.value * columns.value))

  const containerStyle = computed(() => ({
    gridTemplateColumns: `repeat(${columns.value}, minmax(0, 1fr))`,
    // The spacers change height as you scroll; the browser's scroll anchoring would answer each
    // change by moving the scroll position, which re-renders the slice, and so on.
    overflowAnchor: 'none' as const,
    // Scrolled on its own compositor layer: without it, every scroll step repainted the grid and
    // re-layered the whole page, which on a page as big as ComfyUI's took longer than a frame.
    willChange: 'scroll-position',
  }))
  /** Spacers standing in for the rows above and below the rendered slice. A spacer with no rows
   *  to stand in for is taken out of the grid: as a grid item it is still a row, and the grid's
   *  gap beside it (which a negative margin can't take back) moved every card by one gap whenever
   *  the first or last row came into the slice. */
  const spacer = (hidden: number) => ({
    gridColumn: '1 / -1',
    display: hidden ? 'block' : 'none',
    height: `${Math.max(0, hidden * step.value - gap)}px`,
  })
  const padTop = computed(() => spacer(firstRow.value))
  const padBottom = computed(() => spacer(rows.value - lastRow.value))

  /** Re-measure a row from the tallest rendered card (call after the slice renders). It only
   *  grows until the column width changes: measuring whichever card came first flipped between
   *  shorter and taller cards as you scrolled, moving every row each time. */
  function measure(cardSelector: string) {
    if (opts.fixedRows && measured.value) return
    let tallest = 0
    scroller.value?.querySelectorAll<HTMLElement>(cardSelector).forEach((card) => {
      tallest = Math.max(tallest, layoutHeight(card))
    })
    if (tallest > measured.value + 0.5) measured.value = tallest
  }
  /** A card's height to the fraction of a pixel (offsetHeight rounds, and a rounded row height
   *  drifts by that much at every row); whole pixels when it's drawn scaled, e.g. on a zoomed
   *  canvas, where its on-screen height isn't its layout height. */
  function layoutHeight(card: HTMLElement) {
    const exact = card.getBoundingClientRect().height
    return Math.abs(exact - card.offsetHeight) < 1 ? exact : card.offsetHeight
  }
  /** Scroll so item `index` is in view. */
  function reveal(index: number) {
    const el = scroller.value
    if (!el || index < 0) return
    const top = padding + Math.floor(index / columns.value) * step.value
    if (top < el.scrollTop) el.scrollTop = top - padding
    else if (top + rowHeight.value > el.scrollTop + el.clientHeight)
      el.scrollTop = top + rowHeight.value - el.clientHeight + padding
  }

  const onScroll = () => (scrollTop.value = scroller.value?.scrollTop ?? 0)
  let ro: ResizeObserver | null = null
  watch(
    scroller,
    (el, old) => {
      old?.removeEventListener('scroll', onScroll)
      ro?.disconnect()
      if (!el) return
      el.addEventListener('scroll', onScroll, { passive: true })
      width.value = el.clientWidth
      height.value = el.clientHeight
      scrollTop.value = el.scrollTop
      ro = new ResizeObserver(() => {
        width.value = el.clientWidth
        height.value = el.clientHeight
      })
      ro.observe(el)
    },
    { immediate: true },
  )
  // A new column width changes the card height; measure again.
  watch(columnWidth, () => (measured.value = 0))
  onBeforeUnmount(() => {
    scroller.value?.removeEventListener('scroll', onScroll)
    ro?.disconnect()
  })

  return { start, end, columns, containerStyle, padTop, padBottom, measure, reveal }
}
