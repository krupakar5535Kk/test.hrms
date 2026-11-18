import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';

export type ResourceLoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string };

/**
 * Reusable hook to fetch real backend resources with automatic in-memory JWT attachment
 * and honest loading / ready / backend-unavailable / error states. Never supplies fake data.
 */
export function useApiResource<T>(
  path: string | null,
  fallbackEmptyData: T
): {
  state: ResourceLoadState<T>;
  data: T;
  reload: () => void;
} {
  const { getInMemoryAccessToken } = useAuth();
  const [reloadNonce, setReloadNonce] = useState(0);
  const [state, setState] = useState<ResourceLoadState<T>>(
    path ? { status: 'loading' } : { status: 'ready', data: fallbackEmptyData }
  );

  const reload = useCallback(() => {
    setReloadNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!path) {
      setState({ status: 'ready', data: fallbackEmptyData });
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading' });

    apiRequest<T>(path, getInMemoryAccessToken(), { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        if (res.status === 'OK') {
          setState({ status: 'ready', data: res.data });
        } else if (res.status === 'UNAVAILABLE') {
          setState({ status: 'unavailable', message: res.message });
        } else {
          setState({ status: 'error', message: res.message });
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Request failed.',
        });
      });

    return () => controller.abort();
  }, [path, getInMemoryAccessToken, reloadNonce]);

  return {
    state,
    data: state.status === 'ready' ? state.data : fallbackEmptyData,
    reload,
  };
}
