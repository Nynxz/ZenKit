import type { Attachment } from './vision'
import { api } from '@comfy/api'

// Zen Agent's backend (zenagent/routes.py). Events for a turn arrive on ComfyUI's websocket as
// the `zenagent` message, sent only to the browser that started the turn.

export interface Settings {
  llm_url: string
  model: string | null
  max_tokens: number
  max_steps: number
  vision: 'auto' | 'on' | 'off'
  has_key: boolean
}

export interface ThreadSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
}

/** Messages in the OpenAI format the model is sent, so tool calls and results replay exactly. */
export type StoredMessage =
  | { role: 'user'; content: string; attachments?: Attachment[] }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: { id: string; function: { name: string; arguments: string } }[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface Thread extends ThreadSummary {
  messages: StoredMessage[]
}

export type AgentEvent = { thread_id: string; turn_id: string } & (
  | { type: 'turn_start' }
  | { type: 'text' | 'thinking'; delta: string }
  | {
      type: 'tool'
      call_id: string
      name: string
      args: Record<string, unknown> | null
      status: 'running' | 'done' | 'error'
      result?: ToolResult
    }
  | { type: 'tool_request'; call_id: string; name: string; args: Record<string, unknown> }
  | { type: 'notice'; text: string }
  | { type: 'turn_end'; status: 'done' | 'error' | 'cancelled'; error: string | null }
)

export type ToolResult = { ok: true; result?: unknown } | { ok: false; error: string }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await api.fetchApi(`/zenagent${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const body = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `${res.status}`)
  return body
}

/** A ZenKit capability offered to the model as a tool (see capabilityTools.ts). */
export interface CapabilityTool {
  name: string
  description: string
  parameters: unknown
  effect: 'read' | 'write'
}

export const agentApi = {
  settings: () => call<Settings>('/settings'),
  saveSettings: (patch: Partial<Settings> & { api_key?: string }) =>
    call<Settings>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  models: () => call<{ models: string[] }>('/models').then((r) => r.models),
  threads: () => call<{ threads: ThreadSummary[] }>('/threads').then((r) => r.threads),
  thread: (id: string) => call<Thread>(`/threads/${id}`),
  deleteThread: (id: string) => call(`/threads/${id}`, { method: 'DELETE' }),
  send: (
    threadId: string | null,
    turnId: string,
    message: { content: string; attachments: Attachment[]; images: string[] },
    workflow: unknown,
    tools: CapabilityTool[],
  ) =>
    call<{ thread_id: string; turn_id: string }>(`/threads/${threadId ?? 'new'}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        ...message,
        workflow,
        tools,
        turn_id: turnId,
        client_id: api.clientId,
      }),
    }),
  cancel: (turnId: string) => call(`/turns/${turnId}/cancel`, { method: 'POST' }),
  toolResult: (callId: string, result: ToolResult) =>
    call(`/tools/${callId}`, { method: 'POST', body: JSON.stringify(result) }),
}

export function onAgentEvent(listener: (event: AgentEvent) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<AgentEvent>).detail)
  api.addEventListener('zenagent', handler)
  return () => api.removeEventListener('zenagent', handler)
}
