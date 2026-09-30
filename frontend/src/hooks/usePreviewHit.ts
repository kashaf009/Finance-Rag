import { useQuery } from '@tanstack/react-query'
import { search } from '@/lib/api'
import { PREVIEW_QUERY } from '@/lib/document'
import { useIndexReady } from '@/hooks/useHealth'
import type { SearchResponse } from '@/types/api'

/**
 * One genuine retrieval against the real index, used by the document card and
 * the hero telemetry chip.
 *
 * Both read from the same query key, so the hero fires a single POST /search
 * rather than one per consumer. The returned page number, cosine score and
 * page render are whatever Qdrant actually returns — nothing is bundled.
 */
export function usePreviewHit() {
  const { ready } = useIndexReady()

  const query = useQuery<SearchResponse>({
    queryKey: ['preview-page', PREVIEW_QUERY],
    queryFn: ({ signal }) => search({ query: PREVIEW_QUERY, limit: 3 }, signal),
    // Don't call an empty collection: a refusal is guaranteed there, and the
    // only result would be noise in the backend logs.
    enabled: ready,
    staleTime: 5 * 60_000,
  })

  return {
    ...query,
    /** The nearest page, or null before the first response lands. */
    top: query.data?.hits[0] ?? null,
    hits: query.data?.hits ?? [],
    /** True only while a request is genuinely in flight. */
    scanning: query.isFetching,
  }
}
