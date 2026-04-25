import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextRequest, NextResponse } from 'next/server'
import type { ReturnCostsRow, OrderDetailRow, ConsolidatedRow, ResultsResponse } from '@/lib/daily-pnl/types'

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const params              = request.nextUrl.searchParams
    const marketplace_account_id = params.get('marketplace_account_id')
    const from                = params.get('from')
    const to                  = params.get('to')

    if (!marketplace_account_id || !from || !to) {
      return NextResponse.json({ error: 'marketplace_account_id, from, to required' }, { status: 400 })
    }

    // Verify the account belongs to this tenant
    const { data: acct } = await supabase
      .from('marketplace_accounts').select('id')
      .eq('id', marketplace_account_id).eq('tenant_id', tenantId).single()
    if (!acct) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    // ── 1. Load lookup tables ──────────────────────────────────────────────
    const [{ data: cogsRows }, { data: listingRows }, { data: historyRows }, { data: orderRows }] =
      await Promise.all([
        supabase.from('dp_cogs').select('sku, master_product, cogs').eq('marketplace_account_id', marketplace_account_id),
        supabase.from('dp_listing').select('seller_sku_id, mrp, bank_settlement, selling_price, benchmark_price').eq('marketplace_account_id', marketplace_account_id),
        supabase.from('dp_pnl_history').select('sku_name, gross_units, rto_units, rvp_units, cancelled_units, total_expenses').eq('marketplace_account_id', marketplace_account_id),
        supabase.from('dp_orders').select('order_item_id, order_id, sku, quantity, dispatched_date, order_item_status')
          .eq('marketplace_account_id', marketplace_account_id)
          .not('dispatched_date', 'is', null)
          .gte('dispatched_date', from)
          .lte('dispatched_date', to),
      ])

    // Build lookup maps (lowercase SKU keys for case-insensitive matching)
    const cogsMap = new Map<string, { master_product: string; cogs: number }>()
    for (const r of cogsRows ?? []) cogsMap.set(r.sku.toLowerCase(), { master_product: r.master_product, cogs: r.cogs })

    const listingMap = new Map<string, { mrp: number | null; bank_settlement: number | null; selling_price: number | null; benchmark_price: number | null }>()
    for (const r of listingRows ?? []) listingMap.set(r.seller_sku_id.toLowerCase(), { mrp: r.mrp, bank_settlement: r.bank_settlement, selling_price: r.selling_price, benchmark_price: r.benchmark_price })

    // ── 2. Return Costs (from P&L History, all-time) ───────────────────────
    type HistAgg = { gross: number; cancelled: number; rto: number; rvp: number; rvp_fees: number; rto_fees: number }
    const histAgg = new Map<string, HistAgg>()

    for (const r of historyRows ?? []) {
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
      const dispatched   = agg.gross - agg.cancelled
      const delivered    = dispatched - agg.rto - agg.rvp
      const delivery_rate = dispatched > 0 ? delivered / dispatched : 0
      returnCosts.push({
        master_product: master,
        gross_units:    agg.gross,
        cancelled_units: agg.cancelled,
        rto_units:      agg.rto,
        rvp_units:      agg.rvp,
        delivered_units: delivered,
        delivery_rate,
        rvp_rate:       agg.gross > 0 ? agg.rvp / agg.gross : 0,
        total_rvp_fees: agg.rvp_fees,
        total_rto_fees: agg.rto_fees,
        avg_rvp_cost_per_unit: agg.rvp > 0 ? agg.rvp_fees / agg.rvp : 0,
        est_return_cost_per_dispatched_unit: dispatched > 0 ? (agg.rvp_fees + agg.rto_fees) / dispatched : 0,
      })
    }

    // Portfolio fallbacks (weighted across all masters with known delivery rates)
    const totalDisp      = returnCosts.reduce((s, r) => s + (r.gross_units - r.cancelled_units), 0)
    const totalDel       = returnCosts.reduce((s, r) => s + r.delivered_units, 0)
    const totalRetCost   = returnCosts.reduce((s, r) => s + r.total_rvp_fees + r.total_rto_fees, 0)
    const portfolio_delivery_rate = totalDisp > 0 ? totalDel / totalDisp : null
    const portfolio_return_cost   = totalDisp > 0 ? totalRetCost / totalDisp : null

    const rcByMaster = new Map(returnCosts.map(r => [r.master_product, r]))

    // ── 3. Order Detail (date-filtered orders joined with COGS + Listing) ──
    const orderDetail: OrderDetailRow[] = (orderRows ?? []).map(r => {
      const skuLow  = (r.sku ?? '').toLowerCase()
      const cogs    = cogsMap.get(skuLow)
      const listing = listingMap.get(skuLow)
      return {
        order_item_id:    r.order_item_id,
        order_id:         r.order_id,
        sku:              r.sku,
        dispatched_date:  r.dispatched_date,
        order_item_status: r.order_item_status,
        quantity:         r.quantity ?? 1,
        mrp:              listing?.mrp             ?? null,
        bank_settlement:  listing?.bank_settlement ?? null,
        selling_price:    listing?.selling_price   ?? null,
        benchmark_price:  listing?.benchmark_price ?? null,
        master_product:   cogs?.master_product     ?? null,
        cogs_per_unit:    cogs?.cogs               ?? null,
      }
    })

    // ── 4. Consolidated P&L (aggregated from Order Detail) ────────────────
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
      // Two new metrics matching the spec's Consolidated Report:
      //   est_pnl_pct    = Total Est. P&L ÷ Total Bank Settlement
      //                    (profit as % of projected revenue)
      //   return_on_cogs = Total Est. P&L ÷ (Total COGS × Delivery Rate)
      //                    (return on the COGS you actually incur — only delivered units consume COGS)
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

    // ── 5. Validation flags ────────────────────────────────────────────────
    const orderedSkus      = [...new Set((orderRows ?? []).map(r => (r.sku ?? '').toLowerCase()))]
    const unmapped_skus    = orderedSkus.filter(s => !cogsMap.has(s)).map(s => s)
    const missing_listing  = orderedSkus.filter(s => !listingMap.has(s)).map(s => s)

    const response: ResultsResponse = {
      return_costs:           returnCosts.sort((a, b) => b.gross_units - a.gross_units),
      order_detail:           orderDetail,
      consolidated,
      portfolio_delivery_rate,
      portfolio_return_cost,
      unmapped_skus,
      missing_listing_skus: missing_listing,
    }

    return NextResponse.json(response)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
