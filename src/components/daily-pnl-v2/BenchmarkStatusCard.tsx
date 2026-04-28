'use client'
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BenchmarkStatusResponse } from '@/lib/daily-pnl-v2/types'

interface Props {
  data: BenchmarkStatusResponse | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onOpenBulkImporter: () => void
}

function statusIcon(s: 'full' | 'partial' | 'none') {
  if (s === 'full')    return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" aria-label="Available" />
  if (s === 'partial') return <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" aria-label="Partial" />
  return <XCircle className="h-4 w-4 text-destructive shrink-0" aria-label="Missing" />
}

export function BenchmarkStatusCard({ data, loading, error, onRetry, onOpenBulkImporter }: Props) {
  if (loading && !data) {
    return (
      <div className="rounded-lg border p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking benchmark availability…
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-2">
        <p className="text-sm text-destructive">Failed to load benchmark status: {error}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
      </div>
    )
  }
  if (!data) return null

  const w = data.benchmark_window
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div>
        <h3 className="font-medium text-sm">P&amp;L Benchmark Status</h3>
        <p className="text-xs text-muted-foreground">{w.rationale}</p>
        <p className="text-xs">Recommended benchmark = <strong>{w.monthsLabel}</strong></p>
      </div>
      <ul className="space-y-2 text-sm">
        {data.per_account.map(a => {
          const cogsAge    = a.cogs_last_updated_at    ? daysAgo(a.cogs_last_updated_at)    : null
          const listingAge = a.listing_last_updated_at ? daysAgo(a.listing_last_updated_at) : null
          return (
            <li key={a.marketplace_account_id} className="flex items-start gap-2">
              {statusIcon(a.status)}
              <div className="flex-1 min-w-0">
                <p className="font-medium">
                  {a.account_name} —{' '}
                  {a.status === 'full'    && <span>Benchmark complete ({a.rows_in_window} rows)</span>}
                  {a.status === 'partial' && <span className="text-amber-700">Partial: missing {a.missing_months.join(', ')}</span>}
                  {a.status === 'none'   && <span className="text-destructive">No benchmark in window</span>}
                </p>
                {a.status !== 'full' && a.fallback_strategy && (
                  <p className="text-xs text-muted-foreground">
                    Fallback: {a.fallback_strategy === 'similar_priced' ? 'similar-priced products from other accounts' : 'portfolio average'}
                  </p>
                )}
                {!a.cogs_present && (
                  <p className="text-xs text-destructive">⚠ COGS missing — required for compute</p>
                )}
                {!a.listing_present && (
                  <p className="text-xs text-destructive">⚠ Listing missing — required for compute</p>
                )}
                {a.cogs_present && cogsAge != null && cogsAge > 90 && (
                  <p className="text-xs text-amber-700">COGS is {cogsAge} days old — consider updating</p>
                )}
                {a.listing_present && listingAge != null && listingAge > 30 && (
                  <p className="text-xs text-amber-700">Listing is {listingAge} days old — consider updating</p>
                )}
                {a.status !== 'full' && (
                  <Button size="sm" variant="ghost" className="text-xs h-auto py-1 px-2 mt-1" onClick={onOpenBulkImporter}>
                    <Upload className="h-3 w-3 mr-1" /> Upload P&amp;L now via Bulk Importer
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function daysAgo(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}
