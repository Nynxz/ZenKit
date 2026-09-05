// Styled console badge; zdebug gated by setDebug. Also keeps a small in-memory ring
// buffer of entries (+ window errors) so the Zen Settings "Logs" tab can show them.

let DEBUG = false
export function setDebug(v: boolean): void {
  DEBUG = !!v
}

const INFO = 'background:#3b82f6;color:#fff;border-radius:3px;padding:1px 6px;font-weight:700'
const WARN = 'background:#f59e0b;color:#1a1a1a;border-radius:3px;padding:1px 6px;font-weight:700'
const ERR = 'background:#ef4444;color:#fff;border-radius:3px;padding:1px 6px;font-weight:700'
const DIM = 'color:inherit'

export type LogLevel = 'info' | 'debug' | 'warn' | 'error'
export interface LogEntry {
  level: LogLevel
  msg: string
  args: unknown[]
  ts: number
}

const BUF: LogEntry[] = []
const MAX = 400
const subs = new Set<(e: LogEntry) => void>()

function record(level: LogLevel, msg: string, args: unknown[]): void {
  const e: LogEntry = { level, msg, args, ts: Date.now() }
  BUF.push(e)
  if (BUF.length > MAX) BUF.shift()
  subs.forEach((fn) => {
    try {
      fn(e)
    } catch {
      /* a subscriber threw — ignore */
    }
  })
}

/** Snapshot of buffered log entries (oldest→newest). */
export function logEntries(): LogEntry[] {
  return BUF.slice()
}
/** Subscribe to new entries; returns an unsubscribe. */
export function onLog(fn: (e: LogEntry) => void): () => void {
  subs.add(fn)
  return () => subs.delete(fn)
}

export function zlog(msg: string, ...args: unknown[]): void {
  record('info', msg, args)
  console.info('%cZenKit%c ' + msg, INFO, DIM, ...args)
}
export function zdebug(msg: string, ...args: unknown[]): void {
  record('debug', msg, args)
  if (DEBUG) console.debug('%cZenKit%c ' + msg, INFO, DIM, ...args)
}
export function zwarn(msg: string, ...args: unknown[]): void {
  record('warn', msg, args)
  console.warn('%cZenKit%c ' + msg, WARN, DIM, ...args)
}
export function zerror(msg: string, ...args: unknown[]): void {
  record('error', msg, args)
  console.error('%cZenKit%c ' + msg, ERR, DIM, ...args)
}

// Capture uncaught page errors as "issues" (once). Best-effort — surfaces consumer
// crashes in the Logs tab without monkey-patching console.
let hooked = false
export function captureWindowErrors(): void {
  if (hooked || typeof window === 'undefined') return
  hooked = true
  window.addEventListener('error', (e) =>
    record('error', String(e.message || 'error'), [e.filename ? `${e.filename}:${e.lineno}` : '']),
  )
  window.addEventListener('unhandledrejection', (e) =>
    record('error', 'unhandled rejection: ' + String((e as PromiseRejectionEvent).reason), []),
  )
}
