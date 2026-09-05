<script setup lang="ts">
// ZenCombo — searchable, pinnable picker (v-model). The "better dropdown": a typeahead
// menu (teleported to <body> so it escapes panel/node overflow) with keyboard nav and
// slots for custom row/selection rendering. Pass `pinned` values to float them up.
// Set `itemHeight` to virtualise the list (only visible rows render — huge lists stay
// fast and off-screen thumbnails never load). Set `menuWidth` for a roomier popover.
import { computed, nextTick, onBeforeUnmount, ref, useSlots, watch } from 'vue'
import type { ComboItem } from '../types'
import '../lib/scrollbar.css'

type Val = string | number
const props = withDefaults(
  defineProps<{
    modelValue: Val
    items: ComboItem[]
    placeholder?: string
    searchable?: boolean
    pinned?: Val[]
    emptyText?: string
    disabled?: boolean
    menuWidth?: number
    itemHeight?: number
    /** Render the menu options as a responsive grid (cards) instead of a list. */
    grid?: boolean
    /** Min column width (px) for grid mode — drives a "zoom" of the cards. */
    gridMin?: number
  }>(),
  {
    placeholder: 'Select…',
    searchable: true,
    emptyText: 'No matches',
    disabled: false,
    grid: false,
  },
)
const emit = defineEmits<{ 'update:modelValue': [Val]; open: [] }>()

const OVERSCAN = 4
const slots = useSlots()
const open = ref(false)
const query = ref('')
const active = ref(0)
const scrollTop = ref(0)
const viewportH = ref(240)
const listMaxH = ref(240)
const root = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

// grid mode never virtualises (cards are auto-height); virtual is list-only.
const virtual = computed(() => !props.grid && !!props.itemHeight && props.itemHeight > 0)
const pinnedSet = computed(() => new Set(props.pinned ?? []))
const current = computed(() => props.items.find((i) => i.value === props.modelValue))
const labelOf = (i: ComboItem) => i.label ?? String(i.value)

const filtered = computed<ComboItem[]>(() => {
  const q = query.value.trim().toLowerCase()
  let list = props.items
  if (q) {
    const terms = q.split(/\s+/)
    list = list.filter((i) => {
      const hay = (labelOf(i) + ' ' + String(i.value) + ' ' + (i.keywords ?? '')).toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }
  const pin = pinnedSet.value
  return [...list].sort((a, b) => {
    const pa = pin.has(a.value) ? 0 : 1
    const pb = pin.has(b.value) ? 0 : 1
    if (pa !== pb) return pa - pb
    return labelOf(a).localeCompare(labelOf(b))
  })
})
const firstUnpinnedIndex = computed(() =>
  filtered.value.findIndex((i) => !pinnedSet.value.has(i.value)),
)

// virtual window
const startIndex = computed(() => {
  if (!virtual.value) return 0
  return Math.max(0, Math.floor(scrollTop.value / props.itemHeight!) - OVERSCAN)
})
const windowItems = computed(() => {
  if (!virtual.value) return []
  const count = Math.ceil(viewportH.value / props.itemHeight!) + OVERSCAN * 2
  const end = Math.min(filtered.value.length, startIndex.value + count)
  const out: { item: ComboItem; index: number }[] = []
  for (let i = startIndex.value; i < end; i++) out.push({ item: filtered.value[i]!, index: i })
  return out
})

function onDoc(e: PointerEvent) {
  const t = e.target as Node
  if (root.value?.contains(t) || menuRef.value?.contains(t)) return
  close()
}
function place() {
  const trig = root.value?.querySelector('.zc-trigger') as HTMLElement | null
  if (!trig) return
  const r = trig.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const want = props.menuWidth ?? Math.max(r.width, 240)
  const width = Math.round(Math.min(want, vw - 16))
  let left = r.left
  if (left + width > vw - 8) left = vw - width - 8
  if (left < 8) left = 8
  const rows = virtual.value
    ? filtered.value.length * props.itemHeight!
    : filtered.value.length * 32
  const estH = Math.min(360, rows + (props.searchable ? 46 : 8) + 8)
  const below = vh - r.bottom
  const above = r.top
  const flipUp = below < estH + 8 && above > below
  const maxHeight = Math.max(160, Math.round((flipUp ? above : below) - 12))
  // bound the scrolling list itself (the menu only has a max-height, so flex-grow
  // would collapse to 0). list cap = available − search − footer.
  const reserved = (props.searchable ? 46 : 0) + (slots.footer ? 48 : 0) + 8
  listMaxH.value = Math.max(120, maxHeight - reserved)
  menuStyle.value = {
    left: left + 'px',
    width: width + 'px',
    maxHeight: maxHeight + 'px',
    ...(flipUp ? { bottom: vh - r.top + 4 + 'px' } : { top: r.bottom + 4 + 'px' }),
  }
}
function measure() {
  if (listRef.value) viewportH.value = listRef.value.clientHeight
}
function onScroll(e: Event) {
  scrollTop.value = (e.target as HTMLElement).scrollTop
}
function openMenu() {
  if (props.disabled) return
  emit('open') // lets consumers lazy-load list data on first open
  query.value = ''
  scrollTop.value = 0
  active.value = Math.max(
    0,
    filtered.value.findIndex((i) => i.value === props.modelValue),
  )
  place()
  open.value = true
  nextTick(() => {
    searchRef.value?.focus()
    if (listRef.value) listRef.value.scrollTop = 0
    measure()
    scrollToActive()
    window.addEventListener('pointerdown', onDoc, true)
  })
}
function close() {
  if (!open.value) return
  open.value = false
  window.removeEventListener('pointerdown', onDoc, true)
}
function pick(v: Val) {
  emit('update:modelValue', v)
  close()
}
function scrollToActive() {
  if (virtual.value) {
    const ih = props.itemHeight!
    const top = active.value * ih
    const el = listRef.value
    if (!el) return
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ih > el.scrollTop + el.clientHeight) el.scrollTop = top + ih - el.clientHeight
  } else {
    nextTick(() => {
      const el = menuRef.value?.querySelector('.zc-opt.active') as HTMLElement | null
      el?.scrollIntoView({ block: 'nearest' })
    })
  }
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') return close()
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    active.value = Math.min(active.value + 1, filtered.value.length - 1)
    scrollToActive()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    active.value = Math.max(active.value - 1, 0)
    scrollToActive()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const it = filtered.value[active.value]
    if (it) pick(it.value)
  }
}
watch(query, () => {
  active.value = 0
  scrollTop.value = 0
  if (listRef.value) listRef.value.scrollTop = 0
})
onBeforeUnmount(close)
</script>

<template>
  <div ref="root" class="zen-combo" :class="{ open, disabled }">
    <button
      type="button"
      class="zc-trigger"
      :disabled="disabled"
      @click="open ? close() : openMenu()"
    >
      <span class="zc-current">
        <slot name="selected" :item="current">{{ current ? labelOf(current) : placeholder }}</slot>
      </span>
      <i class="zc-caret mdi mdi-chevron-down" />
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="menuRef"
        class="zen-combo-menu"
        :class="{ grid }"
        :style="[menuStyle, grid && gridMin ? { '--zc-grid-min': gridMin + 'px' } : {}]"
        @keydown="onKey"
      >
        <div v-if="searchable" class="zc-search">
          <i class="mdi mdi-magnify" />
          <input
            ref="searchRef"
            v-model="query"
            type="text"
            placeholder="Search…"
            spellcheck="false"
          />
          <button v-if="query" class="zc-clear" title="Clear" @click="query = ''">
            <i class="mdi mdi-close" />
          </button>
          <!-- right-aligned actions inside the search row (e.g. a source switcher) -->
          <span v-if="$slots.search" class="zc-search-actions"><slot name="search" /></span>
        </div>

        <div
          ref="listRef"
          class="zc-list zen-scroll"
          :style="{ maxHeight: listMaxH + 'px' }"
          @scroll="onScroll"
        >
          <!-- virtualised -->
          <div
            v-if="virtual"
            class="zc-virt"
            :style="{ height: filtered.length * itemHeight! + 'px' }"
          >
            <div
              class="zc-win"
              :style="{ transform: 'translateY(' + startIndex * itemHeight! + 'px)' }"
            >
              <div
                v-for="w in windowItems"
                :key="String(w.item.value)"
                class="zc-opt"
                :style="{ height: itemHeight + 'px' }"
                :class="{
                  active: w.index === active,
                  sel: w.item.value === modelValue,
                  pinned: pinnedSet.has(w.item.value),
                }"
                @mouseenter="active = w.index"
                @click="pick(w.item.value)"
              >
                <slot
                  name="option"
                  :item="w.item"
                  :active="w.index === active"
                  :pinned="pinnedSet.has(w.item.value)"
                >
                  <span class="zc-opt-lbl">{{ labelOf(w.item) }}</span>
                </slot>
              </div>
            </div>
          </div>

          <!-- plain (auto-height rows + pinned separator) -->
          <template v-else>
            <template v-for="(it, i) in filtered" :key="String(it.value)">
              <div
                v-if="!query && firstUnpinnedIndex > 0 && i === firstUnpinnedIndex"
                class="zc-sep"
              />
              <div
                class="zc-opt"
                :class="{
                  active: i === active,
                  sel: it.value === modelValue,
                  pinned: pinnedSet.has(it.value),
                }"
                @mouseenter="active = i"
                @click="pick(it.value)"
              >
                <slot
                  name="option"
                  :item="it"
                  :active="i === active"
                  :pinned="pinnedSet.has(it.value)"
                >
                  <span class="zc-opt-lbl">{{ labelOf(it) }}</span>
                </slot>
              </div>
            </template>
          </template>

          <div v-if="!filtered.length" class="zc-empty">{{ emptyText }}</div>
        </div>

        <div v-if="$slots.footer" class="zc-footer"><slot name="footer" :close="close" /></div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* Floor so the control can never collapse to unusable — see the note in ZenColorPicker. Comfort
   is ZenRow's flex-basis (which can wrap); this only stops it vanishing. */
.zen-combo {
  position: relative;
  width: 100%;
  min-width: var(--zen-control-min, 90px);
}
.zc-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  min-height: 28px;
  background: var(--zen-input, #1b1b20);
  color: var(--zen-text, #e5e5ea);
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 7px);
  padding: 4px 8px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.12s ease;
}
.zc-trigger:hover:not(:disabled) {
  border-color: var(--zen-accent, #6366f1);
}
.zc-trigger:disabled {
  opacity: 0.5;
  cursor: default;
}
.zen-combo.open .zc-trigger {
  border-color: var(--zen-accent, #6366f1);
}
.zc-current {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.zc-caret {
  flex: none;
  color: var(--zen-muted, #9aa0aa);
  transition: transform 0.12s ease;
}
.zen-combo.open .zc-caret {
  transform: rotate(180deg);
}
</style>

<style>
/* Teleported menu — NOT scoped (lives at <body>); reads the same --zen-* tokens. */
.zen-combo-menu {
  position: fixed;
  z-index: 11000;
  display: flex;
  flex-direction: column;
  max-height: 360px;
  background: var(--zen-surface, #202026);
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 8px);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  font-family: var(--p-font-family, system-ui, sans-serif);
  color: var(--zen-text, #e5e5ea);
}
.zen-combo-menu .zc-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--zen-border, #34343c);
}
.zen-combo-menu .zc-search > .mdi {
  color: var(--zen-muted, #9aa0aa);
  font-size: 16px;
}
.zen-combo-menu .zc-search input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  color: inherit;
  font: inherit;
  font-size: 12px;
}
.zen-combo-menu .zc-clear {
  border: none;
  background: none;
  color: var(--zen-muted, #9aa0aa);
  cursor: pointer;
  padding: 0 2px;
}
.zen-combo-menu .zc-search-actions {
  flex: none;
  display: inline-flex;
  align-items: center;
}
.zen-combo-menu .zc-list {
  overflow-y: auto;
  padding: 4px;
  min-height: 0;
}
.zen-combo-menu .zc-virt {
  position: relative;
  width: 100%;
}
.zen-combo-menu .zc-win {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}
.zen-combo-menu .zc-opt {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 8px;
  border-radius: var(--zen-radius, 6px);
  cursor: pointer;
  font-size: 12px;
  box-sizing: border-box;
  overflow: hidden;
}
.zen-combo-menu .zc-opt.active {
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
}
.zen-combo-menu .zc-opt.sel {
  color: var(--zen-accent, #6366f1);
}
.zen-combo-menu .zc-opt-lbl {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zen-combo-menu .zc-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--zen-border, #34343c);
}
.zen-combo-menu .zc-empty {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--zen-muted, #9aa0aa);
}
.zen-combo-menu .zc-footer {
  border-top: 1px solid var(--zen-border, #34343c);
  padding: 6px;
}
/* grid mode: options become responsive cards (e.g. an image picker) */
.zen-combo-menu.grid .zc-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--zc-grid-min, 92px), 1fr));
  gap: 6px;
  align-content: start;
}
.zen-combo-menu.grid .zc-opt {
  flex-direction: column;
  align-items: stretch;
  height: auto;
  gap: 4px;
  padding: 4px;
}
.zen-combo-menu.grid .zc-empty {
  grid-column: 1 / -1;
}
</style>
