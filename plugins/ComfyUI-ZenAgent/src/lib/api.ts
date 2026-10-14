import type { Attachment } from './vision'
import { api } from '@comfy/api'

// Zen Agent's backend (zenagent/routes.py). Events for a turn arrive on ComfyUI's websocket as
// the `zenagent` message, sent only to the browser that started the turn. Answers to a turn's
// calls (approvals, tool results, cancel) carry this browser's client id, which the server checks.

export interface Settings {
  llm_url: string
  model: string | null
  max_tokens: number
  max_steps: number
  /** Workflow runs one reply may queue. */
  max_runs: number
  vision: 'auto' | 'on' | 'off'
  /** Ask the user before every tool call that changes something (default on). */
  ask_before_actions: boolean
  /** Tools the user chose "Always allow" for: they run without an approval card. */
  always_allow: string[]
  has_key: boolean
}

/** The user's answer to an approval card. */
export type Decision = 'approve' | 'deny' | 'allow_turn' | 'allow_always'

/** A tool call's state in the panel; `approval` waits for the user, `declined` they said no. */
export type ToolStatus = 'running' | 'approval' | 'done' | 'error' | 'declined'

export interface ThreadSummary {
  id: string
  title: string
  /** The model this chat picked; absent means the settings' (or what's loaded). */
  model?: string
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

/** A chat's token use: totals, and what the last request filled of the model's context. */
export interface Usage {
  input: number
  output: number
  /** Tokens the last request sent the model. */
  last: number | null
  /** The context length the model was loaded with; null when the endpoint doesn't say. */
  context: number | null
  /** Estimates of the fixed parts every request carries. */
  parts?: { system: number; tools: number; plugins: number }
  model?: string
}

export interface Thread extends ThreadSummary {
  messages: StoredMessage[]
  usage?: Usage
}

export type AgentEvent = { thread_id: string; turn_id: string } & (
  | { type: 'turn_start' }
  | { type: 'text' | 'thinking'; delta: string }
  | {
      type: 'tool'
      call_id: string
      name: string
      args: Record<string, unknown> | null
      status: ToolStatus
      result?: ToolResult
    }
  | {
      type: 'approval_request' | 'tool_request'
      token: string
      call_id: string
      name: string
      args: Record<string, unknown>
    }
  | { type: 'notice'; text: string }
  | ({ type: 'usage' } & Usage)
  | { type: 'turn_end'; status: 'done' | 'error' | 'cancelled'; error: string | null }
)

export type ToolResult =
  { ok: true; result?: unknown } | { ok: false; error: string; declined?: boolean }

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
  /** Undeclared means the server asks before running it, like `write`. */
  effect?: 'read' | 'write'
}

export interface ModelList {
  models: string[]
  /** Why the endpoint couldn't list models, in words to show as is; null when it could. */
  error: string | null
}

export interface ContextCheck {
  /** The context length LM Studio loaded the model with; null when the endpoint doesn't say. */
  context: number | null
  /** About what a request costs before the conversation and the browser's plugin tools. */
  base_tokens: number
}

export const agentApi = {
  settings: () => call<Settings>('/settings'),
  saveSettings: (patch: Partial<Settings> & { api_key?: string }) =>
    call<Settings>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  /** The endpoint's chat models, or why it can't list them. */
  models: () => call<ModelList>('/models'),
  /** Try an endpoint (and key) as typed, without saving them. */
  testSettings: (llmUrl: string, apiKey?: string, model?: string) =>
    call<ModelList & ContextCheck & { ok: boolean }>('/settings/test', {
      method: 'POST',
      body: JSON.stringify({
        llm_url: llmUrl,
        ...(apiKey ? { api_key: apiKey } : {}),
        ...(model ? { model } : {}),
      }),
    }),
  threads: () => call<{ threads: ThreadSummary[] }>('/threads').then((r) => r.threads),
  thread: (id: string) => call<Thread>(`/threads/${id}`),
  deleteThread: (id: string) => call(`/threads/${id}`, { method: 'DELETE' }),
  send: (
    threadId: string | null,
    turnId: string,
    message: { content: string; attachments: Attachment[]; images: string[] },
    workflow: unknown,
    tools: CapabilityTool[],
    model: string | null,
  ) =>
    call<{ thread_id: string; turn_id: string }>(`/threads/${threadId ?? 'new'}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        ...message,
        workflow,
        tools,
        model,
        turn_id: turnId,
        client_id: api.clientId,
      }),
    }),
  cancel: (turnId: string) =>
    call(`/turns/${turnId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ client_id: api.clientId }),
    }),
  decide: (token: string, decision: Decision) =>
    call(`/approvals/${token}`, {
      method: 'POST',
      body: JSON.stringify({ decision, client_id: api.clientId }),
    }),
  toolResult: (token: string, result: ToolResult) =>
    call(`/tools/${token}`, {
      method: 'POST',
      body: JSON.stringify({ ...result, client_id: api.clientId }),
    }),
}

export function onAgentEvent(listener: (event: AgentEvent) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<AgentEvent>).detail)
  api.addEventListener('zenagent', handler)
  return () => api.removeEventListener('zenagent', handler)
}
