import type { ResultsResponse } from '@/lib/daily-pnl/types'

export interface BenchmarkStatusPerAccount {
  marketplace_account_id: string
  account_name: string
  available_months: string[]
  missing_months: string[]
  rows_in_window: number
  rows_with_null_account: number
  status: 'full' | 'partial' | 'none'
  fallback_strategy: 'similar_priced' | 'portfolio_average' | null
  cogs_present: boolean
  listing_present: boolean
  cogs_last_updated_at: string | null
  listing_last_updated_at: string | null
}

export interface BenchmarkStatusResponse {
  benchmark_window: { from: string; to: string; monthsLabel: string; rationale: string }
  per_account: BenchmarkStatusPerAccount[]
}

export interface ResultsResponseV2 {
  benchmark_window: { from: string; to: string; monthsLabel: string }
  consolidated: ResultsResponse
  per_account: Array<{
    marketplace_account_id: string
    account_name: string
    has_orders_in_range: boolean
    results: ResultsResponse | null
  }>
  warnings: string[]
}
