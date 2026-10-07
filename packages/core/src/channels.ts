// Named image bus: producers publish images to a named channel; views subscribe.
// A channel can also be DECLARED up front so it's visible (empty) before any image
// arrives — e.g. a node registers "preview" and the Media Viewer shows it waiting.
//
// Backend protocol — the `zenkit.channel` ws event with:
//   { channel, filename, subfolder?, type? }  (resolved via /view)  — publish
//   { channel, url }                                                 — publish
//   { channel }                          (no image)                  — declare only
import { reactive } from 'vue'
import { api } from '@comfy/api'
import { zdebug } from './log'
import { onChannelEvent } from './wsEvents'
import type { ZenBus } from './bus'
import type { ChannelImage, ChannelInput, ZenMedia } from '@nynxz/zenkit-client'

export const LAST = '$last' // subscribe/get the most recently published image (any channel)

export type ChannelsStore = ReturnType<typeof createChannels>

// A ComfyUI file, through ComfyUI's API base like zen.media's URLs; `r` defeats the cache when a
// node overwrites the same filename.
function viewUrl(p: { filename?: unknown; subfolder?: unknown; type?: unknown }): string {
  const q = new URLSearchParams({
    filename: String(p.filename ?? ''),
    subfolder: String(p.subfolder ?? ''),
    type: String(p.type ?? 'temp'),
  })
  return api.apiURL(`/view?${q.toString()}&r=${Date.now()}`)
}

const COMFY_TYPES = ['output', 'input', 'temp']

export function createChannels(bus: ZenBus, media: ZenMedia) {
  // The media ref for what was published: the producer's own, else the ComfyUI file it names.
  // A plain URL is shown as-is but has no ref (URLs are not media refs).
  function refOf(img: ChannelInput): string | undefined {
    if (img.ref) return img.ref
    const type = img.type ?? 'temp'
    if (!img.url && img.filename && COMFY_TYPES.includes(type))
      return media.fromComfyFile({ filename: img.filename, subfolder: img.subfolder, type })
    return undefined
  }

  // declared = known channel names (may be empty); byName = the latest image per channel.
  const state = reactive({
    declared: {} as Record<string, { label?: string }>,
    byName: {} as Record<string, ChannelImage>,
    last: null as ChannelImage | null,
  })

  /** Register a channel so it's listed/visible before any image is published. */
  function declare(channel: string, opts: { label?: string } = {}): void {
    const name = channel || 'default'
    if (state.declared[name]) {
      if (opts.label && !state.declared[name].label) state.declared[name].label = opts.label
      return
    }
    state.declared[name] = { label: opts.label }
    bus.emit('channels:change', name)
  }

  function publish(channel: string, img: ChannelInput): void {
    const name = channel || 'default'
    const isNew = !state.declared[name]
    const rec: ChannelImage = {
      channel: name,
      url: img.url || viewUrl(img),
      ref: refOf(img),
      filename: img.filename,
      label: img.label,
      kind: img.kind,
      width: typeof img.width === 'number' ? img.width : undefined,
      height: typeof img.height === 'number' ? img.height : undefined,
      ts: Date.now(),
    }
    state.byName[name] = rec
    state.last = rec
    if (!state.declared[name]) state.declared[name] = { label: img.label }
    bus.emit('channel', rec)
    bus.emit('channel:' + name, rec)
    if (isNew) bus.emit('channels:change', name)
  }

  // ws event → publish if it carries an image, else just declare the channel.
  onChannelEvent((d) => {
    const name = String(d.channel ?? 'default')
    zdebug('channel event:', name, d)
    if (d.filename || d.url) publish(name, d as ChannelInput)
    else declare(name, { label: typeof d.label === 'string' ? d.label : undefined })
  })

  return {
    state,
    publish,
    declare,
    get: (channel: string): ChannelImage | null =>
      channel === LAST ? state.last : (state.byName[channel] ?? null),
    last: (): ChannelImage | null => state.last,
    list: (): string[] => [
      ...new Set([...Object.keys(state.declared), ...Object.keys(state.byName)]),
    ],
    /** Subscribe to a channel (or LAST for any). Returns an unsubscribe fn. */
    subscribe: (channel: string, cb: (img: ChannelImage) => void): (() => void) =>
      channel === LAST
        ? bus.on('channel', (p) => cb(p as ChannelImage))
        : bus.on('channel:' + channel, (p) => cb(p as ChannelImage)),
  }
}
