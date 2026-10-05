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
  /** Extra rows rendered above and below what is visible. */
  overscan?: number
}

export function useVirtualGrid(
  scroller: Ref<HTMLElement | null>,
  count: () => number,
  opts: VirtualGridOptions,
) {
  const gap = opts.gap ?? 10
  const padding = opts.padding ?? 12
  const overscan = opts.overscan ?? 2
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
  const firstRow = computed(() =>
    Math.max(0, Math.floor((scrollTop.value - padding) / step.value) - overscan),
  )
  const lastRow = computed(() =>
    Math.min(rows.value, Math.ceil((scrollTop.value + height.value) / step.value) + overscan),
  )
  const start = computed(() => firstRow.value * columns.value)
  const end = computed(() => Math.min(count(), lastRow.value * columns.value))

  const containerStyle = computed(() => ({
    gridTemplateColumns: `repeat(${columns.value}, minmax(0, 1fr))`,
  }))
  /** Spacers standing in for the rows above and below the rendered slice. */
  const padTop = computed(() => ({
    gridColumn: '1 / -1',
    height: `${Math.max(0, firstRow.value * step.value - gap)}px`,
    margin: firstRow.value ? '0' : `0 0 ${-gap}px`,
  }))
  const padBottom = computed(() => ({
    gridColumn: '1 / -1',
    height: `${Math.max(0, (rows.value - lastRow.value) * step.value - gap)}px`,
  }))

  /** Re-measure a row from the first rendered card (call after the slice renders). */
  function measure(cardSelector: string) {
    const card = scroller.value?.querySelector<HTMLElement>(cardSelector)
    if (card && card.offsetHeight && Math.abs(card.offsetHeight - measured.value) > 0.5)
      measured.value = card.offsetHeight
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
