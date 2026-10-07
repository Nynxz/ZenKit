<template>
  <ZenView :pad="false">
    <template #toolbar>
      <ZenToolbar title="Component gallery" icon="mdi mdi-view-grid-outline">
        <template #start>
          <span class="soft">{{ shown }} components</span>
        </template>
        <ZenInput v-model="filter" sm placeholder="Filter by name" class="filter" />
      </ZenToolbar>
    </template>

    <div class="gallery">
      <section v-for="group in visible" :key="group.title" class="group">
        <h3>{{ group.title }}</h3>
        <div class="grid">
          <article
            v-for="name in group.items"
            :key="name"
            class="spec"
            :class="{ wide: WIDE.has(name) }"
          >
            <h4>{{ name }}</h4>

            <template v-if="name === 'Control heights'">
              <div v-for="sz in SIZES" :key="sz" class="line nowrap">
                <span class="soft sz">{{ sz }}</span>
                <ZenButton :size="sz">Button</ZenButton>
                <ZenIconButton :size="sz" icon="mdi mdi-cog-outline" title="Icon button" />
                <ZenInput v-model="text" :size="sz" class="w120" />
                <ZenNumber v-model="num" :size="sz" class="w110" />
                <ZenSelect v-model="choice" :size="sz" :options="CHOICES" class="w120" />
                <ZenCombo v-model="combo" :size="sz" :items="COMBO" class="w120" />
                <ZenToggleGroup
                  v-model="toggle"
                  :size="sz"
                  :options="[
                    { value: 'a', label: 'One' },
                    { value: 'b', label: 'Two' },
                  ]"
                />
              </div>
              <div class="line nowrap">
                <span class="soft sz">off</span>
                <ZenButton disabled>Button</ZenButton>
                <ZenIconButton disabled icon="mdi mdi-cog-outline" title="Icon button" />
                <ZenInput v-model="text" disabled class="w120" />
                <ZenNumber v-model="num" disabled class="w110" />
                <ZenSelect v-model="choice" disabled :options="CHOICES" class="w120" />
                <ZenCombo v-model="combo" disabled :items="COMBO" class="w120" />
                <ZenToggleGroup
                  v-model="toggle"
                  disabled
                  :options="[
                    { value: 'a', label: 'One' },
                    { value: 'b', label: 'Two' },
                  ]"
                />
              </div>
            </template>

            <template v-else-if="name === 'ZenButton'">
              <div class="line">
                <ZenButton>Default</ZenButton>
                <ZenButton variant="primary" icon="mdi mdi-play">Primary</ZenButton>
                <ZenButton variant="ghost">Ghost</ZenButton>
                <ZenButton variant="danger" icon="mdi mdi-delete-outline">Danger</ZenButton>
              </div>
              <div class="line">
                <ZenButton sm>Small</ZenButton>
                <ZenButton sm variant="primary">Small primary</ZenButton>
                <ZenButton disabled>Disabled</ZenButton>
                <ZenButton variant="primary" disabled>Disabled primary</ZenButton>
              </div>
              <ZenButton block icon="mdi mdi-plus">Block</ZenButton>
            </template>

            <template v-else-if="name === 'ZenIconButton'">
              <div class="line">
                <ZenIconButton icon="mdi mdi-cog-outline" title="Default" />
                <ZenIconButton icon="mdi mdi-magnet" active title="Active" />
                <ZenIconButton icon="mdi mdi-delete-outline" danger title="Danger" />
                <ZenIconButton icon="mdi mdi-lock-outline" disabled title="Disabled" />
              </div>
            </template>

            <template v-else-if="name === 'ZenInput'">
              <ZenInput v-model="text" placeholder="Text" />
              <ZenInput v-model="text" sm placeholder="Small" />
              <ZenInput v-model="secret" type="password" placeholder="Password" />
              <ZenInput v-model="text" disabled placeholder="Disabled" />
              <ZenInput v-model="long" type="textarea" autosize :rows="2" />
            </template>

            <template v-else-if="name === 'ZenNumber'">
              <ZenNumber v-model="num" :min="0" :max="100" :step="1" />
              <ZenNumber v-model="frac" :min="0" :max="1" :step="0.05" :precision="2" />
              <ZenNumber v-model="num" bare />
              <ZenNumber v-model="num" disabled />
            </template>

            <template v-else-if="name === 'ZenSlider'">
              <ZenSlider v-model="frac" :min="0" :max="1" :step="0.01" />
              <ZenSlider v-model="frac" :min="0" :max="1" :step="0.01" disabled />
            </template>

            <template v-else-if="name === 'ZenSelect'">
              <ZenSelect v-model="choice" :options="CHOICES" />
              <ZenSelect v-model="none" :options="CHOICES" placeholder="Nothing picked" />
            </template>

            <template v-else-if="name === 'ZenCombo'">
              <ZenCombo v-model="combo" :items="COMBO" searchable placeholder="Search a sampler" />
              <ZenCombo v-model="combo" :items="COMBO" disabled />
            </template>

            <template v-else-if="name === 'ZenSwitch / ZenCheckbox / ZenDot'">
              <div class="line">
                <ZenSwitch v-model="on" />
                <ZenSwitch v-model="on" disabled />
                <ZenCheckbox v-model="on" label="Checkbox" />
                <ZenCheckbox v-model="on" label="Disabled" disabled />
              </div>
              <div class="line">
                <ZenDot v-model="on" label="Dot" />
                <ZenDot v-model="on" color="#e0a54a" label="Coloured" />
                <ZenDot v-model="on" label="Disabled" disabled />
              </div>
            </template>

            <template v-else-if="name === 'ZenToggleGroup'">
              <ZenToggleGroup
                v-model="toggle"
                :options="[
                  { value: 'a', label: 'One' },
                  { value: 'b', label: 'Two' },
                  { value: 'c', label: 'Three' },
                ]"
              />
              <ZenToggleGroup
                v-model="toggle"
                :options="[
                  { value: 'a', icon: 'mdi mdi-format-align-left', title: 'Left' },
                  { value: 'b', icon: 'mdi mdi-format-align-center', title: 'Centre' },
                  { value: 'c', icon: 'mdi mdi-format-align-right', title: 'Right' },
                ]"
              />
            </template>

            <template v-else-if="name === 'ZenColorPicker'">
              <ZenColorPicker v-model="color" />
              <ZenColorPicker v-model="color" compact />
            </template>

            <template v-else-if="name === 'ZenVolume'">
              <ZenVolume v-model:volume="volume" v-model:muted="muted" show-value />
            </template>

            <template v-else-if="name === 'ZenDimensions'">
              <ZenDimensions v-model="dims" show-lock show-swap show-mp show-aspect />
            </template>

            <template v-else-if="name === 'ZenResolution'">
              <ZenResolution v-model:width="res.width" v-model:height="res.height" />
            </template>

            <template v-else-if="name === 'ZenMentionInput'">
              <ZenMentionInput
                v-model="mention"
                :items="MENTIONS"
                placeholder="Type @ to mention"
              />
            </template>

            <template v-else-if="name === 'ZenCurveEditor'">
              <ZenCurveEditor v-model="curve" :min="0" :max="2" :unit="1" />
            </template>

            <template v-else-if="name === 'ZenField / ZenRow'">
              <ZenField label="Steps" hint="How many denoising steps">
                <ZenNumber v-model="num" />
              </ZenField>
              <ZenField label="Prompt" stack>
                <ZenInput v-model="text" />
              </ZenField>
              <ZenRow :gap="6">
                <ZenButton sm>Row</ZenButton>
                <ZenButton sm>of</ZenButton>
                <ZenButton sm>buttons</ZenButton>
              </ZenRow>
            </template>

            <template v-else-if="name === 'ZenSection'">
              <ZenSection title="Plain section" icon="mdi-tune">
                <template #meta>meta text</template>
                <span class="soft">Body of a plain section.</span>
                <ZenSection title="Nested card" icon="mdi-auto-fix" variant="card">
                  <template #actions><ZenIconButton icon="mdi mdi-dots-horizontal" /></template>
                  <span class="soft">A card inside it — folds on its own.</span>
                </ZenSection>
              </ZenSection>
              <ZenSection title="Not collapsible" :collapsible="false">
                <span class="soft">Always open.</span>
              </ZenSection>
              <ZenSection title="Disabled" disabled>
                <span class="soft">Can't toggle.</span>
              </ZenSection>
            </template>

            <template v-else-if="name === 'ZenSections (accordion)'">
              <ZenSections v-model="accordion" accordion :gap="6">
                <ZenSection value="a" title="First" variant="card">
                  <span class="soft">One</span>
                </ZenSection>
                <ZenSection value="b" title="Second" variant="card">
                  <span class="soft">Two</span>
                </ZenSection>
                <ZenSection value="c" title="Third" variant="card">
                  <span class="soft">Three</span>
                </ZenSection>
              </ZenSections>
            </template>

            <template v-else-if="name === 'ZenSplit'">
              <div class="splitbox">
                <ZenSplit :panes="[{ size: 0.35, min: 60 }, { min: 60 }]">
                  <template #pane-0><div class="pane">Left (drag the line)</div></template>
                  <template #pane-1><div class="pane">Right</div></template>
                </ZenSplit>
              </div>
              <div class="splitbox">
                <ZenSplit gutter="gap" :panes="[{ size: 0.35, min: 60 }, { min: 60 }]">
                  <template #pane-0><div class="pane card">gutter="gap"</div></template>
                  <template #pane-1><div class="pane card">Right</div></template>
                </ZenSplit>
              </div>
            </template>

            <template v-else-if="name === 'ZenEmpty'">
              <ZenEmpty title="Nothing here yet" icon="mdi mdi-folder-open-outline">
                Drop files here or pick some.
                <template #actions><ZenButton sm variant="primary">Add files</ZenButton></template>
              </ZenEmpty>
            </template>

            <template v-else-if="name === 'ZenToolbar'">
              <ZenToolbar title="Toolbar title" icon="mdi mdi-image-multiple-outline">
                <template #start><span class="soft">12 items</span></template>
                <ZenIconButton icon="mdi mdi-magnify" title="Search" />
                <ZenIconButton icon="mdi mdi-dots-vertical" title="More" />
              </ZenToolbar>
            </template>

            <template v-else-if="name === 'ZenModal / ZenPopover / ZenContextMenu'">
              <div class="line">
                <ZenButton @click="modal = true">Open modal</ZenButton>
                <ZenButton @click="togglePop">Popover</ZenButton>
                <ZenButton @click="menuAt">Context menu</ZenButton>
              </div>
            </template>

            <template v-else-if="name === 'JsonTree'">
              <JsonTree :data="JSON_DATA" :default-open="1" />
            </template>

            <template v-else-if="name === 'ZenFolderTree'">
              <ZenFolderTree v-model="folder" :folders="FOLDERS" />
            </template>

            <template v-else-if="name === 'ZenStepChart'">
              <ZenStepChart :sigmas="SIGMAS" :deltas="DELTAS" :total="20" :current="12" />
            </template>
          </article>
        </div>
      </section>
    </div>

    <!-- Outside the specimen loop: a template ref inside v-for is an array, not the component. -->
    <ZenModal v-model:open="modal" title="A modal" width="420px">
      <p>Modal body. Escape or the × closes it.</p>
      <template #footer>
        <ZenButton @click="modal = false">Cancel</ZenButton>
        <ZenButton variant="primary" @click="modal = false">OK</ZenButton>
      </template>
    </ZenModal>
    <ZenPopover v-model:open="pop" :anchor="popEl">
      <div class="popbody">A popover, anchored to its button.</div>
    </ZenPopover>
    <ZenContextMenu ref="menu" :items="MENU" />
  </ZenView>
</template>

<script setup lang="ts">
// A gallery of every @nynxz/zenkit-ui component in its usual states, to judge them side by side
// (and in the light and dark themes) while polishing. Nothing here is wired to ComfyUI.
import { computed, reactive, ref } from 'vue'
import {
  JsonTree,
  ZenButton,
  ZenCheckbox,
  ZenColorPicker,
  ZenCombo,
  ZenContextMenu,
  ZenCurveEditor,
  ZenDimensions,
  ZenDot,
  ZenEmpty,
  ZenField,
  ZenFolderTree,
  ZenIconButton,
  ZenInput,
  ZenMentionInput,
  ZenModal,
  ZenNumber,
  ZenPopover,
  ZenResolution,
  ZenRow,
  ZenSection,
  ZenSections,
  ZenSelect,
  ZenSlider,
  ZenSplit,
  ZenStepChart,
  ZenSwitch,
  ZenToggleGroup,
  ZenToolbar,
  ZenView,
  ZenVolume,
  type ComboItem,
  type ContextMenuItem,
  type CurvePoint,
  type FolderTreeEntry,
  type MentionItem,
} from '@nynxz/zenkit-ui'

const GROUPS = [
  { title: 'Actions', items: ['Control heights', 'ZenButton', 'ZenIconButton'] },
  {
    title: 'Inputs',
    items: [
      'ZenInput',
      'ZenNumber',
      'ZenSlider',
      'ZenSelect',
      'ZenCombo',
      'ZenSwitch / ZenCheckbox / ZenDot',
      'ZenToggleGroup',
      'ZenColorPicker',
      'ZenVolume',
      'ZenMentionInput',
    ],
  },
  { title: 'Sizes and curves', items: ['ZenDimensions', 'ZenResolution', 'ZenCurveEditor'] },
  {
    title: 'Layout',
    items: [
      'ZenField / ZenRow',
      'ZenSection',
      'ZenSections (accordion)',
      'ZenSplit',
      'ZenToolbar',
      'ZenEmpty',
    ],
  },
  { title: 'Overlays', items: ['ZenModal / ZenPopover / ZenContextMenu'] },
  { title: 'Data', items: ['JsonTree', 'ZenFolderTree', 'ZenStepChart'] },
]
const SIZES = ['md', 'sm'] as const
const WIDE = new Set([
  'Control heights',
  'ZenButton',
  'ZenSection',
  'ZenSplit',
  'ZenDimensions',
  'ZenResolution',
  'ZenCurveEditor',
  'ZenStepChart',
])

const filter = ref('')
const visible = computed(() =>
  GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((n) => n.toLowerCase().includes(filter.value.toLowerCase())),
  })).filter((g) => g.items.length),
)
const shown = computed(() => visible.value.reduce((n, g) => n + g.items.length, 0))

const text = ref('Some text')
const secret = ref('hunter2')
const long = ref('A longer piece of text that wraps onto a second line when the box is narrow.')
const num = ref(20)
const frac = ref(0.35)
const choice = ref('euler')
const none = ref('')
const CHOICES = [
  { value: 'euler', label: 'Euler' },
  { value: 'dpmpp_2m', label: 'DPM++ 2M' },
  { value: 'res_multistep', label: 'Res multistep (a long label)' },
]
const combo = ref<string | number>('euler')
const COMBO: ComboItem[] = [
  'euler',
  'euler_ancestral',
  'heun',
  'dpm_2',
  'dpmpp_2m',
  'dpmpp_sde',
  'lcm',
  'res_multistep',
].map((v) => ({ value: v, label: v }))
const on = ref(true)
const toggle = ref('b')
const color = ref('#6366f1')
const volume = ref(0.7)
const muted = ref(false)
const dims = ref({ width: 1024, height: 768 })
const res = reactive({ width: 1216, height: 832 })
const mention = ref('A portrait of @maren in @greenhouse')
const MENTIONS: MentionItem[] = [
  { key: 'maren', detail: 'a woman in her sixties' },
  { key: 'greenhouse', detail: 'a Victorian glass greenhouse' },
  { key: 'lantern', detail: 'a brass hurricane lantern' },
]
const curve = ref<CurvePoint[]>([
  { x: 0, y: 1 },
  { x: 0.5, y: 1.6 },
  { x: 1, y: 0.4 },
])
const accordion = ref<string | null>('a')
const modal = ref(false)
const pop = ref(false)
const popEl = ref<HTMLElement | null>(null)
function togglePop(e: MouseEvent) {
  popEl.value = e.currentTarget as HTMLElement
  pop.value = !pop.value
}
const menu = ref<InstanceType<typeof ZenContextMenu> | null>(null)
const MENU: ContextMenuItem[] = [
  { heading: 'Clip' },
  { label: 'Split here', icon: 'mdi mdi-content-cut', hint: 'B', run: () => undefined },
  { label: 'Duplicate', icon: 'mdi mdi-content-duplicate', hint: 'Ctrl+D', run: () => undefined },
  { label: 'Disabled item', icon: 'mdi mdi-lock-outline', disabled: true, run: () => undefined },
  '-',
  { label: 'Remove', icon: 'mdi mdi-trash-can-outline', danger: true, run: () => undefined },
]
const menuAt = (e: MouseEvent) => void menu.value?.show(e)
const JSON_DATA = {
  prompt: 'a fox',
  steps: 20,
  cfg: 4.5,
  loras: [{ name: 'style', strength: 0.8 }],
  seed: null,
}
const folder = ref<string | null>(null)
const FOLDERS: FolderTreeEntry[] = [
  { path: 'style', count: 12 },
  { path: 'style/ink', count: 3 },
  { path: 'people', count: 7 },
  { path: 'detail', count: 4 },
]
const SIGMAS = Array.from({ length: 21 }, (_, i) => 14.6 * Math.pow(1 - i / 20, 3))
const DELTAS = Array.from({ length: 20 }, (_, i) => Math.exp(-i / 5))
</script>

<style scoped>
.gallery {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 12px;
}
.filter {
  width: 180px;
}
.soft {
  color: var(--zen-muted, #9aa0aa);
  font-size: 11.5px;
}
h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 700;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}
.spec {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 8px);
  background: var(--zen-surface, #202026);
}
.spec.wide {
  grid-column: span 2;
}
h4 {
  margin: 0 0 2px;
  color: var(--zen-muted, #9aa0aa);
  font-family: var(--zen-mono, ui-monospace, monospace);
  font-size: 11px;
  font-weight: 600;
}
.line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.line.nowrap {
  flex-wrap: nowrap;
  overflow-x: auto;
}
.sz {
  width: 22px;
}
.w120 {
  width: 120px;
  flex: none;
}
.w110 {
  width: 110px;
  flex: none;
}
.spec:has(.nowrap) {
  grid-column: 1 / -1;
}
.splitbox {
  height: 70px;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: 6px;
  overflow: hidden;
}
.pane {
  display: grid;
  place-items: center;
  height: 100%;
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
}
.pane.card {
  box-sizing: border-box;
  border-radius: 6px;
  background: color-mix(in srgb, var(--zen-text, #fff) 6%, transparent);
}
.popbody {
  padding: 10px 12px;
  font-size: 12px;
}
</style>
