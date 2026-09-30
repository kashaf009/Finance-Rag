import { useQuery } from '@tanstack/react-query'
import { getHealth } from '@/lib/api'
import type { HealthResponse } from '@/types/api'

/**
 * Index liveness. GET /health degrades gracefully instead of throwing, so a
 * `degraded` status is a successful response, not an error.
 */
export function useHealth() {
  return useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: ({ signal }) => getHealth(signal),
    refetchInterval: 30_000,
  })
}

/**
 * True when the backend is reachable and the collection has pages in it.
 * Drives the nav status pill and whether read/query actions are enabled.
 */
export function useIndexReady() {
  const { data, isPending, isError } = useHealth()
  return {
    isPending,
    isError,
    health: data ?? null,
    ready: Boolean(data?.collection_ready) && (data?.points ?? 0) > 0,
    points: data?.points ?? null,
    status: data?.status ?? null,
  }
}
