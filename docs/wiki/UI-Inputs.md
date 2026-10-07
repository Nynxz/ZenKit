# UI: inputs

Form controls. All use `v-model` unless noted. Part of [`@nynxz/zenkit-ui`](UI-Components.md).

**Sizes.** Every control (ZenButton, ZenIconButton, ZenInput, ZenNumber, ZenSelect, ZenCombo, ZenToggleGroup, ZenColorPicker) takes the same height from `--zen-control-h` (28px), or `--zen-control-h-sm` (24px) with `size="sm"`, so controls in a row line up. Disabled controls all dim the same way, with a not-allowed cursor.

## ZenInput

Text, number or password input, or a textarea.

```vue
<ZenInput v-model="prompt" type="textarea" autosize placeholder="Prompt…" />
```

| Prop                 | Type                                             | Default  | Description                                                                                                                            |
| -------------------- | ------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `modelValue`         | `string \| number`                               | required |                                                                                                                                        |
| `type`               | `'text' \| 'number' \| 'password' \| 'textarea'` | `'text'` |                                                                                                                                        |
| `placeholder`        | `string`                                         | —        |                                                                                                                                        |
| `rows`               | `number`                                         | `4`      | Textarea rows                                                                                                                          |
| `min`, `max`, `step` | `number`                                         | —        | For `type="number"`                                                                                                                    |
| `disabled`           | `boolean`                                        | `false`  |                                                                                                                                        |
| `sm`                 | `boolean`                                        | `false`  | Same as `size="sm"`                                                                                                                    |
| `size`               | `'sm' \| 'md'`                                   | `'md'`   | Control height: `md` 28px, `sm` 24px (`--zen-control-h`, `--zen-control-h-sm`) for a one-line input — the same in every ZenKit control |
| `autosize`           | `boolean`                                        | `false`  | Textarea grows with its content from `rows` up                                                                                         |

| Event               | Payload            | Description                                               |
| ------------------- | ------------------ | --------------------------------------------------------- |
| `update:modelValue` | `string \| number` | A number for `type="number"` (empty or invalid gives `0`) |

## ZenMentionInput

> Unreleased, not yet on npm (`@nynxz/zenkit-ui@0.2.0` does not export it).

A textarea that highlights `@mentions` of known items, with a caret popup (thumbnails) and a hover
preview.

```vue
<ZenMentionInput
  v-model="text"
  :items="[{ key: 'hero', detail: 'Character', thumb: heroUrl }]"
  resizable
/>
```

| Prop          | Type            | Default  | Description                                           |
| ------------- | --------------- | -------- | ----------------------------------------------------- |
| `modelValue`  | `string`        | required |                                                       |
| `items`       | `MentionItem[]` | required | The mentionable names                                 |
| `placeholder` | `string`        | `''`     |                                                       |
| `resizable`   | `boolean`       | `false`  | Corner grip drags the height; double-click resets     |
| `disabled`    | `boolean`       | `false`  | Dims it; nothing inside takes clicks, typing or focus |

`MentionItem`: `{ key: string; detail?: string; thumb?: string; icon?: string }` (`icon` is a glyph,
`'mdi-x'`).

| Event               | Payload  |
| ------------------- | -------- |
| `update:modelValue` | `string` |

| Slot      | Props      | Description                |
| --------- | ---------- | -------------------------- |
| `preview` | `{ item }` | Body of the hover preview  |
| `thumb`   | `{ item }` | Row thumbnail in the popup |

Exposed: `focus()`.

## ZenNumber

A numeric field: type a value, drag to scrub, arrow keys, and −/+ steppers.

```vue
<ZenNumber v-model="cfg" :min="1" :max="20" :step="0.5" />
```

| Prop         | Type           | Default            | Description                                                                                                       |
| ------------ | -------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `modelValue` | `number`       | required           |                                                                                                                   |
| `min`, `max` | `number`       | —                  | Clamp bounds                                                                                                      |
| `step`       | `number`       | `0.05`             |                                                                                                                   |
| `precision`  | `number`       | decimals in `step` | Decimals shown and rounded to                                                                                     |
| `disabled`   | `boolean`      | `false`            |                                                                                                                   |
| `bare`       | `boolean`      | `false`            | No steppers (type and scrub only)                                                                                 |
| `size`       | `'sm' \| 'md'` | `'md'`             | Control height: `md` 28px, `sm` 24px (`--zen-control-h`, `--zen-control-h-sm`) — the same in every ZenKit control |

| Event               | Payload                        |
| ------------------- | ------------------------------ |
| `update:modelValue` | `number` (clamped and rounded) |

Enter commits, Escape reverts.

## ZenResolution

> Unreleased, not yet on npm (`@nynxz/zenkit-ui@0.2.0` does not export it).

A width × height picker: aspect-ratio chips, megapixel presets and exact W/H fields. Fixed 268px
wide.

```vue
<ZenResolution v-model:width="w" v-model:height="h" :snap="64" />
```

| Prop       | Type                                                   | Default                   | Description                                              |
| ---------- | ------------------------------------------------------ | ------------------------- | -------------------------------------------------------- |
| `width`    | `number`                                               | required                  | Use `v-model:width`                                      |
| `height`   | `number`                                               | required                  | Use `v-model:height`                                     |
| `snap`     | `number`                                               | `32`                      | Every value snaps to this                                |
| `presets`  | `number[]`                                             | `[0.5, 1, 1.5, 2]`        | Megapixel presets                                        |
| `ratios`   | `ResolutionRatio[]`                                    | 1:1, 4:3, 3:2, 16:9, 21:9 | `{ label, w, h }`                                        |
| `native`   | `(ratio: number) => { width: number; height: number }` | —                         | Adds a "Native" preset: the model's own size for a ratio |
| `maxSide`  | `number`                                               | `4096`                    |                                                          |
| `maxMp`    | `number`                                               | `16`                      |                                                          |
| `disabled` | `boolean`                                              | `false`                   | Dims it; nothing inside takes clicks, typing or focus    |

| Event           | Payload  |
| --------------- | -------- |
| `update:width`  | `number` |
| `update:height` | `number` |

Both events fire on every change.

## ZenDimensions

Width × height as one inline control (two bare ZenNumbers), with optional aspect lock, swap,
megapixel and aspect readouts.

```vue
<ZenDimensions v-model="size" v-model:lock-aspect="lock" show-swap show-mp />
```

| Prop         | Type              | Default  | Description                                           |
| ------------ | ----------------- | -------- | ----------------------------------------------------- |
| `modelValue` | `DimensionsValue` | required | `{ width: number; height: number }`                   |
| `min`        | `number`          | `64`     |                                                       |
| `max`        | `number`          | `8192`   |                                                       |
| `step`       | `number`          | `8`      | Snap step                                             |
| `lockAspect` | `boolean`         | `false`  | Use `v-model:lock-aspect`                             |
| `showLock`   | `boolean`         | `true`   |                                                       |
| `showSwap`   | `boolean`         | `false`  |                                                       |
| `showMp`     | `boolean`         | `false`  |                                                       |
| `showAspect` | `boolean`         | `false`  |                                                       |
| `disabled`   | `boolean`         | `false`  | Dims it; nothing inside takes clicks, typing or focus |

| Event               | Payload           |
| ------------------- | ----------------- |
| `update:modelValue` | `DimensionsValue` |
| `update:lockAspect` | `boolean`         |

### Dimension helpers

Pure functions exported alongside ZenDimensions:

| Export                           | Signature                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `MIN_DIMENSION`, `MAX_DIMENSION` | `64`, `8192`                                                                                               |
| `clamp`                          | `(value, lo, hi) => number`                                                                                |
| `clampDimension`                 | `(value, lo = 64, hi = 8192) => number` (rounds)                                                           |
| `snap`                           | `(value, step) => number`                                                                                  |
| `aspectRatio`                    | `(width, height) => string` (`"16:9"`; `"1.78 : 1"` when either term exceeds 32; `"—"` for zero)           |
| `megapixels`                     | `(width, height) => number`                                                                                |
| `formatMegapixels`               | `(value) => string` (`"512K px"`, `"1.05 MP"`)                                                             |
| `scaleToMegapixels`              | `(width, height, targetMp, step = 1) => DimensionsValue` (keeps aspect, snaps, clamps)                     |
| `findClosestPreset`              | `<T extends {width, height}>(width, height, presets: readonly T[]) => T \| null` (aspect first, then size) |

## ZenSelect

A themed dropdown with a teleported menu that flips above when there's no room below.

```vue
<ZenSelect
  v-model="sampler"
  :options="['euler', { value: 'dpm', label: 'DPM++', icon: 'mdi mdi-flash' }]"
/>
```

| Prop          | Type                                                             | Default  | Description                                                                                                       |
| ------------- | ---------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `modelValue`  | `string`                                                         | required |                                                                                                                   |
| `options`     | `(string \| { value: string; label?: string; icon?: string })[]` | required |                                                                                                                   |
| `placeholder` | `string`                                                         | —        | Shown when no option matches                                                                                      |
| `disabled`    | `boolean`                                                        | `false`  |                                                                                                                   |
| `size`        | `'sm' \| 'md'`                                                   | `'md'`   | Control height: `md` 28px, `sm` 24px (`--zen-control-h`, `--zen-control-h-sm`) — the same in every ZenKit control |

| Event               | Payload  |
| ------------------- | -------- |
| `update:modelValue` | `string` |

Values are strings only. For search, many items, or custom rows use ZenCombo.

Keyboard: arrows, Enter or Space on the trigger open it; then arrows, Home/End and a typed letter move, Enter or Space pick, Escape or Tab close.

## ZenCombo

A searchable picker: pinned items, optional virtualised list or card grid, and slots for custom
rows.

```vue
<ZenCombo
  v-model="ckpt"
  :items="models"
  :pinned="favourites"
  :item-height="32"
  @open="loadModels"
/>
```

| Prop          | Type                   | Default                | Description                                                                                                       |
| ------------- | ---------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `modelValue`  | `string \| number`     | required               |                                                                                                                   |
| `items`       | `ComboItem[]`          | required               | `{ value, label?, keywords?, [k]: unknown }`; `label` and `keywords` feed the filter                              |
| `placeholder` | `string`               | `'Select…'`            |                                                                                                                   |
| `searchable`  | `boolean`              | `true`                 |                                                                                                                   |
| `pinned`      | `(string \| number)[]` | —                      | Floated to the top, with a separator                                                                              |
| `emptyText`   | `string`               | `'No matches'`         |                                                                                                                   |
| `disabled`    | `boolean`              | `false`                |                                                                                                                   |
| `size`        | `'sm' \| 'md'`         | `'md'`                 | Control height: `md` 28px, `sm` 24px (`--zen-control-h`, `--zen-control-h-sm`) — the same in every ZenKit control |
| `menuWidth`   | `number`               | trigger width, min 240 | px                                                                                                                |
| `itemHeight`  | `number`               | —                      | Set it to virtualise the list (rows must be this tall)                                                            |
| `grid`        | `boolean`              | `false`                | Show options as cards (never virtualised)                                                                         |
| `gridMin`     | `number`               | `92`                   | Card minimum width in px                                                                                          |
| `sorted`      | `boolean`              | `true`                 | Sort by label, pinned first                                                                                       |
| `pickGuard`   | `(value) => boolean`   | —                      | Return `true` to swallow a pick and keep the menu open                                                            |

| Event               | Payload            | Description                                                                    |
| ------------------- | ------------------ | ------------------------------------------------------------------------------ |
| `update:modelValue` | `string \| number` |                                                                                |
| `open`              | —                  | Menu opened; a hook for lazy loading                                           |
| `query`             | `string`           | Search text as typed                                                           |
| `key`               | `KeyboardEvent`    | Keydown in the menu before built-in navigation; `preventDefault()` to override |

| Slot       | Props                      | Description                     |
| ---------- | -------------------------- | ------------------------------- |
| `selected` | `{ item }`                 | The trigger's content           |
| `option`   | `{ item, active, pinned }` | One row or card                 |
| `search`   | `{ close }`                | Extra actions in the search row |
| `header`   | `{ close }`                | Above the list                  |
| `footer`   | `{ close }`                | Below the list                  |

## ZenSwitch

A 42×23 pill toggle, for settings.

```vue
<ZenSwitch v-model="enabled" on-icon="mdi mdi-check" />
```

| Prop                | Type      | Default  | Description                  |
| ------------------- | --------- | -------- | ---------------------------- |
| `modelValue`        | `boolean` | required |                              |
| `onIcon`, `offIcon` | `string`  | —        | Icon class shown in the knob |
| `disabled`          | `boolean` | `false`  |                              |

Event: `update:modelValue` (`boolean`). No label prop; wrap it in a ZenField.

## ZenCheckbox

A 16px checkbox with an optional label, for options in a list.

```vue
<ZenCheckbox v-model="keepAspect">Keep aspect</ZenCheckbox>
```

| Prop         | Type      | Default  | Description |
| ------------ | --------- | -------- | ----------- |
| `modelValue` | `boolean` | required |             |
| `label`      | `string`  | —        |             |
| `disabled`   | `boolean` | `false`  |             |

Event: `update:modelValue` (`boolean`). Slot: default (label; overrides `label`).

## ZenDot

A ~13px coloured on/off mark, for state in repeated rows (for example an enable dot per LoRA).

```vue
<ZenDot v-model="row.enabled" color="#22c55e" />
```

| Prop         | Type      | Default      | Description         |
| ------------ | --------- | ------------ | ------------------- |
| `modelValue` | `boolean` | required     |                     |
| `color`      | `string`  | theme accent | Fill colour when on |
| `label`      | `string`  | —            | Text beside the dot |
| `disabled`   | `boolean` | `false`      |                     |

Event: `update:modelValue` (`boolean`). Slot: default (label).
CSS variables: `--zen-dot-size` (13px), `--zen-dot-radius`, `--zen-dot-gap`, `--zen-dot-on`.

## ZenToggleGroup

A segmented single-select.

```vue
<ZenToggleGroup
  v-model="mode"
  collapse
  :options="[
    { value: 'image', label: 'Image', icon: 'mdi mdi-image' },
    { value: 'video', label: 'Video', icon: 'mdi mdi-video' },
  ]"
/>
```

| Prop         | Type                                                                 | Default  | Description                                                                                                       |
| ------------ | -------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `modelValue` | `string`                                                             | required |                                                                                                                   |
| `options`    | `{ value: string; label?: string; icon?: string; title?: string }[]` | required |                                                                                                                   |
| `collapse`   | `boolean`                                                            | —        | Icon-only; the selected option slides its label open                                                              |
| `disabled`   | `boolean`                                                            | `false`  |                                                                                                                   |
| `size`       | `'sm' \| 'md'`                                                       | `'md'`   | Control height: `md` 28px, `sm` 24px (`--zen-control-h`, `--zen-control-h-sm`) — the same in every ZenKit control |

Event: `update:modelValue` (`string`).

A radio group to assistive tech: Tab lands on the chosen option, the arrow keys (and Home/End) choose another.

## ZenSlider

A themed native range input.

```vue
<ZenSlider v-model="opacity" :max="1" :step="0.01" />
```

| Prop         | Type      | Default  |
| ------------ | --------- | -------- |
| `modelValue` | `number`  | required |
| `min`        | `number`  | `0`      |
| `max`        | `number`  | `100`    |
| `step`       | `number`  | `1`      |
| `disabled`   | `boolean` | `false`  |

Event: `update:modelValue` (`number`).

## ZenVolume

> Unreleased, not yet on npm (`@nynxz/zenkit-ui@0.2.0` does not export it).

A speaker button (mute toggle) plus a drag/click slider; the wheel steps the volume.

```vue
<ZenVolume v-model:volume="volume" v-model:muted="muted" :show-value="false" />
```

| Model            | Type           | Default |
| ---------------- | -------------- | ------- |
| `v-model:volume` | `number` (0–1) | `1`     |
| `v-model:muted`  | `boolean`      | `false` |

| Prop            | Type      | Default                       | Description                                   |
| --------------- | --------- | ----------------------------- | --------------------------------------------- |
| `disabled`      | `boolean` | `false`                       | Dims the control (the value can still change) |
| `disabledTitle` | `string`  | `'Nothing playing has sound'` | Tooltip while disabled                        |
| `showValue`     | `boolean` | `true`                        | Numeric readout                               |

## ZenCurveEditor

> Unreleased, not yet on npm (`@nynxz/zenkit-ui@0.2.0` does not export it).

Edit a value over a 0–1 x-axis: drag points, double-click to add, right-click to remove. Linear
between points, held flat past the ends.

```vue
<ZenCurveEditor
  v-model="points"
  :max="2"
  :unit="1"
  :presets="[
    {
      label: 'Ramp',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    },
  ]"
/>
```

| Prop         | Type               | Default            | Description                                           |
| ------------ | ------------------ | ------------------ | ----------------------------------------------------- |
| `modelValue` | `CurvePoint[]`     | `[]`               | `{ x: number; y: number }`                            |
| `min`        | `number`           | `0`                | y range                                               |
| `max`        | `number`           | `1`                |                                                       |
| `unit`       | `number \| null`   | `null`             | Faint guide line (e.g. `1` for "unchanged")           |
| `flat`       | `number`           | `1`                | Value drawn when there are no points                  |
| `xLabels`    | `[string, string]` | `['start', 'end']` |                                                       |
| `presets`    | `CurvePreset[]`    | `[]`               | `{ label, icon?, title?, points }`                    |
| `disabled`   | `boolean`          | `false`            | Dims it; nothing inside takes clicks, typing or focus |

Event: `update:modelValue` (`CurvePoint[]`).

## ZenColorPicker

A swatch that opens a popover with a saturation/value box, hue bar, hex field and presets.

```vue
<ZenColorPicker v-model="tint" compact />
```

| Prop         | Type       | Default                                           | Description                                           |
| ------------ | ---------- | ------------------------------------------------- | ----------------------------------------------------- |
| `modelValue` | `string`   | required                                          | `#rrggbb`                                             |
| `presets`    | `string[]` | `#ff3b30 #ffcc00 #34c759 #0a84ff #ffffff #000000` |                                                       |
| `compact`    | `boolean`  | —                                                 | Swatch-only trigger                                   |
| `disabled`   | `boolean`  | `false`                                           | Dims it; nothing inside takes clicks, typing or focus |

Event: `update:modelValue` (`string`), emitted continuously while dragging.
