import { getCurrentScope, onScopeDispose, readonly, shallowRef } from 'vue'
import type { DeepReadonly, Ref } from 'vue'
import type { AppLocation, AppRouter } from './contract'

/**
 * A mounted app's location as a ref: `route` names the matched pattern ('model/:id'), `params`
 * and `query` come with it. Updates on every route change of that app, while it is minimized
 * too. Stops listening when the calling scope ends.
 */
export function useAppLocation(router: AppRouter): DeepReadonly<Ref<AppLocation>> {
  const loc = shallowRef<AppLocation>(router.location())
  const stop = router.on((next) => (loc.value = next))
  if (getCurrentScope()) onScopeDispose(stop)
  return readonly(loc)
}
