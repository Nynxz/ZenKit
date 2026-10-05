# UI: layout and primitives

Containers for node bodies and panels, plus buttons and icons. Part of
[`@nynxz/zenkit-ui`](UI-Components.md).

## ZenWidget

The outer shell of a node body: a flex column with standard padding, gap, 12px text, and a
`cursor: default` reset so ComfyUI's grab cursor doesn't leak into the content.

```vue
<ZenWidget fill ref="shell">
  <ZenRow>…</ZenRow>
  <template #footer><ZenButton block>Run</ZenButton></template>
</ZenWidget>
```

| Prop          | Type                          | Default | Description                                                                          |
| ------------- | ----------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `fill`        | `boolean`                     | `false` | Fill the node body (height 100%). Match the widget's `fill: true` registration.      |
| `gap`         | `number`                      | `7`     | px between sections                                                                  |
| `pad`         | `boolean \| number \| string` | `true`  | `true` = `6px 2px`, `false` = none, a number = `Npx 2px`, a string = raw CSS padding |
| `dragThrough` | `boolean`                     | `false` | Keep the node's grab cursor, for `dragThrough` widgets                               |

| Slot     | Description                                                      |
| -------- | ---------------------------------------------------------------- |
| default  | Content                                                          |
| `footer` | Pinned to the bottom (a `data-zen-spacer` spacer pushes it down) |

| Exposed | Type                       | Description                                                                                                       |
| ------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `el`    | `Ref<HTMLElement \| null>` | The root element (a component ref otherwise gives the instance). Pass `shell.value?.el` to `addNodeHeaderButton`. |

## ZenRow

A row of controls that wraps onto new lines instead of squashing them, for narrow node bodies.
Children keep their natural size unless they carry `data-grow`.

```vue
<ZenRow :min="140">
  <ZenSelect data-grow v-model="preset" :options="presets" />
  <ZenIconButton icon="mdi mdi-plus" title="Add" />
</ZenRow>
```

| Prop    | Type                                        | Default    | Description                                                                      |
| ------- | ------------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| `min`   | `number`                                    | `120`      | Flex basis in px for `data-grow` children; they wrap rather than shrink below it |
| `gap`   | `number`                                    | `6`        | px                                                                               |
| `align` | `'center' \| 'start' \| 'end' \| 'stretch'` | `'center'` | Cross-axis alignment                                                             |
| `wrap`  | `boolean`                                   | `true`     | `false` keeps one line                                                           |

Slots: default. It forces `width: auto` on direct children so `width: 100%` controls don't take the
whole row.

## ZenField

A caption beside (or above) a control, with optional hint text.

```vue
<ZenField label="Steps" stack hint="1–150">
  <ZenNumber v-model="steps" :step="1" />
</ZenField>
```

| Prop    | Type      | Default | Description                                  |
| ------- | --------- | ------- | -------------------------------------------- |
| `label` | `string`  | —       | Caption                                      |
| `stack` | `boolean` | `false` | Label above the control instead of beside it |
| `hint`  | `string`  | —       | Dim helper text under the control            |

Slots: default (the control).

## ZenSection

> New in the working tree; unreleased, not yet on npm.

A titled, collapsible block: chevron, title, optional meta text and actions, and a body that
folds away. `plain` is a header over a hairline divider (stack them for an inspector); `card` is a
bordered box.

```vue
<ZenSection
  v-model:open="settingsOpen"
  title="Scene settings"
  variant="card"
  storage-key="mypack.scene"
>
  <template #meta>3 keyframes</template>
  <template #actions><ZenIconButton icon="mdi mdi-restore" title="Reset" @click="reset" /></template>
  <ZenField label="Length"><ZenNumber v-model="seconds" /></ZenField>
</ZenSection>
```

| Prop          | Type                | Default   | Description                                                     |
| ------------- | ------------------- | --------- | --------------------------------------------------------------- |
| `open`        | `boolean`           | `true`    | Use `v-model:open`. Ignored inside a ZenSections group.         |
| `title`       | `string`            | —         |                                                                 |
| `icon`        | `string`            | —         | MDI class or image URL                                          |
| `collapsible` | `boolean`           | `true`    | `false` = always open, no chevron                               |
| `disabled`    | `boolean`           | `false`   | Header can't be toggled                                         |
| `variant`     | `'plain' \| 'card'` | `'plain'` |                                                                 |
| `storageKey`  | `string`            | —         | Remember open/closed in `localStorage`. Ignored inside a group. |
| `value`       | `string`            | —         | This section's id inside a ZenSections group                    |

| Slot      | Description                                      |
| --------- | ------------------------------------------------ |
| default   | Body                                             |
| `title`   | Replaces the title text                          |
| `meta`    | Soft text on the right of the header             |
| `actions` | Header buttons (clicks don't toggle the section) |

## ZenSections

> New in the working tree; unreleased, not yet on npm.

Groups ZenSection children so open/closed is decided in one place.

```vue
<ZenSections v-model="openId" accordion>
  <ZenSection value="transform" title="Transform">…</ZenSection>
  <ZenSection value="crop" title="Cropping">…</ZenSection>
</ZenSections>
```

| Prop         | Type                         | Default | Description                                                                                                                |
| ------------ | ---------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `modelValue` | `string \| string[] \| null` | —       | Accordion: the open value or `null`. Otherwise: the array of open values. Unbound, it seeds from the sections' own `open`. |
| `accordion`  | `boolean`                    | `false` | One section open at a time                                                                                                 |
| `gap`        | `number`                     | `0`     | px between sections (`0` suits `plain`, ~6 suits `card`)                                                                   |

## ZenSplit

> New in the working tree; unreleased, not yet on npm.

Resizable panes with draggable gutters (keyboard accessible, canvas-zoom aware).

```vue
<ZenSplit v-model:sizes="sizes" :panes="[{}, { size: 320, min: 260, collapsible: true }]">
  <template #pane-0><Monitor /></template>
  <template #pane-1><Inspector /></template>
</ZenSplit>
```

| Prop        | Type                         | Default        | Description                                                                                                                                 |
| ----------- | ---------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `panes`     | `SplitPane[]`                | required       | One entry per pane                                                                                                                          |
| `direction` | `'horizontal' \| 'vertical'` | `'horizontal'` | `horizontal` = side by side                                                                                                                 |
| `step`      | `number`                     | `10`           | Arrow-key step in px (Shift = 5×)                                                                                                           |
| `gutter`    | `'line' \| 'gap'`            | `'line'`       | `line`: a 1px border between panes. `gap`: an 8px empty gap, for panes that draw their own panels; a grip shows on hover and while dragging |
| `sizes`     | `number[]`                   | from `panes`   | Use `v-model:sizes`. Same units as each pane's `size`. Updated at the end of a drag, never per move, so it is safe to persist.              |

`SplitPane`: `{ size?: number; min?: number; max?: number; collapsible?: boolean }`. A `size`
above 1 is px; 0–1 is a fraction of the flexible space; omitted takes an even share. `min` and
`max` are px.

Slots: `pane-0`, `pane-1`, … Exposed: `el`, `reset()` (back to the configured sizes),
`collapse(index, shut = true)`.

Gutters: double-click resets the pane; arrow keys resize (Shift = 5×); Home/End take a side to
its `min`; Enter collapses or reopens a collapsible pane. Panes clip their content, so put a
ZenScroll inside a pane that needs to scroll.

## ZenView

The standard layout for a panel: toolbar, body (scrolling by default), footer.

```vue
<ZenView>
  <template #toolbar><ZenToolbar title="Assets" icon="mdi mdi-folder" /></template>
  <ul>…</ul>
  <template #footer>…</template>
</ZenView>
```

| Prop     | Type      | Default | Description                                                |
| -------- | --------- | ------- | ---------------------------------------------------------- |
| `scroll` | `boolean` | `true`  | Body is a ZenScroll. `false` = a flex container that fills |
| `pad`    | `boolean` | `true`  | 10px body padding                                          |

Slots: `toolbar`, default (body), `footer`.

## ZenToolbar

A panel header bar: icon and title on the left, actions on the right.

```vue
<ZenToolbar title="Queue" icon="mdi mdi-tray-full">
  <template #start><ZenInput v-model="q" sm placeholder="Filter" /></template>
  <ZenIconButton icon="mdi mdi-refresh" title="Refresh" @click="reload" />
</ZenToolbar>
```

| Prop    | Type     | Default | Description    |
| ------- | -------- | ------- | -------------- |
| `title` | `string` | —       |                |
| `icon`  | `string` | —       | Full MDI class |

| Slot    | Description           |
| ------- | --------------------- |
| `start` | After the title       |
| default | Right-aligned actions |

## ZenScroll

A scroll container with themed scrollbars (adds `.zen-scroll`).

```vue
<ZenScroll><ul>…</ul></ZenScroll>
```

| Prop         | Type      | Default | Description              |
| ------------ | --------- | ------- | ------------------------ |
| `horizontal` | `boolean` | `false` | Scroll on x instead of y |

Slots: default. Native `scroll` listeners fall through to the root.

## ZenButton

A themed text button.

```vue
<ZenButton variant="primary" icon="mdi mdi-play" @click="run">Run</ZenButton>
```

| Prop       | Type                                            | Default     | Description                |
| ---------- | ----------------------------------------------- | ----------- | -------------------------- |
| `variant`  | `'default' \| 'primary' \| 'ghost' \| 'danger'` | `'default'` |                            |
| `icon`     | `string`                                        | —           | Full MDI class             |
| `block`    | `boolean`                                       | `false`     | Full width                 |
| `sm`       | `boolean`                                       | `false`     | Smaller padding, 11px text |
| `disabled` | `boolean`                                       | `false`     |                            |

Slots: default (label). Events: native `click` falls through.

## ZenIconButton

A compact 26×26 icon-only button.

```vue
<ZenIconButton icon="mdi mdi-close" title="Close" @click="close" />
```

| Prop       | Type      | Default  | Description                   |
| ---------- | --------- | -------- | ----------------------------- |
| `icon`     | `string`  | required | Full MDI class                |
| `danger`   | `boolean` | `false`  | Red on hover                  |
| `active`   | `boolean` | `false`  | Accent colour (toggled state) |
| `disabled` | `boolean` | `false`  |                               |

Events: native `click`. Always pass a `title` attribute: it is the tooltip and the button's only
text.

## ZenIcon

Renders an MDI class or an image URL (favicon, logo), falling back to a glyph if the image fails
to load.

```vue
<ZenIcon :icon="plugin.icon" fallback="mdi-puzzle-outline" />
```

| Prop       | Type             | Default                     | Description                                                |
| ---------- | ---------------- | --------------------------- | ---------------------------------------------------------- |
| `icon`     | `string \| null` | —                           | MDI class (`'mdi-x'` or `'mdi mdi-x'`) or a URL / data URI |
| `fallback` | `string`         | `'mdi-application-outline'` | Glyph used when `icon` is empty or the image fails         |

`isIconUrl(icon?: string | null): boolean` is exported too: true for `http(s):`, `data:`,
`blob:`, `/…` or an image extension, when the string has no space.

## ZenEmpty

> New in the working tree; unreleased, not yet on npm.

The "nothing here yet" state for a panel or list: a faint mark, an optional title, one line of
guidance and optional actions. The mark is ZenKit's lotus in the current text colour unless you
pass an `icon`. It centres itself in a flex or grid parent.

```vue
<ZenEmpty v-if="!rows.length" title="No runs yet">
  Queue a workflow and each node appears here with its run time.
  <template #actions><ZenButton @click="queue">Queue now</ZenButton></template>
</ZenEmpty>
```

| Prop    | Type     | Default | Description                                        |
| ------- | -------- | ------- | -------------------------------------------------- |
| `title` | `string` | —       | Bold line above the text                           |
| `icon`  | `string` | lotus   | MDI class or image URL to use instead of the lotus |

| Slot      | Description            |
| --------- | ---------------------- |
| default   | The guidance line      |
| `actions` | Buttons under the text |

## useFocusSurface

Click-to-focus for a node body that needs the mouse wheel (a zoomable picture, a scrolling list).
ComfyUI's canvas only gives the wheel to a focused element with `data-capture-wheel`; this
composable focuses the surface on press (not hover) and releases it on an outside press, focus
loss or Escape.

```vue
<script setup lang="ts">
import { useFocusSurface } from '@nynxz/zenkit-ui'

const surface = useFocusSurface({ canFocus: () => images.value.length > 0 })
</script>

<template>
  <div
    :ref="surface.el"
    v-bind="surface.attrs"
    :class="{ focused: surface.focused.value }"
    @wheel.prevent="zoom"
  >
    …
  </div>
</template>
```

```ts
useFocusSurface(opts?: FocusSurfaceOptions): FocusSurface
```

| Option              | Type            | Description                                                        |
| ------------------- | --------------- | ------------------------------------------------------------------ |
| `canFocus`          | `() => boolean` | Return `false` to ignore a press (the wheel stays with the canvas) |
| `onFocus`, `onBlur` | `() => void`    |                                                                    |

| Returned            | Type                                               | Description                                               |
| ------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| `el`                | `Ref<HTMLElement \| null>`                         | Bind to the surface                                       |
| `focused`           | `Ref<boolean>`                                     | True while focus is inside; style your focus ring from it |
| `attrs`             | `{ tabindex: '-1', 'data-capture-wheel': 'true' }` | Spread onto the surface                                   |
| `focus()`, `blur()` | `() => void`                                       |                                                           |

It never takes focus away from an input, textarea, select or contenteditable element.
