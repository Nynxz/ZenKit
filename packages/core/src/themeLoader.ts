// Runtime theme discovery. Fetches theme packs from a server route (by default
// `/zenkit/themes`, served by the comfyui-zenkit Python plugin, which scans the
// themes/ folder on disk at request time). This is what decouples themes from the
// frontend build: drop a `themes/<id>/theme.json` on disk and reload — no rebuild.
//
// Returns RAW, unvalidated packs. Pass the result to `installZenKit({ themes })`
// (or `registerPacks`), which validates each entry via `parsePack` — a malformed
// file on disk is skipped, never fatal.

/** Default route served by comfyui-zenkit's Python side (see zenkit_themes_api.py). */
export const DEFAULT_THEMES_URL = '/zenkit/themes'

/**
 * Fetch the theme manifest from the host (same-origin by default). Never throws:
 * a missing route / offline server / bad JSON resolves to an empty list, so the
 * host simply falls back to whatever else it registered (e.g. the 'comfy' pack).
 */
export async function fetchThemes(url: string = DEFAULT_THEMES_URL): Promise<unknown[]> {
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const data = (await res.json()) as { themes?: unknown }
    return Array.isArray(data?.themes) ? data.themes : []
  } catch {
    return []
  }
}
