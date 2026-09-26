import { cacheGet, cacheIsFresh, cacheSet } from '@/lib/clientQueryCache';

export type StaleQueryUi = {
  setLoading: (v: boolean) => void;
  setRefreshing: (v: boolean) => void;
  setFailed: (v: boolean) => void;
};

/** Apply cached data immediately; refresh in the background when stale. */
export async function runStaleQuery<T>(opts: {
  namespace: string;
  cacheKey: string;
  force?: boolean;
  ui: StaleQueryUi;
  fetch: () => Promise<T>;
  apply: (data: T) => void;
}): Promise<void> {
  const cached = !opts.force ? cacheGet<T>(opts.namespace, opts.cacheKey) : null;

  if (cached) {
    opts.apply(cached.data);
    opts.ui.setFailed(false);
    opts.ui.setLoading(false);
    if (cacheIsFresh(cached.fetchedAt)) return;
    opts.ui.setRefreshing(true);
  } else {
    opts.ui.setFailed(false);
    opts.ui.setLoading(true);
  }

  try {
    const data = await opts.fetch();
    opts.apply(data);
    cacheSet(opts.namespace, opts.cacheKey, data);
    opts.ui.setFailed(false);
  } catch (err) {
    console.error('runStaleQuery failed:', err);
    if (!cached) opts.ui.setFailed(true);
  } finally {
    opts.ui.setLoading(false);
    opts.ui.setRefreshing(false);
  }
}
