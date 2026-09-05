// Build a URL for ComfyUI's core /view endpoint from a saved-image record.
//
// Shared because every pack that shows run results needs it and every pack gets it subtly wrong:
// `apiURL` matters when ComfyUI is served under a base path, and the CACHE-BUSTER matters because
// a re-run can reuse a filename — without it the browser serves the previous frame and the node
// looks stuck. ComfyUI's own `getRandParam` is used when available so we bust it the same way the
// core frontend does.
import { app } from '@comfy/app'
import { api } from '@comfy/api'

export function viewUrl(record: Record<string, string>): string {
  const params = new URLSearchParams(record).toString()
  const rand = (app as { getRandParam?: () => string }).getRandParam?.() ?? `&r=${params.length}`
  return (api as { apiURL: (p: string) => string }).apiURL(`/view?${params}${rand}`)
}
