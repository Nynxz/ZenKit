<script setup lang="ts">
// Gallery — a plain media gallery (no channels / sync / compare). Items come from
// openGallery(payload) (picked up on mount by panel id) and are then persisted via
// PanelContext so a reload restores the same gallery. Reuses the ZenLightbox stage
// + thumbnail strip + zoom/rotate/slideshow footer.
import { computed, onMounted, ref, watch } from 'vue'
import { ZenLightbox, type LightboxItem } from '@nynxz/zenkit-ui'
import type { PanelContext } from '@nynxz/zenkit-client'
import { takePendingGallery } from '@/lib/gallery'

const props = defineProps<{ ctx?: PanelContext }>()
const saved = (props.ctx?.state as Record<string, unknown>) || {}

const items = ref<LightboxItem[]>([])
const index = ref(0)
const showThumbs = ref<boolean>(saved.showThumbs !== false)
const slideMs = ref<number>(typeof saved.slideMs === 'number' ? saved.slideMs : 3000)

onMounted(() => {
  const payload = takePendingGallery(props.ctx?.id)
  if (payload) {
    items.value = payload.items
    index.value = Math.max(0, Math.min(payload.index ?? 0, payload.items.length - 1))
  } else if (Array.isArray(saved.items)) {
    items.value = saved.items as LightboxItem[]
    index.value = typeof saved.index === 'number' ? saved.index : 0
  }
})

watch(
  [items, index, showThumbs, slideMs],
  () => {
    props.ctx?.setState({
      items: items.value,
      index: index.value,
      showThumbs: showThumbs.value,
      slideMs: slideMs.value,
    })
  },
  { deep: true },
)

const lb = ref<InstanceType<typeof ZenLightbox> | null>(null)
const ddOpen = ref(false)
const INTERVALS = [1000, 2000, 3000, 5000, 10000]
const zoomPct = computed(() => Math.round((lb.value?.zoom ?? 1) * 100))
const playing = computed(() => lb.value?.playing ?? false)
const safeIndex = computed(() => Math.max(0, Math.min(index.value, items.value.length - 1)))

function onIndex(i: number) {
  index.value = i
}
function pick(i: number) {
  index.value = i
}
function removeAt(i: number, ev?: Event) {
  ev?.stopPropagation()
  const next = items.value.filter((_, n) => n !== i)
  items.value = next
  if (index.value >= next.length) index.value = Math.max(0, next.length - 1)
}
function clearAll() {
  items.value = []
  index.value = 0
}
function setInterval(ms: number) {
  slideMs.value = ms
  ddOpen.value = false
}
</script>

<template>
  <div class="gv">
    <div class="gv-head">
      <i class="mdi mdi-image-multiple gv-h-ico" />
      <span class="gv-count">{{ items.length }} item{{ items.length === 1 ? '' : 's' }}</span>
      <span class="grow" />
      <button
        v-if="items.length"
        class="tb"
        :class="{ on: showThumbs }"
        title="Toggle thumbnails"
        @click="showThumbs = !showThumbs"
      >
        <i class="mdi mdi-view-gallery-outline" />
      </button>
      <button v-if="items.length" class="tb danger" title="Clear gallery" @click="clearAll">
        <i class="mdi mdi-delete-sweep-outline" />
      </button>
    </div>

    <div class="gv-stage">
      <ZenLightbox
        v-if="items.length"
        ref="lb"
        inline
        controls="none"
        :items="items"
        :index="safeIndex"
        :slideshow-ms="slideMs"
        @update:index="onIndex"
      />
      <div v-else class="gv-empty">
        <i class="mdi mdi-image-off-outline gv-empty-icon" />
        <p class="gv-empty-title">Empty gallery</p>
        <p class="gv-empty-sub">
          Open a gallery from another panel (e.g. the Asset Browser's “Open as gallery”).
        </p>
      </div>
    </div>

    <div v-if="items.length" class="gv-foot">
      <button class="tb" title="Previous" :disabled="safeIndex <= 0" @click="lb?.prev()">
        <i class="mdi mdi-chevron-left" />
      </button>
      <button class="tb" title="Next" :disabled="safeIndex >= items.length - 1" @click="lb?.next()">
        <i class="mdi mdi-chevron-right" />
      </button>
      <span class="gv-sep" />
      <button class="tb" title="Zoom out" @click="lb?.zoomOut()">
        <i class="mdi mdi-magnify-minus-outline" />
      </button>
      <span class="gv-z">{{ zoomPct }}%</span>
      <button class="tb" title="Zoom in" @click="lb?.zoomIn()">
        <i class="mdi mdi-magnify-plus-outline" />
      </button>
      <button class="tb" title="Fit / reset" @click="lb?.reset()">
        <i class="mdi mdi-fit-to-screen-outline" />
      </button>
      <span class="gv-sep" />
      <button class="tb" title="Rotate left" @click="lb?.rotate(-90)">
        <i class="mdi mdi-rotate-left" />
      </button>
      <button class="tb" title="Rotate right" @click="lb?.rotate(90)">
        <i class="mdi mdi-rotate-right" />
      </button>
      <span class="gv-sep" />
      <div class="gv-dd up">
        <button class="tb" :class="{ on: playing }" title="Slideshow" @click="lb?.togglePlay()">
          <i class="mdi" :class="playing ? 'mdi-pause' : 'mdi-play'" />
        </button>
        <button class="tb caret" title="Slideshow interval" @click="ddOpen = !ddOpen">
          <i class="mdi mdi-menu-up" />
        </button>
        <div v-if="ddOpen" class="gv-dd-menu up">
          <div class="gv-dd-h">Slideshow interval</div>
          <button
            v-for="ms in INTERVALS"
            :key="ms"
            :class="{ on: slideMs === ms }"
            @click="setInterval(ms)"
          >
            {{ ms / 1000 }}s
          </button>
        </div>
      </div>
    </div>

    <div v-if="items.length && showThumbs" class="gv-strip">
      <div
        v-for="(it, i) in items"
        :key="i"
        class="gv-thumb"
        :class="{ active: i === safeIndex }"
        :title="it.label || ''"
        @click="pick(i)"
      >
        <img :src="it.src" alt="" />
        <button class="gv-thumb-x" title="Remove" @click="removeAt(i, $event)">
          <i class="mdi mdi-close" />
        </button>
      </div>
    </div>

    <div v-if="ddOpen" class="gv-dd-backdrop" @click="ddOpen = false" />
  </div>
</template>

<style scoped>
.gv {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--zen-bg, #1a1a1f);
  color: var(--zen-text, #e5e5ea);
  font-family: var(--p-font-family, system-ui, sans-serif);
}
.gv-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: 12px;
  border-bottom: 1px solid var(--zen-border, rgba(255, 255, 255, 0.08));
}
.gv-h-ico {
  font-size: 15px;
  color: var(--zen-accent, #3b82f6);
}
.gv-count {
  font-size: 11px;
  color: var(--zen-muted, #9aa0aa);
}
.grow {
  flex: 1;
}
.gv-sep {
  width: 1px;
  align-self: stretch;
  margin: 3px 4px;
  background: var(--zen-border, rgba(255, 255, 255, 0.1));
}

.tb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--zen-text, #e5e5ea);
  cursor: pointer;
}
.tb:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 12%, transparent);
}
.tb:disabled {
  opacity: 0.3;
  cursor: default;
}
.tb.on {
  background: var(--zen-accent, #3b82f6);
  color: var(--zen-accent-text, #fff);
}
.tb.danger:hover {
  background: #b91c1c;
  color: #fff;
}
.tb .mdi {
  font-size: 16px;
}
.tb.caret {
  width: 16px;
}
.gv-z {
  font-size: 11px;
  color: var(--zen-muted, #9aa0aa);
  min-width: 38px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.gv-dd {
  position: relative;
  display: inline-flex;
}
.gv-dd-menu {
  position: absolute;
  z-index: 20;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 120px;
  background: var(--zen-surface, #26262c);
  border: 1px solid var(--zen-border, rgba(255, 255, 255, 0.14));
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.gv-dd-menu.up {
  bottom: 100%;
  left: 0;
  margin-bottom: 4px;
}
.gv-dd-h {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--zen-muted, #9aa0aa);
  padding: 2px 4px 4px;
}
.gv-dd-menu button {
  text-align: left;
  padding: 5px 8px;
  font-size: 12px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--zen-text, #e5e5ea);
  cursor: pointer;
}
.gv-dd-menu button:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
}
.gv-dd-menu button.on {
  background: var(--zen-accent, #3b82f6);
  color: var(--zen-accent-text, #fff);
}
.gv-dd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 15;
}

.gv-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 5px 8px;
  border-top: 1px solid var(--zen-border, rgba(255, 255, 255, 0.08));
  background: var(--zen-surface-2, rgba(0, 0, 0, 0.18));
}

.gv-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}
.gv-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
  padding: 24px;
  color: var(--zen-muted, #9aa0aa);
}
.gv-empty-icon {
  font-size: 46px;
  opacity: 0.5;
  margin-bottom: 4px;
}
.gv-empty-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--zen-text);
}
.gv-empty-sub {
  margin: 0;
  font-size: 12.5px;
  opacity: 0.75;
  max-width: 300px;
}

.gv-strip {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
  padding: 8px;
  overflow-x: auto;
  border-top: 1px solid var(--zen-border, rgba(255, 255, 255, 0.08));
  background: var(--zen-surface-2, rgba(0, 0, 0, 0.2));
}
.gv-thumb {
  position: relative;
  flex: 0 0 auto;
  width: 52px;
  height: 52px;
  border: 2px solid transparent;
  border-radius: 5px;
  overflow: hidden;
  cursor: pointer;
  background: var(--zen-input, #15151a);
  transition: border-color 0.12s ease;
}
.gv-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.gv-thumb:hover {
  border-color: var(--zen-muted, rgba(255, 255, 255, 0.3));
}
.gv-thumb.active {
  border-color: var(--zen-accent, #7aa2ff);
}
.gv-thumb-x {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 13px;
  line-height: 1;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s ease;
}
.gv-thumb:hover .gv-thumb-x {
  opacity: 1;
}
.gv-thumb-x:hover {
  background: #b91c1c;
}
</style>
