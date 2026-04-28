import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse, type NextRequest } from 'next/server'
import { computeBenchmarkWindow } from '@/lib/daily-pnl-v2/benchmark-window'
import type { ResultsResponseV2 } from '@/lib/daily-pnl-v2/types'
import type { ReturnCostsRow, OrderDetailRow, ConsolidatedRow, ResultsResponse } from '@/lib/daily-pnl/types'

// ── Local row types ───────────────────────────────────────────────────────────

type DpOrder = {
  marketplace_account_id: string
  order_item_id: string
  order_id: string
  sku: string
  quantity: number | null
  dispatched_date: string | null
  order_item_status: string | null
}

type DpListing = {
  marketplace_account_id: string
  seller_sku_id: string
  mrp: number | null
  bank_settlement: number | null
  selling_price: number | null
  benchmark_price: number | null
}

type DpCogs = {
  marketplace_account_id: string
  sku: string
  master_product: string
  cogs: number
}

type BenchmarkRow = {
  marketplace_account_id: string | null
  sku_name: string
  gross_units: number | null
  rto_units: number | null
  rvp_units: number | null
  cancelled_units: number | null
  total_expenses: number | null
}

// ── Core computation (pure function, mirrors v1 logic) ────────────────────────

function computeResultsForSlice(
  orderRows: DpOrder[],
  listingRows: DpListing[],
  cogsRows: DpCogs[],
  benchmarkRows: BenchmarkRow[],
): ResultsResponse {
  // Build lookup maps (lowercase keys for case-insensitive matching)
  const cogsMap = new Map<string, { master_product: string; cogs: number }>()
  for (const r of cogsRows) cogsMap.set(r.sku.toLowerCase(), { master_product: r.master_product, cogs: r.cogs })

  const listingMap = new Map<string, { mrp: number | null; bank_settlement: number | null; selling_price: number | null; benchmark_price: number | null }>()
  for (const r of listingRows) listingMap.set(r.seller_sku_id.toLowerCase(), { mrp: r.mrp, bank_settlement: r.bank_settlement, selling_price: r.selling_price, benchmark_price: r.benchmark_price })

  // Return Costs from benchmark rows (= v1's "P&L History" logic but from order_financials)
  type HistAgg = { gross: number; cancelled: number; rto: number; rvp: number; rvp_fees: number; rto_fees: number }
  const histAgg = new Map<string, HistAgg>()
  for (const r of benchmarkRows) {
    const cogs   = cogsMap.get((r.sku_name ?? '').toLowerCase())
    const master = cogs?.master_product ?? '__unmapped__'
    const cur    = histAgg.get(master) ?? { gross: 0, cancelled: 0, rto: 0, rvp: 0, rvp_fees: 0, rto_fees: 0 }
    cur.gross     += r.gross_units     ?? 0
    cur.cancelled += r.cancelled_units ?? 0
    cur.rto       += r.rto_units       ?? 0
    cur.rvp       += r.rvp_units       ?? 0
    if ((r.rvp_units ?? 0) > 0) cur.rvp_fees += Math.abs(r.total_expenses ?? 0)
    if ((r.rto_units ?? 0) > 0) cur.rto_fees += Math.abs(r.total_expenses ?? 0)
    histAgg.set(master, cur)
  }

  const returnCosts: ReturnCostsRow[] = []
  for (const [master, agg] of histAgg) {
    if (master === '__unmapped__') continue
    const dispatched    = agg.gross - agg.cancelled
    const delivered     = dispatched - agg.rto - agg.rvp
    const delivery_rate = dispatched > 0 ? delivered / dispatched : 0
    returnCosts.push({
      master_product:   master,
      gross_units:      agg.gross,
      cancelled_units:  agg.cancelled,
      rto_units:        agg.rto,
      rvp_units:        agg.rvp,
      delivered_units:  delivered,
      delivery_rate,
      rvp_rate:         agg.gross > 0 ? agg.rvp / agg.gross : 0,
      total_rvp_fees:   agg.rvp_fees,
      total_rto_fees:   agg.rto_fees,
      avg_rvp_cost_per_unit: agg.rvp > 0 ? agg.rvp_fees / agg.rvp : 0,
      avg_rto_cost_per_unit: agg.rto > 0 ? agg.rto_fees / agg.rto : 0,
      est_return_cost_per_dispatched_unit: dispatched > 0 ? (agg.rvp_fees + agg.rto_fees) / dispatched : 0,
    })
  }

  // Portfolio fallbacks (weighted across all masters with known delivery rates)
  const totalDisp    = returnCosts.reduce((s, r) => s + (r.gross_units - r.cancelled_units), 0)
  const totalDel     = returnCosts.reduce((s, r) => s + r.delivered_units, 0)
  const totalRetCost = returnCosts.reduce((s, r) => s + r.total_rvp_fees + r.total_rto_fees, 0)
  const portfolio_delivery_rate = totalDisp > 0 ? totalDel / totalDisp : null
  const portfolio_return_cost   = totalDisp > 0 ? totalRetCost / totalDisp : null
  const rcByMaster = new Map(returnCosts.map(r => [r.master_product, r]))

  // Order Detail (date-filtered orders joined with COGS + Listing)
  const orderDetail: OrderDetailRow[] = orderRows.map(r => {
    const skuLow  = (r.sku ?? '').toLowerCase()
    const cogs    = cogsMap.get(skuLow)
    const listing = listingMap.get(skuLow)
    return {
      order_item_id:     r.order_item_id,
      order_id:          r.order_id,
      sku:               r.sku,
      dispatched_date:   r.dispatched_date ?? '',
      order_item_status: r.order_item_status ?? '',
      quantity:          r.quantity ?? 1,
      mrp:               listing?.mrp             ?? null,
      bank_settlement:   listing?.bank_settlement ?? null,
      selling_price:     listing?.selling_price   ?? null,
      benchmark_price:   listing?.benchmark_price ?? null,
      master_product:    cogs?.master_product     ?? null,
      cogs_per_unit:     cogs?.cogs               ?? null,
    }
  })

  // Consolidated P&L (aggregated from Order Detail)
  type ConsAgg = { quantity: number; wt_bank: number; wt_sell: number; cogs: number | null; master: string }
  const consMap = new Map<string, ConsAgg>()
  for (const row of orderDetail) {
    const key = row.master_product ?? `__sku_${row.sku}`
    const cur = consMap.get(key) ?? { quantity: 0, wt_bank: 0, wt_sell: 0, cogs: row.cogs_per_unit, master: row.master_product ?? row.sku }
    const qty = row.quantity
    cur.quantity += qty
    cur.wt_bank  += (row.bank_settlement ?? 0) * qty
    cur.wt_sell  += (row.selling_price   ?? 0) * qty
    consMap.set(key, cur)
  }

  const consolidated: ConsolidatedRow[] = []
  for (const agg of consMap.values()) {
    const rc              = rcByMaster.get(agg.master)
    const low_confidence  = !rc
    const delivery_rate   = rc?.delivery_rate ?? portfolio_delivery_rate
    const est_return_cost = rc?.est_return_cost_per_dispatched_unit ?? portfolio_return_cost
    const avg_bank        = agg.quantity > 0 ? agg.wt_bank / agg.quantity : null
    const avg_sell        = agg.quantity > 0 ? agg.wt_sell / agg.quantity : null
    let est_revenue: number | null = null
    let est_pnl:     number | null = null
    let total_pnl:   number | null = null
    if (delivery_rate != null && avg_bank != null) est_revenue = delivery_rate * avg_bank
    if (est_revenue != null && agg.cogs != null && delivery_rate != null && est_return_cost != null) {
      est_pnl   = est_revenue - delivery_rate * agg.cogs - est_return_cost
      total_pnl = agg.quantity * est_pnl
    }
    const total_bank = avg_bank != null ? avg_bank * agg.quantity : null
    const total_cogs = agg.cogs != null ? agg.cogs * agg.quantity : null
    const est_pnl_pct =
      total_pnl != null && total_bank != null && total_bank > 0
        ? total_pnl / total_bank
        : null
    const return_on_cogs =
      total_pnl != null && total_cogs != null && delivery_rate != null && total_cogs * delivery_rate > 0
        ? total_pnl / (total_cogs * delivery_rate)
        : null

    consolidated.push({
      master_product:           agg.master,
      quantity:                 agg.quantity,
      avg_bank_settlement:      avg_bank,
      avg_selling_price:        avg_sell,
      cogs_per_unit:            agg.cogs,
      delivery_rate,
      est_return_cost_per_unit: est_return_cost,
      est_revenue_per_unit:     est_revenue,
      est_pnl_per_unit:         est_pnl,
      total_est_pnl:            total_pnl,
      est_pnl_pct,
      return_on_cogs,
      low_confidence,
    })
  }
  consolidated.sort((a, b) => (b.total_est_pnl ?? 0) - (a.total_est_pnl ?? 0))

  const orderedSkus     = [...new Set(orderRows.map(r => (r.sku ?? '').toLowerCase()))]
  const unmapped_skus   = orderedSkus.filter(s => !cogsMap.has(s))
  const missing_listing = orderedSkus.filter(s => !listingMap.has(s))

  return {
    return_costs:         returnCosts.sort((a, b) => b.gross_units - a.gross_units),
    order_detail:         orderDetail,
    consolidated,
    portfolio_delivery_rate,
    portfolio_return_cost,
    unmapped_skus,
    missing_listing_skus: missing_listing,
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)

    const idsParam     = searchParams.get('marketplace_account_ids') ?? ''
    const requestedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
    const from         = searchParams.get('from')
    const to           = searchParams.get('to')

    if (requestedIds.length === 0 || !from || !to) {
      return NextResponse.json(
        { error: 'marketplace_account_ids, from, to are required' },
        { status: 400 },
      )
    }

    // SECURITY: verify all accounts belong to tenant
    const { data: owned, error: ownErr } = await supabase
      .from('marketplace_accounts')
      .select('id, account_name')
      .eq('tenant_id', tenantId)
      .in('id', requestedIds)
    if (ownErr) throw ownErr
    if (!owned || owned.length !== requestedIds.length) {
      return NextResponse.json({ error: 'One or more accounts not found' }, { status: 403 })
    }
    const accountNameById = new Map(owned.map(a => [a.id, a.account_name]))
    void accountNameById // used for future per-account labelling

    const bmWindow = computeBenchmarkWindow(new Date())

    // Fetch all data in parallel across all accounts
    const [
      { data: allOrderRows },
      { data: allListingRows },
      { data: allCogsRows },
    ] = await Promise.all([
      supabase.from('dp_orders')
        .select('marketplace_account_id, order_item_id, order_id, sku, quantity, dispatched_date, order_item_status')
        .in('marketplace_account_id', requestedIds)
        .not('dispatched_date', 'is', null)
        .gte('dispatched_date', from)
        .lte('dispatched_date', to),
      supabase.from('dp_listing')
        .select('marketplace_account_id, seller_sku_id, mrp, bank_settlement, selling_price, benchmark_price')
        .in('marketplace_account_id', requestedIds),
      supabase.from('dp_cogs')
        .select('marketplace_account_id, sku, master_product, cogs')
        .in('marketplace_account_id', requestedIds),
    ])

    // Fetch benchmark from order_financials:
    // Step 1 — get order IDs for these accounts within the benchmark window
    const { data: benchmarkOrderRows } = await supabase
      .from('orders')
      .select('order_item_id, marketplace_account_id, order_date')
      .eq('tenant_id', tenantId)
      .in('marketplace_account_id', requestedIds)
      .gte('order_date', bmWindow.from)
      .lte('order_date', bmWindow.to)
      .limit(10000)

    const benchmarkOrderItemIds = (benchmarkOrderRows ?? [])
      .map(r => r.order_item_id)
      .filter((id): id is string => id != null)

    // Build map from order_item_id → marketplace_account_id for benchmark scoping
    const orderToAccount = new Map<string, string>()
    for (const r of (benchmarkOrderRows ?? [])) {
      if (r.order_item_id && r.marketplace_account_id) {
        orderToAccount.set(r.order_item_id, r.marketplace_account_id)
      }
    }

    // Step 2 — fetch order_financials for those order item IDs
    let allBenchmarkRows: BenchmarkRow[] = []
    if (benchmarkOrderItemIds.length > 0) {
      const { data: finRows } = await supabase
        .from('order_financials')
        .select('order_item_id, sku_name, gross_units, rto_units, rvp_units, cancelled_units, total_expenses')
        .in('order_item_id', benchmarkOrderItemIds)

      allBenchmarkRows = (finRows ?? []).map(r => ({
        marketplace_account_id: orderToAccount.get(r.order_item_id) ?? null,
        sku_name:               r.sku_name ?? '',
        gross_units:            r.gross_units,
        rto_units:              r.rto_units,
        rvp_units:              r.rvp_units,
        cancelled_units:        r.cancelled_units,
        total_expenses:         r.total_expenses,
      }))
    }

    const warnings: string[] = []

    // Per-account results
    const perAccount = owned.map(acct => {
      const acctOrders    = (allOrderRows    ?? []).filter(r => r.marketplace_account_id === acct.id)
      const acctListing   = (allListingRows  ?? []).filter(r => r.marketplace_account_id === acct.id)
      const acctCogs      = (allCogsRows     ?? []).filter(r => r.marketplace_account_id === acct.id)
      const acctBenchmark = allBenchmarkRows.filter(r => r.marketplace_account_id === acct.id)

      const has_orders_in_range = acctOrders.length > 0
      const results = has_orders_in_range && acctCogs.length > 0 && acctListing.length > 0
        ? computeResultsForSlice(acctOrders, acctListing, acctCogs, acctBenchmark)
        : null

      return {
        marketplace_account_id: acct.id,
        account_name:           acct.account_name,
        has_orders_in_range,
        results,
      }
    })

    // Consolidated: pool all accounts that have orders + COGS + listing data
    const accountsWithData = owned.filter(a => {
      const acctOrders  = (allOrderRows  ?? []).filter(r => r.marketplace_account_id === a.id)
      const acctCogs    = (allCogsRows   ?? []).filter(r => r.marketplace_account_id === a.id)
      const acctListing = (allListingRows ?? []).filter(r => r.marketplace_account_id === a.id)
      return acctOrders.length > 0 && acctCogs.length > 0 && acctListing.length > 0
    })

    const consolidatedOrders    = (allOrderRows    ?? []).filter(r => accountsWithData.some(a => a.id === r.marketplace_account_id))
    const consolidatedListing   = (allListingRows  ?? []).filter(r => accountsWithData.some(a => a.id === r.marketplace_account_id))
    const consolidatedCogs      = (allCogsRows     ?? []).filter(r => accountsWithData.some(a => a.id === r.marketplace_account_id))
    const consolidatedBenchmark = allBenchmarkRows.filter(r => accountsWithData.some(a => a.id === r.marketplace_account_id))

    const consolidated = computeResultsForSlice(
      consolidatedOrders,
      consolidatedListing,
      consolidatedCogs,
      consolidatedBenchmark,
    )

    if (accountsWithData.length < owned.length) {
      const missing = owned
        .filter(a => !accountsWithData.some(x => x.id === a.id))
        .map(a => a.account_name)
      warnings.push(
        `${missing.join(', ')} excluded from consolidated results (missing COGS or Listing data).`,
      )
    }

    const response: ResultsResponseV2 = {
      benchmark_window: { from: bmWindow.from, to: bmWindow.to, monthsLabel: bmWindow.monthsLabel },
      consolidated,
      per_account: perAccount,
      warnings,
    }
    return NextResponse.json(response)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
