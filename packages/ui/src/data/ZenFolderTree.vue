<template>
  <div class="zft">
    <div
      v-for="row in rows"
      :key="row.path"
      class="zft-row"
      :class="{ on: selected === row.path }"
      :style="{ paddingLeft: `${4 + row.depth * 14}px` }"
      :title="row.path"
      tabindex="0"
      @click="choose(row.path)"
      @keydown.enter.self.prevent="choose(row.path)"
    >
      <button
        v-if="row.hasChildren"
        type="button"
        class="zft-chev"
        :aria-label="isOpen(row.path) ? 'Collapse' : 'Expand'"
        @click.stop="toggle(row.path)"
      >
        <i class="mdi" :class="isOpen(row.path) ? 'mdi-chevron-down' : 'mdi-chevron-right'" />
      </button>
      <span v-else class="zft-chev" />
      <i
        class="mdi zft-icon"
        :class="
          selected === row.path || isOpen(row.path)
            ? 'mdi-folder-open-outline'
            : 'mdi-folder-outline'
        "
      />
      <span class="zft-name">{{ row.label }}</span>
      <span v-if="row.count !== undefined" class="zft-count">{{ row.count }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// ZenFolderTree — folders as an expandable tree: a chevron opens or closes a folder's subfolders,
// clicking a folder selects it (and opens it). The path down to the selected folder is always
// open, so a picker that lands deep in the tree shows where it is. With `storageKey`, which
// folders are open is remembered between sessions.
//
// `folders` is every folder path ('a', 'a/b', …); a missing ancestor is added on the fly.
import { computed, ref, watch } from 'vue'

export interface FolderTreeEntry {
  path: string
  /** Shown beside the name — files inside, usually. */
  count?: number
}

const props = withDefaults(defineProps<{ folders: FolderTreeEntry[]; storageKey?: string }>(), {
  storageKey: '',
})
const selected = defineModel<string | null>({ default: null })

const open = ref<Set<string>>(new Set())
try {
  if (props.storageKey) {
    const saved = JSON.parse(localStorage.getItem(props.storageKey) ?? '[]') as string[]
    if (Array.isArray(saved)) open.value = new Set(saved)
  }
} catch {
  // remembered folders are a convenience
}
function save() {
  if (!props.storageKey) return
  try {
    localStorage.setItem(props.storageKey, JSON.stringify([...open.value]))
  } catch {
    // remembered folders are a convenience
  }
}

const ancestors = (path: string) =>
  path
    .split('/')
    .slice(0, -1)
    .map((_, i, parts) => parts.slice(0, i + 1).join('/'))

/** Sets are replaced, not mutated: Vue doesn't track membership changes of a ref'd Set. */
function setOpen(paths: string[], on: boolean) {
  const next = new Set(open.value)
  for (const p of paths) {
    if (on) next.add(p)
    else next.delete(p)
  }
  open.value = next
  save()
}
const isOpen = (path: string) => open.value.has(path)
function toggle(path: string) {
  setOpen([path], !isOpen(path))
}
function choose(path: string) {
  selected.value = path
  if (!isOpen(path)) setOpen([path], true)
}
// Whatever selects a folder — this tree or the host — the way down to it opens.
watch(
  selected,
  (path) => {
    if (path) {
      const closed = ancestors(path).filter((p) => !open.value.has(p))
      if (closed.length) setOpen(closed, true)
    }
  },
  { immediate: true },
)

const tree = computed(() => {
  const counts = new Map<string, number | undefined>()
  for (const f of props.folders) {
    counts.set(f.path, f.count)
    for (const a of ancestors(f.path)) if (!counts.has(a)) counts.set(a, undefined)
  }
  const children = new Map<string, string[]>()
  for (const path of counts.keys()) {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent)!.push(path)
  }
  for (const list of children.values()) list.sort((a, b) => a.localeCompare(b))
  return { counts, children }
})

const rows = computed(() => {
  const out: {
    path: string
    label: string
    depth: number
    count?: number
    hasChildren: boolean
  }[] = []
  const walk = (parent: string, depth: number) => {
    for (const path of tree.value.children.get(parent) ?? []) {
      const hasChildren = (tree.value.children.get(path)?.length ?? 0) > 0
      out.push({
        path,
        label: path.split('/').pop()!,
        depth,
        count: tree.value.counts.get(path),
        hasChildren,
      })
      if (hasChildren && isOpen(path)) walk(path, depth + 1)
    }
  }
  walk('', 0)
  return out
})
</script>

<style scoped>
.zft {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 12px;
}
.zft-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 4px 8px 4px 4px;
  border-radius: var(--zen-radius, 7px);
  color: var(--zen-muted, #9aa0aa);
  cursor: pointer;
}
.zft-row:hover {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 6%, transparent);
  color: var(--zen-text, #e5e5ea);
}
.zft-row.on {
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 20%, transparent);
  color: var(--zen-text, #e5e5ea);
}
.zft-chev {
  display: grid;
  flex: none;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: none;
  color: inherit;
  cursor: pointer;
}
.zft-row:focus-visible,
.zft-chev:focus-visible {
  outline: 2px solid
    var(--zen-focus-ring, color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent));
  outline-offset: -2px;
}
button.zft-chev:hover {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 12%, transparent);
}
.zft-icon {
  flex: none;
  font-size: 15px;
}
.zft-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.zft-count {
  flex: none;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
</style>
