# UI: overlays

Floating UI: popovers, menus, dialogs and windows. All are teleported to `<body>` and marked with
`data-zen-layer` (see [UI components](UI-Components.md#floating-layers)). Part of
[`@nynxz/zenkit-ui`](UI-Components.md).

| Need                                                    | Use                                                                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Menu or small panel anchored to a button                | ZenPopover + ZenMenuItem                                                                                                                                       |
| Right-click menu at the pointer                         | ZenContextMenu                                                                                                                                                 |
| Blocking dialog                                         | ZenModal                                                                                                                                                       |
| Movable, resizable tool window                          | ZenWindow                                                                                                                                                      |
| Dockable panel that survives clicking back on the graph | A ZenKit panel ([Panels and workspaces](Panels-and-Workspaces.md), or `openZenPanel` in [nodekit](Nodekit-Panels-and-Canvas.md#openzenpanel-and-haszenpanels)) |

## ZenPopover

An anchored floating panel that flips to stay on screen and re-places on scroll and resize. Use it
uncontrolled with a `trigger` slot, or controlled with `v-model:open` and an `anchor`.

```vue
<ZenPopover placement="bottom-end">
  <template #trigger="{ toggle }">
    <ZenIconButton icon="mdi mdi-dots-vertical" title="More" @click="toggle" />
  </template>
  <template #default="{ close }">
    <ZenMenuItem icon="mdi mdi-pencil" @select="rename(); close()">Rename</ZenMenuItem>
    <ZenMenuSeparator />
    <ZenMenuItem icon="mdi mdi-delete" danger @select="remove(); close()">Delete</ZenMenuItem>
  </template>
</ZenPopover>
```

Controlled, anchored to a point:

```vue
<ZenPopover v-model:open="menuOpen" :anchor="{ x: e.clientX, y: e.clientY }">…</ZenPopover>
```

| Prop         | Type                                                                                          | Default          | Description                                                                |
| ------------ | --------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `open`       | `boolean \| undefined`                                                                        | `undefined`      | Bind with `v-model:open` to control it; leave unbound for trigger-slot use |
| `anchor`     | `HTMLElement \| DOMRect \| { x: number; y: number }`                                          | the trigger      | What to position against                                                   |
| `placement`  | `'bottom-start' \| 'bottom-end' \| 'top-start' \| 'top-end' \| 'right-start' \| 'left-start'` | `'bottom-start'` |                                                                            |
| `offset`     | `number`                                                                                      | `6`              | px gap from the anchor                                                     |
| `matchWidth` | `boolean`                                                                                     | `false`          | Minimum width = anchor width                                               |

| Event         | Payload   |
| ------------- | --------- |
| `update:open` | `boolean` |

| Slot      | Props                             | Description               |
| --------- | --------------------------------- | ------------------------- |
| `trigger` | `{ toggle, open, close, active }` | The element that opens it |
| default   | `{ close }`                       | Popover content           |

Exposed: `open()`, `close()`, `toggle()`.

## ZenMenuItem

An action row inside a popover. With a `submenu` slot it becomes a flyout trigger that opens on
hover.

```vue
<ZenMenuItem icon="mdi mdi-export">
  Export
  <template #submenu>
    <ZenMenuItem @select="exportPng">PNG</ZenMenuItem>
    <ZenMenuItem @select="exportJson">JSON</ZenMenuItem>
  </template>
</ZenMenuItem>
<ZenMenuItem icon="mdi mdi-content-copy" @select="copy">Copy<template #hint>Ctrl+C</template></ZenMenuItem>
```

| Prop       | Type      | Default | Description    |
| ---------- | --------- | ------- | -------------- |
| `icon`     | `string`  | —       | Full MDI class |
| `danger`   | `boolean` | `false` | Red text       |
| `disabled` | `boolean` | `false` |                |

| Event    | Description                                                 |
| -------- | ----------------------------------------------------------- |
| `select` | Clicked (not emitted when disabled or for submenu triggers) |

| Slot      | Description                      |
| --------- | -------------------------------- |
| default   | Label                            |
| `hint`    | Right-aligned hint (plain items) |
| `submenu` | Flyout content                   |

## ZenMenuSeparator

A hairline divider between menu items. No props, events or slots.

```vue
<ZenMenuSeparator />
```

## ZenContextMenu

> Unreleased, not yet on npm (`@nynxz/zenkit-ui@0.2.0` does not export it).

A right-click menu at the pointer, driven imperatively through a template ref.

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { ZenContextMenu, type ContextMenuItem } from '@nynxz/zenkit-ui'

const menu = ref<InstanceType<typeof ZenContextMenu> | null>(null)
const items: ContextMenuItem[] = [
  { heading: 'Clip' },
  { label: 'Rename', icon: 'mdi-pencil', hint: 'F2', run: rename },
  '-',
  { label: 'Delete', icon: 'mdi-delete', danger: true, run: remove },
]
</script>

<template>
  <div @contextmenu.prevent="menu?.show($event)">…</div>
  <ZenContextMenu ref="menu" :items="items" />
</template>
```

| Prop    | Type                | Default  | Description                            |
| ------- | ------------------- | -------- | -------------------------------------- |
| `items` | `ContextMenuItem[]` | required | Actions, headings and `'-'` separators |

`ContextMenuItem = ContextMenuAction | { heading: string } | '-'`

`ContextMenuAction`:

| Field      | Type         | Description                      |
| ---------- | ------------ | -------------------------------- |
| `label`    | `string`     |                                  |
| `icon`     | `string?`    | MDI glyph (`'mdi-pencil'`)       |
| `hint`     | `string?`    | Right-aligned                    |
| `danger`   | `boolean?`   |                                  |
| `disabled` | `boolean?`   |                                  |
| `run`      | `() => void` | Called on click; the menu closes |

Exposed: `show(e: MouseEvent)`, `close()`. No events or slots.

## ZenModal

A centred dialog with a backdrop. Pressing the backdrop or Escape closes it.

```vue
<ZenModal v-model:open="showSettings" title="Settings" width="560px">
  <ZenField label="Name"><ZenInput v-model="name" /></ZenField>
  <template #footer>
    <ZenButton @click="showSettings = false">Cancel</ZenButton>
    <ZenButton variant="primary" @click="save">Save</ZenButton>
  </template>
</ZenModal>
```

| Prop     | Type      | Default   | Description        |
| -------- | --------- | --------- | ------------------ |
| `open`   | `boolean` | required  | Use `v-model:open` |
| `title`  | `string`  | —         |                    |
| `width`  | `string`  | `'720px'` | Any CSS length     |
| `height` | `string`  | `'70vh'`  | Any CSS length     |

| Event         | Payload                       |
| ------------- | ----------------------------- |
| `update:open` | `boolean` (only ever `false`) |

| Slot     | Description                            |
| -------- | -------------------------------------- |
| `header` | Between the title and the close button |
| default  | Body (14px padding, scrolls)           |
| `footer` |                                        |

## ZenWindow

A draggable, resizable, maximisable window. Modeless unless `backdrop` is set.

```vue
<ZenWindow
  v-model:open="editing"
  title="Mask editor"
  icon="mdi mdi-brush"
  :width="900"
  :height="640"
>
  <template #actions><ZenIconButton icon="mdi mdi-undo" title="Undo" @click="undo" /></template>
  <MaskEditor />
</ZenWindow>
```

| Prop              | Type      | Default                         | Description                                         |
| ----------------- | --------- | ------------------------------- | --------------------------------------------------- |
| `open`            | `boolean` | required                        | Use `v-model:open`                                  |
| `title`           | `string`  | `''`                            |                                                     |
| `icon`            | `string`  | `'mdi mdi-application-outline'` |                                                     |
| `width`, `height` | `number`  | `0`                             | Initial size in px; `0` = 70% / 82% of the viewport |
| `minWidth`        | `number`  | `420`                           |                                                     |
| `minHeight`       | `number`  | `320`                           |                                                     |
| `backdrop`        | `boolean` | `false`                         | Dim and block what's behind                         |
| `closeOnEsc`      | `boolean` | `true`                          | Ignored while typing in a field                     |

| Event         | Payload             |
| ------------- | ------------------- |
| `update:open` | `boolean` (`false`) |
| `maximize`    | `boolean`           |

| Slot      | Description            |
| --------- | ---------------------- |
| `actions` | Header buttons         |
| default   | Body (`display: flex`) |
| `footer`  |                        |
