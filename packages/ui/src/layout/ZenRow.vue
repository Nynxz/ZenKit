<script setup lang="ts">
// A row of controls that wraps instead of squashing — flex shrinks items past usefulness, and a
// node body is only ~300px wide.
//
// Children are fixed-size by default; `data-grow` gets `flex: 1 1 <min>`. Using the minimum as
// the flex-basis is the trick: a growable child that can't get its minimum wraps rather than
// shrinking below it.
//
//   <ZenRow :min="140">
//     <ZenSelect data-grow v-model="preset" :options="opts" />
//     <ZenIconButton icon="mdi mdi-plus" @click="add" />
//   </ZenRow>
//
// `min` is per-row: a long preset list wants ~160px, a two-item toggle ~90px.
withDefaults(
  defineProps<{
    /** Flex basis for `data-grow` children, in px. They wrap rather than shrink below it. */
    min?: number
    /** Gap between items, in px. */
    gap?: number
    align?: 'center' | 'start' | 'end' | 'stretch'
    /** Let the row wrap onto multiple lines (default). `false` for a strict single line. */
    wrap?: boolean
  }>(),
  { min: 120, gap: 6, align: 'center', wrap: true },
)
</script>

<template>
  <div
    class="zen-row"
    :style="{
      '--zen-row-min': `${min}px`,
      gap: `${gap}px`,
      alignItems: align === 'start' ? 'flex-start' : align === 'end' ? 'flex-end' : align,
      flexWrap: wrap ? 'wrap' : 'nowrap',
    }"
  >
    <slot />
  </div>
</template>

<style scoped>
.zen-row {
  display: flex;
  width: 100%;
  min-width: 0;
}

/* Fixed by default — a button or a readout should never be stretched or crushed.
 *
 * `width: auto` is load-bearing. Several inputs (ZenCombo, ZenColorPicker) are `width: 100%`
 * because their usual home is a stacked panel form. In a ROW that reads as "give me the whole
 * line", and with `flex-basis: auto` resolving to that width, one greedy child crushes every
 * sibling. Neutralising width here lets each control size to its content and `flex` do the
 * rest — which is why consumers don't have to know which components are greedy. */
.zen-row > :deep(*) {
  flex: 0 0 auto;
  width: auto;
}

/* Growable: basis = the minimum, so the row wraps before it squashes. `min-width: 0` still
   matters — without it a long unbreakable label sets an intrinsic floor that beats the basis
   and the row overflows instead of wrapping. */
.zen-row > :deep([data-grow]) {
  flex: 1 1 var(--zen-row-min, 120px);
  width: auto;
  /* Beats the components' own `--zen-control-min` floor: inside a row the BASIS is what should
     decide when to wrap, and a floor larger than the basis would force an overflow instead. */
  min-width: 0;
}
</style>
