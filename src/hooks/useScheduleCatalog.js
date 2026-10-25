import { useEffect, useState } from 'react';
import { loadScheduleCatalog } from '../services/scheduleLoader';

/**
 * The flight schedule: { catalog, status } where status is 'loading', 'ready' or 'error'.
 * While it loads (or if it fails) `catalog` is null and the app still works with the flights already on file.
 */
export function useScheduleCatalog() {
  const [state, setState] = useState({ catalog: null, status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    loadScheduleCatalog().then(
      (catalog) => { if (!cancelled) setState({ catalog, status: 'ready' }); },
      () => { if (!cancelled) setState({ catalog: null, status: 'error' }); },
    );
    return () => { cancelled = true; };
  }, []);
  return state;
}
