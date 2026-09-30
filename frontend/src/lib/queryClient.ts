import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Health and collection info are cheap; keep them reasonably fresh.
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Never retry a deliberate abort.
        if (error instanceof ApiError && error.kind === 'aborted') return false
        return failureCount < 2
      },
    },
    mutations: {
      retry: false,
    },
  },
})
