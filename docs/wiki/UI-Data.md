# UI: data

Components for showing structured data. Part of [`@nynxz/zenkit-ui`](UI-Components.md).

## JsonTree

A collapsible JSON viewer in a monospace font, with values coloured by type.

```vue
<JsonTree :data="workflow" name="workflow" :default-open="2" />
```

| Prop          | Type      | Default  | Description                                   |
| ------------- | --------- | -------- | --------------------------------------------- |
| `data`        | `unknown` | required | Any JSON-like value                           |
| `name`        | `string`  | —        | Key label for the root node                   |
| `defaultOpen` | `number`  | `1`      | Auto-expand down to this depth                |
| `depth`       | `number`  | `0`      | Used internally for recursion; leave it unset |

No events or slots.

## ZenFolderTree

An expandable folder tree built from flat paths. Selecting a folder opens it, and the path to the
selection always stays open. Open folders can be remembered in `localStorage`.

> Unreleased, not yet on npm (`@nynxz/zenkit-ui@0.2.0` does not export it).

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { ZenFolderTree, type FolderTreeEntry } from '@nynxz/zenkit-ui'

const folders: FolderTreeEntry[] = [
  { path: 'characters', count: 12 },
  { path: 'characters/anime', count: 5 },
  { path: 'styles', count: 8 },
]
const dir = ref<string | null>(null)
</script>

<template>
  <ZenFolderTree v-model="dir" :folders="folders" storage-key="mypack.loraFolders" />
</template>
```

| Prop         | Type                | Default  | Description                                                 |
| ------------ | ------------------- | -------- | ----------------------------------------------------------- |
| `modelValue` | `string \| null`    | `null`   | Selected folder path                                        |
| `folders`    | `FolderTreeEntry[]` | required | `{ path: string; count?: number }`; `/`-separated paths     |
| `storageKey` | `string`            | `''`     | `localStorage` key for open folders; empty = don't remember |

| Event               | Payload          |
| ------------------- | ---------------- |
| `update:modelValue` | `string \| null` |

ZenMediaPicker and LoraBrowser use it for their folder panes.
