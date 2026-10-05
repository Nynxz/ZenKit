// `pnpm dev`: watch both builds this plugin ships — the plugin entry (js/) and the shared
// runtime it serves to other plugins (runtime/) — in one process, so a change to the runtime's
// sources (@nynxz/zenkit-client) is rebuilt too.
import { build } from 'vite'

const watch = { build: { watch: {} } }
await Promise.all([build(watch), build({ ...watch, configFile: 'vite.runtime.config.mts' })])
