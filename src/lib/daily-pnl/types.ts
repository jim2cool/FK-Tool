import type { Platform } from '@/types'

export type ReportType = 'orders' | 'listing' | 'cogs' | 'pnl_history'

// Re-export for convenience — matches marketplace_accounts row shape
export type MarketplaceAccount = {
  id: string
  account_name: string
  platform: Platform
  tenant_id: string
}

export type { Platform }

// --- Parsed row shapes (what client-side parsers return) ---

export type ParsedOrder = {
  order_item_id: string
  order_id: string
  sku: string
  quantity: number
  dispatched_date: string | null  // "YYYY-MM-DD" or null
  delivery_tracking_id: string
  order_item_status: string
  _row: number
  error?: string
}

export type ParsedListing = {
  seller_sku_id: string
  mrp: number | null
  bank_settlement: number | null
  selling_price: number | null
  benchmark_price: number | null
  _row: number
  error?: string
}

export type ParsedCogs = {
  sku: string
  master_product: string
  cogs: number
  _row: number
  error?: string
}

export type ParsedPnlHistory = {
  order_date: string | null       // "YYYY-MM-DD"
  order_item_id: string
  sku_name: string
  order_status: string
  gross_units: number
  rto_units: number
  rvp_units: number
  cancelled_units: number
  total_expenses: number
  _row: number
  error?: string
}

// --- API response shapes ---

export type ReturnCostsRow = {
  master_product: string
  gross_units: number
  cancelled_units: number
  rto_units: number
  rvp_units: number
  delivered_units: number
  delivery_rate: number
  rvp_rate: number
  total_rvp_fees: number
  total_rto_fees: number
  avg_rvp_cost_per_unit: number
  est_return_cost_per_dispatched_unit: number
}

export type OrderDetailRow = {
  order_item_id: string
  order_id: string
  sku: string
  dispatched_date: string
  order_item_status: string
  quantity: number
  mrp: number | null
  bank_settlement: number | null
  selling_price: number | null
  benchmark_price: number | null
  master_product: string | null
  cogs_per_unit: number | null
}

export type ConsolidatedRow = {
  master_product: string
  quantity: number
  avg_bank_settlement: number | null
  avg_selling_price: number | null
  cogs_per_unit: number | null
  delivery_rate: number | null
  est_return_cost_per_unit: number | null
  est_revenue_per_unit: number | null
  est_pnl_per_unit: number | null
  total_est_pnl: number | null
  low_confidence: boolean   // true = no P&L History match; used portfolio averages
}

export type ResultsResponse = {
  return_costs: ReturnCostsRow[]
  order_detail: OrderDetailRow[]
  consolidated: ConsolidatedRow[]
  portfolio_delivery_rate: number | null
  portfolio_return_cost: number | null
  unmapped_skus: string[]           // SKUs in Orders with no COGS entry
  missing_listing_skus: string[]    // SKUs in Orders with no Listing entry
}
