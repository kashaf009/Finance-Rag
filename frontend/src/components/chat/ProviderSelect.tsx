import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'

import { setLLMProvider } from '@/lib/api'

/**
 * Picks which backend provider generates answers and grades retrieval.
 *
 * The option list comes from `/health`, not a hardcoded array, so a provider
 * added on the backend appears here without a frontend change. The selected
 * value is likewise the backend's own `llm_provider` — when the backend cannot
 * resolve a usable key or base URL it reports the literal `unconfigured`, and
 * that is shown as-is rather than being hidden or guessed at.
 *
 * A failed switch surfaces the backend's own 422 detail, which names the env var
 * to set. Nothing here invents a provider name or claims a switch succeeded.
 */
export function ProviderSelect({
  active,
  options,
  disabled = false,
  className = '',
}: {
  active: string | undefined
  options: string[]
  disabled?: boolean
  className?: string
}) {
  const selectId = useId()
  const labelId = useId()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (provider: string) => setLLMProvider({ provider }),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['health'] })
    },
    onError: (err: Error & { detail?: string | null }) => {
      setError(err.detail ?? err.message)
    },
  })

  // The backend offers the alternatives; if it reported none, there is nothing
  // to switch to and the current value is the only truthful thing to show.
  if (options.length === 0) {
    return (
      <span
        className={`px-2.5 py-1 rounded-lg border border-white/10 text-ivory/50 text-[11px] ${className}`}
      >
        {active ?? 'provider unknown'}
      </span>
    )
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center space-x-1.5">
        <label
          id={labelId}
          htmlFor={selectId}
          className="text-ivory/40 uppercase tracking-wider text-[10px] shrink-0"
        >
          Provider
        </label>
        <select
          id={selectId}
          aria-labelledby={labelId}
          data-testid="provider-select"
          value={active && options.includes(active) ? active : ''}
          disabled={disabled || mutation.isPending}
          onChange={(e) => {
            const next = e.target.value
            if (next) mutation.mutate(next)
          }}
          className="bg-noir-surface text-ivory border border-white/10 rounded-lg px-1.5 py-1 text-[11px] font-mono disabled:opacity-50 focus:border-gold/50 focus:outline-none"
        >
          {active && !options.includes(active) ? (
            <option value="">{active} (unavailable)</option>
          ) : null}
          {options.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <span
          role="status"
          data-testid="provider-error"
          className="flex items-start gap-1 text-[10px] font-mono text-red-300"
        >
          <AlertCircle className="w-3 h-3 shrink-0 mt-px" aria-hidden />
          <span>{error}</span>
        </span>
      ) : null}
    </div>
  )
}
