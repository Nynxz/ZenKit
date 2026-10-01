import { app } from '@comfy/app'
import { computed, ref, watch } from 'vue'

import type { AgentEvent, StoredMessage, ThreadSummary, ToolResult } from './api'
import { agentApi, onAgentEvent } from './api'
import { capabilityTools } from './capabilityTools'
import { beginTurn, endTurn, runTool } from './graphTools'
import type { Attachment } from './vision'
import { snapshot } from './vision'

/** One row of the conversation as the panel draws it. */
export type Item =
  | { kind: 'user'; text: string; attachments?: Attachment[] }
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | {
      kind: 'tool'
      callId: string
      name: string
      args: Record<string, unknown> | null
      status: 'running' | 'done' | 'error'
      result?: ToolResult
    }
  | { kind: 'run'; promptIds: string[] }
  | { kind: 'notice'; text: string }
  | { kind: 'error'; text: string }

function parseArgs(json: string): Record<string, unknown> | null {
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Rebuilds the panel's rows from a saved thread (OpenAI-format messages). */
function itemsFrom(messages: StoredMessage[]): Item[] {
  const items: Item[] = []
  const tools = new Map<string, Extract<Item, { kind: 'tool' }>>()
  for (const message of messages) {
    if (message.role === 'user') items.push({ kind: 'user', text: message.content, attachments: message.attachments })
    else if (message.role === 'assistant') {
      if (message.content) items.push({ kind: 'text', text: message.content })
      for (const call of message.tool_calls ?? []) {
        const item = {
          kind: 'tool' as const,
          callId: call.id,
          name: call.function.name,
          args: parseArgs(call.function.arguments),
          status: 'error' as const,
        }
        tools.set(call.id, item)
        items.push(item)
      }
    } else {
      const item = tools.get(message.tool_call_id)
      if (!item) continue
      try {
        item.result = JSON.parse(message.content) as ToolResult
        item.status = item.result.ok ? 'done' : 'error'
      } catch {
        item.status = 'error'
      }
      const promptIds = promptIdsOf(item)
      if (promptIds.length) items.push({ kind: 'run', promptIds })
    }
  }
  return items
}

/** The runs a queue_prompt step started, so a reopened thread shows their cards again. */
function promptIdsOf(item: Extract<Item, { kind: 'tool' }>): string[] {
  if (item.name !== 'queue_prompt' || !item.result?.ok) return []
  const result = item.result.result as { prompt_id?: string; runs?: { prompt_id?: string }[]; queued?: { prompt_id?: string }[] }
  const ids = [result.prompt_id, ...(result.runs ?? result.queued ?? []).map((r) => r.prompt_id)]
  return ids.filter((id): id is string => typeof id === 'string')
}

// One conversation for the page, not per mount: the panel's body remounts whenever it is
// docked, undocked or popped out, and the chat (and a turn in progress) must carry over.
function createConversation() {
  const threadId = ref<string | null>(null)
  const title = ref('New chat')
  const items = ref<Item[]>([])
  const turnId = ref<string | null>(null)
  const threads = ref<ThreadSummary[]>([])
  const draft = ref('')
  const attachments = ref<Attachment[]>([])
  const busy = computed(() => turnId.value !== null)

  function appendStream(kind: 'text' | 'thinking', delta: string): void {
    const last = items.value.at(-1)
    if (last?.kind === kind) last.text += delta
    else items.value.push({ kind, text: delta })
  }

  function onEvent(event: AgentEvent): void {
    if (event.turn_id !== turnId.value) return
    if (event.type === 'text' || event.type === 'thinking') appendStream(event.type, event.delta)
    else if (event.type === 'tool') {
      const existing = items.value.find(
        (item): item is Extract<Item, { kind: 'tool' }> => item.kind === 'tool' && item.callId === event.call_id,
      )
      const next = { kind: 'tool' as const, callId: event.call_id, name: event.name, args: event.args, status: event.status, result: event.result }
      if (existing) Object.assign(existing, next)
      else items.value.push(next)
    } else if (event.type === 'notice') {
      items.value.push({ kind: 'notice', text: event.text })
    } else if (event.type === 'tool_request') {
      // Every run one call queues shares a card, so a batch reads as one job.
      let card: Extract<Item, { kind: 'run' }> | null = null
      void runTool(event.name, event.args, {
        onRun: (promptId) => {
          if (card) return void card.promptIds.push(promptId)
          items.value.push({ kind: 'run', promptIds: [promptId] })
          card = items.value.at(-1) as Extract<Item, { kind: 'run' }>
        },
      }).then((result) => agentApi.toolResult(event.call_id, result))
    } else if (event.type === 'turn_end') {
      turnId.value = null
      endTurn()
      if (event.error) items.value.push({ kind: 'error', text: event.error })
      void refreshThreads()
    }
  }
  onAgentEvent(onEvent)

  async function refreshThreads(): Promise<void> {
    threads.value = await agentApi.threads().catch(() => threads.value)
  }

  async function send(text: string): Promise<void> {
    const content = text.trim()
    if ((!content && !attachments.value.length) || busy.value) return
    const attached = attachments.value
    attachments.value = []
    items.value.push({ kind: 'user', text: content, attachments: attached })
    turnId.value = crypto.randomUUID()
    beginTurn()
    const workflow = (app.graph as { serialize(): unknown }).serialize()
    try {
      // Pictures for a vision model; whether it gets them is the server's call.
      const images = await Promise.all(attached.filter((a) => a.kind !== 'audio').map((a) => snapshot(a).catch(() => null)))
      const sent = await agentApi.send(
        threadId.value,
        turnId.value,
        { content: content || 'See the attached media.', attachments: attached, images: images.filter((i) => i !== null) },
        workflow,
        capabilityTools(),
      )
      if (!threadId.value) title.value = (content || attached[0]?.label || 'Attached media').slice(0, 80)
      threadId.value = sent.thread_id
    } catch (error) {
      turnId.value = null
      items.value.push({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  }

  function attach(media: Attachment[]): void {
    const known = new Set(attachments.value.map((a) => a.ref))
    attachments.value = [...attachments.value, ...media.filter((m) => !known.has(m.ref))].slice(0, 8)
  }

  function detach(ref: string): void {
    attachments.value = attachments.value.filter((a) => a.ref !== ref)
  }

  async function stop(): Promise<void> {
    if (turnId.value) await agentApi.cancel(turnId.value).catch(() => undefined)
  }

  async function open(id: string): Promise<void> {
    const thread = await agentApi.thread(id)
    threadId.value = thread.id
    title.value = thread.title
    items.value = itemsFrom(thread.messages)
    turnId.value = null
  }

  function newChat(): void {
    threadId.value = null
    title.value = 'New chat'
    items.value = []
    turnId.value = null
  }

  async function remove(id: string): Promise<void> {
    await agentApi.deleteThread(id)
    if (threadId.value === id) newChat()
    await refreshThreads()
  }

  watch(threadId, (id) => {
    try {
      if (id) localStorage.setItem(THREAD_KEY, id)
      else localStorage.removeItem(THREAD_KEY)
    } catch {
      // storage unavailable; the thread is just not reopened after a reload
    }
  })

  void refreshThreads()
  const saved = savedThread()
  if (saved) void open(saved).catch(newChat)
  return { threadId, title, draft, attachments, attach, detach, items, busy, threads, send, stop, open, newChat, remove, refreshThreads }
}

const THREAD_KEY = 'zenagent.thread'

function savedThread(): string | null {
  try {
    return localStorage.getItem(THREAD_KEY)
  } catch {
    return null
  }
}

let conversation: ReturnType<typeof createConversation> | null = null

export function useConversation() {
  conversation ??= createConversation()
  return conversation
}
