<script setup lang="ts">
// Chat: the agent as a full-screen ZenKit app. Saved chats down the side, the conversation in a
// reading column, a model per chat; the workflow it reads, edits and runs stays live underneath.
// It shares the panel's conversation (lib/conversation), so the two show the same chat. Each
// chat is a route (`c/:id`): back and forward step between chats, a reload reopens one.
import type { AppContext } from '@nynxz/zenkit-client'
import { useAppLocation } from '@nynxz/zenkit-client'
import { ZenIconButton, ZenLotus, ZenMenuItem, ZenModal, ZenPopover } from '@nynxz/zenkit-ui'
import { computed, onMounted, ref, watch } from 'vue'

import { agentApi, type ThreadSummary } from '../lib/api'
import { useConversation } from '../lib/conversation'
import { useMediaDrop } from '../lib/drop'
import AgentComposer from './AgentComposer.vue'
import AgentContextMeter from './AgentContextMeter.vue'
import AgentSettings from './AgentSettings.vue'
import AgentTranscript from './AgentTranscript.vue'

const { ctx } = defineProps<{ ctx: AppContext }>()
const {
  title,
  model,
  pluginTools,
  usage,
  items,
  threads,
  threadId,
  attach,
  send,
  open,
  newChat,
  remove,
  refreshThreads,
} = useConversation()

// --- routes: '' is a new chat, 'c/:id' a saved one -----------------------------------------

const loc = useAppLocation(ctx.router)
function follow(opening = false): void {
  const id = loc.value.route === 'c/:id' ? loc.value.params.id : null
  if (id && id !== threadId.value) void open(id).catch(() => ctx.router.go('', { replace: true }))
  else if (!id && threadId.value) {
    // The app opening at '' with a chat already going (the panel's, or one reopened after a
    // reload) shows that chat rather than a blank one; going to '' later is "New chat".
    if (opening && items.value.length) ctx.router.go(`c/${threadId.value}`, { replace: true })
    else newChat()
  }
}
watch(
  () => loc.value.path,
  () => follow(),
)
watch(threadId, (id) => {
  if (id && loc.value.params.id !== id)
    ctx.router.go(`c/${id}`, { replace: loc.value.route === '' })
  void refreshThreads()
})
onMounted(() => follow(true))

function startChat(): void {
  if (loc.value.route === '') newChat()
  else ctx.router.go('')
  composer.value?.focus()
}

// --- sidebar -------------------------------------------------------------------------------

const prefs = (ctx.state as { sidebar?: boolean } | undefined) ?? {}
const sidebar = ref(prefs.sidebar ?? true)
watch(sidebar, (open) => ctx.setState({ ...prefs, sidebar: open }))

const query = ref('')
const DAY = 86_400_000
const groups = computed(() => {
  const q = query.value.trim().toLowerCase()
  const today = new Date().setHours(0, 0, 0, 0)
  const buckets: [string, ThreadSummary[]][] = [
    ['Today', []],
    ['Yesterday', []],
    ['Previous 7 days', []],
    ['Older', []],
  ]
  for (const t of threads.value) {
    if (q && !t.title.toLowerCase().includes(q)) continue
    const at = new Date(t.updated_at).getTime()
    const i = at >= today ? 0 : at >= today - DAY ? 1 : at >= today - 7 * DAY ? 2 : 3
    buckets[i][1].push(t)
  }
  return buckets.filter(([, list]) => list.length)
})

// Deleting takes two clicks: the first arms it, leaving the row disarms it.
const arming = ref<string | null>(null)
async function onDelete(id: string): Promise<void> {
  if (arming.value !== id) return void (arming.value = id)
  arming.value = null
  if (id === threadId.value) ctx.router.go('', { replace: true })
  await remove(id)
}

// --- models --------------------------------------------------------------------------------

const models = ref<string[]>([])
const fallback = ref<string | null>(null)
/** Why the endpoint can't list models; null when it can, undefined before the first check. */
const endpointError = ref<string | null | undefined>(undefined)
const modelQuery = ref('')
async function loadModels(): Promise<void> {
  const [listed, settings] = await Promise.all([
    agentApi.models().catch((e: unknown) => ({ models: [] as string[], error: String(e) })),
    agentApi.settings().catch(() => null),
  ])
  models.value = listed.models
  endpointError.value = listed.error
  fallback.value = settings?.model ?? null
}
onMounted(loadModels)

// In a dialog rather than a popover: a stray click outside doesn't throw away what was typed.
const settingsOpen = ref(false)
function onSaved(): void {
  settingsOpen.value = false
  void loadModels()
}
const shortName = (id: string) => id.split('/').pop() ?? id
const modelLabel = computed(() => shortName(model.value ?? fallback.value ?? 'Default model'))
const shownModels = computed(() => {
  const q = modelQuery.value.trim().toLowerCase()
  return models.value.filter((m) => !q || m.toLowerCase().includes(q))
})

// --- the empty chat ------------------------------------------------------------------------

const SUGGESTIONS = [
  { icon: 'mdi-text-box-search-outline', text: 'Explain what this workflow does' },
  { icon: 'mdi-image-multiple-outline', text: 'Run four variations with different seeds' },
  { icon: 'mdi-puzzle-plus-outline', text: 'Add a LoRA loader and wire it in' },
  { icon: 'mdi-stethoscope', text: 'Why might this workflow fail?' },
]
const hour = new Date().getHours()
const greeting =
  hour < 5 ? 'Up late?' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

const composer = ref<InstanceType<typeof AgentComposer> | null>(null)
const { dropping, onDragOver, onDragLeave, onDrop } = useMediaDrop((media) => {
  attach(media)
  composer.value?.focus()
})
</script>

<template>
  <div class="zchat" :class="{ collapsed: !sidebar }">
    <aside class="side">
      <div class="side-top">
        <button class="new" @click="startChat">
          <i class="mdi mdi-plus" />
          New chat
        </button>
        <ZenIconButton icon="mdi mdi-dock-left" title="Hide chats" @click="sidebar = false" />
      </div>
      <label class="find">
        <i class="mdi mdi-magnify" />
        <input v-model="query" placeholder="Search chats" spellcheck="false" />
      </label>
      <nav class="threads zen-scroll">
        <div v-if="!threads.length" class="side-empty">
          <i class="mdi mdi-chat-outline" />
          Your chats will appear here.
        </div>
        <div v-else-if="!groups.length" class="side-empty">No chats match.</div>
        <section v-for="[label, list] in groups" :key="label">
          <h3>{{ label }}</h3>
          <div
            v-for="t in list"
            :key="t.id"
            class="thread"
            :class="{ on: t.id === threadId }"
            @mouseleave="arming === t.id && (arming = null)"
          >
            <button class="thread-open" :title="t.title" @click="ctx.router.go(`c/${t.id}`)">
              {{ t.title }}
            </button>
            <button
              class="thread-del"
              :class="{ armed: arming === t.id }"
              :title="arming === t.id ? 'Click again to delete' : 'Delete'"
              @click="onDelete(t.id)"
            >
              <i class="mdi" :class="arming === t.id ? 'mdi-check' : 'mdi-delete-outline'" />
            </button>
          </div>
        </section>
      </nav>
      <button class="status" title="Model settings" @click="settingsOpen = true">
        <span
          class="dot"
          :class="{ ok: endpointError === null, bad: !!endpointError }"
          aria-hidden="true"
        />
        <span class="status-text">
          <b>{{ modelLabel }}</b>
          <small>
            {{
              endpointError === undefined
                ? 'Checking…'
                : endpointError
                  ? 'Not connected'
                  : `${models.length} model${models.length === 1 ? '' : 's'} available`
            }}
          </small>
        </span>
        <i class="mdi mdi-cog-outline" />
      </button>
    </aside>

    <main
      class="main"
      :class="{ empty: !items.length, dropping }"
      data-agent-surface
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <header class="top">
        <template v-if="!sidebar">
          <ZenIconButton icon="mdi mdi-dock-left" title="Show chats" @click="sidebar = true" />
          <ZenIconButton icon="mdi mdi-square-edit-outline" title="New chat" @click="startChat" />
        </template>
        <span v-if="items.length" class="top-title">{{ title }}</span>
        <span class="grow" />
        <AgentContextMeter v-if="items.length" :usage="usage" />
      </header>

      <div v-if="!items.length" class="hero">
        <span class="hero-mark"><ZenLotus /></span>
        <h1>{{ greeting }}</h1>
        <p>Ask anything. I can read, change and run the workflow underneath.</p>
      </div>
      <AgentTranscript v-else chat />

      <div class="dock">
        <AgentComposer ref="composer" chat placeholder="Message the agent…">
          <template #actions>
            <ZenPopover
              placement="top-start"
              role="listbox"
              @update:open="(o: boolean) => o && loadModels()"
            >
              <template #trigger="{ toggle, active }">
                <button
                  class="pill"
                  :class="{ active }"
                  :title="model ?? 'The default model'"
                  @click="toggle"
                >
                  <i class="mdi mdi-cube-outline" />
                  <span>{{ modelLabel }}</span>
                  <i class="mdi mdi-chevron-down" />
                </button>
              </template>
              <template #default="{ close }">
                <div class="models">
                  <label v-if="models.length > 8" class="find">
                    <i class="mdi mdi-magnify" />
                    <input v-model="modelQuery" placeholder="Find a model" spellcheck="false" />
                  </label>
                  <ZenMenuItem
                    :icon="model === null ? 'mdi mdi-check' : 'mdi mdi-blank'"
                    @select="((model = null), close())"
                  >
                    <span class="model-row">
                      Default
                      <small>{{ fallback ? shortName(fallback) : 'whatever is loaded' }}</small>
                    </span>
                  </ZenMenuItem>
                  <div class="models-list zen-scroll">
                    <ZenMenuItem
                      v-for="m in shownModels"
                      :key="m"
                      :icon="m === model ? 'mdi mdi-check' : 'mdi mdi-blank'"
                      :title="m"
                      @select="((model = m), close())"
                    >
                      {{ shortName(m) }}
                    </ZenMenuItem>
                  </div>
                  <div v-if="!models.length" class="models-none">
                    No models listed. Check the endpoint in Model settings.
                  </div>
                </div>
              </template>
            </ZenPopover>
            <button
              class="pill"
              :class="{ on: pluginTools }"
              :title="
                pluginTools
                  ? 'Plugin tools on: the model can use your plugins (costs context). Click to turn off.'
                  : 'Plugin tools off: only the workflow tools. Click to turn on.'
              "
              @click="pluginTools = !pluginTools"
            >
              <i class="mdi mdi-puzzle-outline" />
              <span>Plugins</span>
            </button>
          </template>
        </AgentComposer>
        <div v-if="!items.length" class="ideas">
          <button v-for="s in SUGGESTIONS" :key="s.text" class="idea" @click="send(s.text)">
            <span class="idea-icon"><i class="mdi" :class="s.icon" /></span>
            <span>{{ s.text }}</span>
            <i class="mdi mdi-arrow-top-right idea-go" />
          </button>
        </div>
        <p v-else class="fine">The agent asks before it changes or runs anything.</p>
      </div>
    </main>

    <ZenModal v-model:open="settingsOpen" title="Model settings" width="440px" height="auto">
      <AgentSettings v-if="settingsOpen" class="in-modal" @saved="onSaved" />
    </ZenModal>
  </div>
</template>

<style scoped>
/* Not `.chat`: a child's root shares this scope, and the transcript and composer take a
   `chat` class of their own. */
.zchat {
  display: grid;
  grid-template-columns: 276px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  color: var(--zen-text);
  font-family: var(--p-font-family, system-ui, sans-serif);
  font-size: 13px;
  background: var(--zen-bg);
  transition: grid-template-columns 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.zchat.collapsed {
  grid-template-columns: 0 minmax(0, 1fr);
}
.grow {
  flex: 1;
}
/* --- sidebar ------------------------------------------------------------------------------ */
.side {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--sidebar, var(--zen-chrome-bg, var(--zen-surface)));
  border-right: 1px solid var(--sidebar-border, var(--zen-surface-border, var(--zen-border)));
}
.collapsed .side {
  border-right-color: transparent;
}
/* Level with the chat's own header, so both columns start on one line. */
.side-top {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 56px;
  padding: 0 8px 0 12px;
}
.new {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--zen-control-border, var(--zen-border));
  border-radius: var(--zen-radius);
  background: var(--zen-control-bg, var(--zen-surface));
  color: var(--zen-text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}
.new .mdi {
  font-size: 17px;
  color: var(--zen-accent);
}
.new:hover {
  background: var(--zen-control-hover-bg, var(--zen-surface));
  border-color: var(--zen-control-hover-border, var(--zen-accent));
}
.find {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  margin: 0 12px 6px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--zen-radius);
  background: var(--zen-field-bg, var(--zen-input));
  color: var(--zen-muted);
}
.find:focus-within {
  border-color: var(--ring, var(--zen-accent));
}
.find input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  color: var(--zen-text);
  font: inherit;
  outline: none;
}
.threads {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 8px;
}
.threads h3 {
  margin: 16px 10px 6px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--zen-muted);
}
.side-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 12px;
  color: var(--zen-muted);
  font-size: 12px;
  text-align: center;
}
.side-empty .mdi {
  font-size: 24px;
  opacity: 0.6;
}
.thread {
  position: relative;
  display: flex;
  align-items: center;
  margin: 1px 0;
  border-radius: var(--zen-radius);
  transition: background 0.12s ease;
}
.thread:hover {
  background: color-mix(in srgb, var(--sidebar-accent, var(--zen-surface-2)) 60%, transparent);
}
.thread.on {
  background: var(--sidebar-accent, var(--zen-surface-2));
}
.thread.on::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 2px;
  border-radius: 1px;
  background: var(--zen-accent);
}
.thread-open {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: none;
  background: none;
  color: var(--sidebar-foreground, var(--zen-text));
  font: inherit;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.thread.on .thread-open {
  color: var(--zen-text);
  font-weight: 600;
}
.thread-del {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  margin-right: 4px;
  border: none;
  border-radius: 7px;
  background: none;
  color: var(--zen-muted);
  cursor: pointer;
  opacity: 0;
}
.thread:hover .thread-del,
.thread-del.armed {
  opacity: 1;
}
.thread-del:hover {
  color: var(--zen-text);
}
.thread-del.armed {
  color: var(--zen-danger);
}
.status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 10px 12px;
  padding: 9px 12px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: var(--zen-radius-surface, var(--zen-radius));
  background: var(--zen-control-bg, var(--zen-surface));
  color: var(--zen-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.status:hover {
  border-color: var(--zen-control-hover-border, var(--zen-accent));
}
.status > .mdi {
  color: var(--zen-muted);
  font-size: 16px;
}
.dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--zen-muted);
}
.dot.ok {
  background: var(--zen-ok, #16a34a);
}
.dot.bad {
  background: var(--zen-danger, #dc2626);
}
.status-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.status-text b {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 600;
}
.status-text small {
  color: var(--zen-muted);
  font-size: 11px;
}
/* --- conversation ------------------------------------------------------------------------- */
.main {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.top {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 56px;
  padding: 0 18px 0 14px;
}
.top-title {
  margin-left: 8px;
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dock {
  position: relative;
  flex: 0 0 auto;
  width: 100%;
  max-width: 808px;
  margin: 0 auto;
  padding: 0 24px 16px;
  box-sizing: border-box;
}
.fine {
  margin: 10px 0 0;
  text-align: center;
  font-size: 11px;
  color: var(--zen-muted);
}
/* An empty chat: the greeting and the composer together, in the middle. */
.main.empty {
  justify-content: center;
}
.main.empty .top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}
.hero {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 0 auto 28px;
  padding: 0 24px;
  text-align: center;
}
.hero-mark {
  display: grid;
  place-items: center;
  margin-bottom: 14px;
  color: var(--zen-accent);
  font-size: 40px;
}
.hero h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--zen-text);
}
.hero p {
  margin: 10px 0 0;
  color: var(--zen-muted);
  font-size: 14.5px;
}
.ideas {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.idea {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: var(--zen-radius-surface, var(--zen-radius));
  background: var(--zen-surface);
  color: var(--zen-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.idea-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  border-radius: var(--zen-radius);
  background: var(--zen-surface-2);
  color: var(--zen-accent);
  font-size: 16px;
}
.idea > span:nth-child(2) {
  flex: 1;
}
.idea-go {
  color: var(--zen-muted);
  opacity: 0;
  transition: opacity 0.18s ease;
}
.idea:hover {
  border-color: var(--zen-control-hover-border, var(--zen-accent));
}
.idea:hover .idea-go {
  opacity: 1;
}
.main.dropping::after {
  content: 'Drop to attach';
  position: absolute;
  inset: 12px;
  display: grid;
  place-items: center;
  border: 2px dashed var(--zen-accent);
  border-radius: var(--zen-radius-surface, var(--zen-radius));
  background: var(--zen-glass, var(--zen-bg));
  font-size: 14px;
  font-weight: 600;
  pointer-events: none;
}
/* --- composer pills ------------------------------------------------------------------------ */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--zen-control-border, var(--zen-border));
  border-radius: 999px;
  background: none;
  color: var(--zen-muted);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease;
}
.pill span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pill:hover,
.pill.active {
  border-color: var(--zen-control-hover-border, var(--zen-accent));
  color: var(--zen-text);
}
.pill.on {
  border-color: var(--zen-accent);
  color: var(--zen-accent);
}
.models {
  width: 300px;
}
.models .find {
  margin: 0 0 6px;
}
.models-list {
  max-height: 300px;
  overflow-y: auto;
}
.model-row {
  display: flex;
  flex-direction: column;
}
.model-row small {
  color: var(--zen-muted);
  font-size: 11px;
}
.models-none {
  padding: 8px 10px;
  color: var(--zen-muted);
  font-size: 12px;
}
.in-modal {
  width: auto;
  padding: 0;
}
</style>
