// The websocket events ZenKit consumes, listened for as soon as ZenKit's script loads. ComfyUI
// rejects a custom message type until something listens for it ("Unknown message type"), and
// the runtime installs later (after the theme fetch), so events sent in between are buffered
// here and handed to the runtime when it subscribes.
import { api } from '@comfy/api'

type Listener = (detail: Record<string, unknown>) => void

const MAX_BUFFERED = 200

function earlyEvent(type: string): (listener: Listener) => void {
  const buffered: Record<string, unknown>[] = []
  let listener: Listener | null = null
  ;(
    api as { addEventListener?: (e: string, cb: (ev: { detail?: unknown }) => void) => void }
  )?.addEventListener?.(type, (e) => {
    const detail = (e?.detail as Record<string, unknown>) || {}
    if (listener) listener(detail)
    else if (buffered.push(detail) > MAX_BUFFERED) buffered.shift()
  })
  return (next) => {
    listener = next
    for (const detail of buffered.splice(0)) next(detail)
  }
}

export const JOB_EVENT = 'zenkit.job'
export const CHANNEL_EVENT = 'zenkit.channel'
export const onJobEvent = earlyEvent(JOB_EVENT)
export const onChannelEvent = earlyEvent(CHANNEL_EVENT)
