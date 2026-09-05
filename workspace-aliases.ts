import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// Resolve @nynxz/zenkit-* to package source for this repo's own plugin builds. Mappings are
// read from tsconfig.plugin.json so the vite and TypeScript sides cannot disagree.

interface PluginTsconfig {
  compilerOptions?: { paths?: Record<string, string[]> }
}

const ROOT = new URL('./', import.meta.url)
const tsconfig = JSON.parse(
  readFileSync(fileURLToPath(new URL('tsconfig.plugin.json', ROOT)), 'utf8'),
) as PluginTsconfig

const paths = tsconfig.compilerOptions?.paths ?? {}

export const workspaceAliases: Record<string, string> = Object.fromEntries(
  Object.entries(paths).map(([specifier, [target]]) => [
    specifier,
    fileURLToPath(new URL(target, ROOT)),
  ]),
)
