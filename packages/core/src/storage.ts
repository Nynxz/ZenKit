// zen.storage — per-plugin persistence in two tiers:
//   • local  — browser localStorage (instant, per-browser).
//   • server — ComfyUI's /api/userdata (files on the server disk under
//              user/<id>/zen/<scope>/<key>.json), via the host `api` helper.
// Plaintext, single-user by default — never store secrets here.
import type { ZenStorage, ZenStore } from '@nynxz/zenkit-types'
import { api } from '@comfy/api'

// Confine a key/scope to a safe charset (defence-in-depth over ComfyUI's own
// traversal check): no slashes, dots, or anything that could escape the dir.
function safe(s: string): string {
  return (
    String(s)
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^[.-]+/, '') || '_'
  ).slice(0, 128)
}

function serverStore(ns: string): ZenStore {
  const base = ns ? `zen/${ns}` : 'zen'
  const file = (key: string) => `${base}/${safe(key)}.json`
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      try {
        const r = await api.getUserData(file(key))
        return r.status === 200 ? ((await r.json()) as T) : null
      } catch {
        return null
      }
    },
    async set(key: string, value: unknown): Promise<void> {
      await api.storeUserData(file(key), value, {
        stringify: true,
        overwrite: true,
        throwOnError: true,
      })
    },
    async remove(key: string): Promise<void> {
      await api.deleteUserData(file(key))
    },
    async keys(): Promise<string[]> {
      try {
        const list: Array<{ name: string }> = await api.listUserDataFullInfo(base)
        return (list || []).map((f) => f.name.replace(/\.json$/, ''))
      } catch {
        return []
      }
    },
  }
}

function localStore(ns: string): ZenStore {
  const prefix = `zenkit:store:${ns || '_'}:`
  return {
    get<T = unknown>(key: string): Promise<T | null> {
      try {
        const v = localStorage.getItem(prefix + key)
        return Promise.resolve(v == null ? null : (JSON.parse(v) as T))
      } catch {
        return Promise.resolve(null)
      }
    },
    set(key: string, value: unknown): Promise<void> {
      try {
        localStorage.setItem(prefix + key, JSON.stringify(value))
      } catch {
        /* quota / serialization — ignore */
      }
      return Promise.resolve()
    },
    remove(key: string): Promise<void> {
      localStorage.removeItem(prefix + key)
      return Promise.resolve()
    },
    keys(): Promise<string[]> {
      const out: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length))
      }
      return Promise.resolve(out)
    },
  }
}

/** Build a storage handle namespaced at `ns` (a `/`-joined scope path). */
export function createStorage(ns = ''): ZenStorage {
  return {
    local: localStore(ns),
    server: serverStore(ns),
    scope(name: string): ZenStorage {
      const child = ns ? `${ns}/${safe(name)}` : safe(name)
      return createStorage(child)
    },
  }
}
