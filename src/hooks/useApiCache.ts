'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Cache entry type for storing fetched data
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  promise?: Promise<T>;
}

/**
 * Options for configuring cache behavior
 */
export interface CacheOptions<T = any> {
  revalidateOnFocus?: boolean;
  revalidateInterval?: number | null;
  dedupingInterval?: number;
  fallbackData?: T;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

/**
 * Return type from the useApiCache hook
 */
export interface CacheResult<T> {
  data: T | undefined;
  error: Error | undefined;
  isLoading: boolean;
  isValidating: boolean;
  mutate: (data?: T) => void;
}

/**
 * Module-level cache store
 */
const cache = new Map<string, CacheEntry<any>>();

/**
 * Fetches data from the API with proper error handling
 */
async function fetchData<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

/**
 * useApiCache: A lightweight SWR-style hook for data fetching with built-in caching, deduping, and revalidation
 *
 * @template T - The type of data being fetched
 * @param url - The URL to fetch from (can be null for conditional fetching)
 * @param options - Configuration options for cache behavior
 * @returns CacheResult containing data, error, loading states, and mutate function
 */
export function useApiCache<T = any>(
  url: string | null,
  options: CacheOptions<T> = {}
): CacheResult<T> {
  const {
    revalidateOnFocus = true,
    revalidateInterval = null,
    dedupingInterval = 2000,
    fallbackData,
    onSuccess,
    onError,
  } = options;

  const [data, setData] = useState<T | undefined>(fallbackData);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(!fallbackData && !!url);
  const [isValidating, setIsValidating] = useState(false);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const isMountedRef = useRef(true);

  /**
   * Revalidate/fetch data from the API or cache
   */
  const revalidate = useCallback(async () => {
    if (!url) return;

    try {
      setIsValidating(true);
      const now = Date.now();

      // Check if we have fresh cached data
      if (cache.has(url)) {
        const entry = cache.get(url)!;
        const age = now - entry.timestamp;

        // If data is fresh (within deduping interval), return cached data
        if (age < dedupingInterval) {
          if (isMountedRef.current) {
            setData(entry.data);
            setError(undefined);
            setIsLoading(false);
            setIsValidating(false);
          }
          return;
        }

        // If a fetch is already in progress for this URL, wait for it
        if (entry.promise) {
          try {
            const result = await entry.promise;
            if (isMountedRef.current) {
              setData(result);
              setError(undefined);
              onSuccess?.(result);
            }
          } catch (err) {
            if (isMountedRef.current) {
              const error = err instanceof Error ? err : new Error(String(err));
              setError(error);
              onError?.(error);
            }
          } finally {
            if (isMountedRef.current) {
              setIsValidating(false);
              setIsLoading(false);
            }
          }
          return;
        }
      }

      // Create a new fetch promise
      const fetchPromise = fetchData<T>(url);

      // Store the promise in cache for deduping
      if (cache.has(url)) {
        const entry = cache.get(url)!;
        entry.promise = fetchPromise;
      } else {
        cache.set(url, {
          data: fallbackData,
          timestamp: now,
          promise: fetchPromise,
        });
      }

      try {
        const result = await fetchPromise;

        if (isMountedRef.current) {
          cache.set(url, {
            data: result,
            timestamp: Date.now(),
          });
          setData(result);
          setError(undefined);
          setIsLoading(false);
          onSuccess?.(result);
        }
      } catch (err) {
        if (isMountedRef.current) {
          const error = err instanceof Error ? err : new Error(String(err));
          setError(error);
          setIsLoading(false);
          onError?.(error);
        }
      } finally {
        if (isMountedRef.current) {
          setIsValidating(false);
        }
        // Clear the promise from cache
        if (cache.has(url)) {
          const entry = cache.get(url)!;
          entry.promise = undefined;
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setIsValidating(false);
        setIsLoading(false);
        onError?.(error);
      }
    }
  }, [url, dedupingInterval, fallbackData, onSuccess, onError]);

  /**
   * Manual mutate function to update cached data
   */
  const mutate = useCallback((newData?: T) => {
    if (!url) return;

    if (newData !== undefined) {
      setData(newData);
      cache.set(url, {
        data: newData,
        timestamp: Date.now(),
      });
      onSuccess?.(newData);
    } else {
      // If no data provided, trigger a revalidation
      revalidate();
    }
  }, [url, onSuccess, revalidate]);

  /**
   * Initial fetch on mount and URL change
   */
  useEffect(() => {
    isMountedRef.current = true;
    lastFetchTimeRef.current = 0;

    if (!url) {
      setData(fallbackData);
      setError(undefined);
      setIsLoading(false);
      return;
    }

    revalidate();

    return () => {
      isMountedRef.current = false;
    };
  }, [url, fallbackData, revalidate]);

  /**
   * Handle window focus revalidation
   */
  useEffect(() => {
    if (!url || !revalidateOnFocus) return;

    const handleFocus = () => {
      const now = Date.now();
      // Only revalidate if enough time has passed since last fetch
      if (now - lastFetchTimeRef.current > dedupingInterval) {
        lastFetchTimeRef.current = now;
        revalidate();
      }
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [url, revalidateOnFocus, dedupingInterval, revalidate]);

  /**
   * Handle polling interval
   */
  useEffect(() => {
    if (!url || !revalidateInterval || revalidateInterval <= 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      lastFetchTimeRef.current = Date.now();
      revalidate();
    }, revalidateInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [url, revalidateInterval, revalidate]);

  return {
    data,
    error,
    isLoading,
    isValidating,
    mutate,
  };
}

/**
 * Prefetch data into the cache
 * Useful for warming up the cache before rendering components that depend on the data
 *
 * @param url - The URL to prefetch
 */
export async function prefetch<T = any>(url: string): Promise<void> {
  // Check if data is already cached and fresh
  if (cache.has(url)) {
    const entry = cache.get(url)!;
    const age = Date.now() - entry.timestamp;
    if (age < 2000) {
      return; // Data is fresh, no need to prefetch
    }
  }

  try {
    const data = await fetchData<T>(url);
    cache.set(url, {
      data,
      timestamp: Date.now(),
    });
  } catch (error) {
    // Silently fail for prefetch - cache will fetch on demand
    console.debug('Prefetch failed for', url, error);
  }
}
