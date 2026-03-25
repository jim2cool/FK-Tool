// src/lib/pnl/recovery.ts
// Recovery metrics computation — per-SKU recovery rounds, return breakdown, and verdicts.

import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecoveryMetrics {
  // Per-SKU cost & recovery
  all_in_cost_per_unit: number | null
  net_settlement_per_unit: number | null
  recovery_rounds: number | null

  // Timeline metrics (days)
  avg_order_to_delivery_days: number | null
  avg_order_to_settlement_days: number | null
  avg_rto_return_days: number | null
  avg_rvp_return_days: number | null
  cash_cycle_days: number | null

  // Return breakdown
  rto_rate: number
  rvp_rate: number
  cancel_rate: number
  total_return_cost: number

  // Return reasons (top 5)
  top_return_reasons: Array<{ reason: string; count: number; pct: number }>

  // Verdict
  verdict: 'star' | 'healthy' | 'watch' | 'reduce' | 'stop' | 'cash_trap'
  verdict_label: string
}

export type RecoveryVerdict = RecoveryMetrics['verdict']

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface OrderRow {
  id: string
  master_sku_id: string
  gross_units: number
  net_units: number
  rto_units: number
  rvp_units: number
  cancelled_units: number
  order_date: string | null
  dispatch_date: string | null
  delivery_date: string | null
  return_request_date: string | null
  return_complete_date: string | null
  return_type: string | null
  settlement_date: string | null
  return_reason: string | null
  return_sub_reason: string | null
  status: string
  order_financials: Array<{
    accounted_net_sales: number
    amount_settled: number
    forward_shipping_fee: number
    reverse_shipping_fee: number
    pick_pack_fee: number
  }> | null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Calendar-day difference between two ISO date strings. Returns null if either is falsy. */
function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const diff = new Date(b).getTime() - new Date(a).getTime()
  if (Number.isNaN(diff)) return null
  return diff / 86_400_000
}

function avgPositive(values: number[]): number | null {
  const valid = values.filter((v) => v > 0)
  if (valid.length === 0) return null
  return round2(valid.reduce((s, v) => s + v, 0) / valid.length)
}

function avgNonNull(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null && !Number.isNaN(v))
  if (valid.length === 0) return null
  return round2(valid.reduce((s, v) => s + v, 0) / valid.length)
}

// ---------------------------------------------------------------------------
// Verdict logic — first matching rule wins (priority order)
// ---------------------------------------------------------------------------

function computeVerdict(
  margin: number | null,
  returnRate: number,
  recoveryRounds: number | null,
): { verdict: RecoveryVerdict; verdict_label: string } {
  // If we can't compute margin at all, fall back to return-rate-only rules
  if (margin === null) {
    if (returnRate > 0.4) return { verdict: 'reduce', verdict_label: 'Reduce — returns eating profit' }
    return { verdict: 'watch', verdict_label: 'Watch — insufficient data for margin' }
  }

  // Priority: stop > reduce > cash_trap > watch > healthy > star
  if (margin < 0) {
    return { verdict: 'stop', verdict_label: 'Stop — losing money' }
  }
  if (returnRate > 0.4) {
    return { verdict: 'reduce', verdict_label: 'Reduce — returns eating profit' }
  }
  if (margin > 0 && recoveryRounds !== null && recoveryRounds > 3) {
    return { verdict: 'cash_trap', verdict_label: 'Cash Trap — locks too much capital' }
  }
  if (margin >= 0 && margin < 10) {
    return { verdict: 'watch', verdict_label: 'Watch — thin margins' }
  }
  if (margin >= 10 && margin < 20 && returnRate < 0.4) {
    return { verdict: 'healthy', verdict_label: 'Healthy' }
  }
  if (margin >= 20 && returnRate < 0.3 && (recoveryRounds === null || recoveryRounds < 2)) {
    return { verdict: 'star', verdict_label: 'Star Performer — increase stock' }
  }

  // Default healthy if nothing else matched
  return { verdict: 'healthy', verdict_label: 'Healthy' }
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

/**
 * Compute recovery metrics for a batch of SKUs over a date range.
 *
 * @param tenantId   - tenant UUID
 * @param skuIds     - master_sku IDs to compute for
 * @param from       - start date (inclusive, ISO string e.g. "2026-01-01")
 * @param to         - end date (inclusive, ISO string e.g. "2026-03-31")
 * @param cogsMap    - pre-computed COGS per SKU (from calculateCogsBatch)
 */
export async function computeRecoveryMetrics(
  tenantId: string,
  skuIds: string[],
  from: string,
  to: string,
  cogsMap: Map<string, { full_cogs_per_unit: number }>,
): Promise<Map<string, RecoveryMetrics>> {
  const result = new Map<string, RecoveryMetrics>()
  if (skuIds.length === 0) return result

  const supabase = await createClient()

  // ----- 1. Fetch orders + financials -----
  // Supabase JS client supports foreign-table joins via select string.
  // order_financials has order_id FK → orders.id
  const { data: rows, error } = await supabase
    .from('orders')
    .select(
      `
      id,
      master_sku_id,
      gross_units,
      net_units,
      rto_units,
      rvp_units,
      cancelled_units,
      order_date,
      dispatch_date,
      delivery_date,
      return_request_date,
      return_complete_date,
      return_type,
      settlement_date,
      return_reason,
      return_sub_reason,
      status,
      order_financials (
        accounted_net_sales,
        amount_settled,
        forward_shipping_fee,
        reverse_shipping_fee,
        pick_pack_fee
      )
    `,
    )
    .eq('tenant_id', tenantId)
    .in('master_sku_id', skuIds)
    .gte('order_date', from)
    .lte('order_date', to)

  if (error || !rows || rows.length === 0) return result

  const orders = rows as unknown as OrderRow[]

  // ----- 2. Group by master_sku_id -----
  const grouped = new Map<string, OrderRow[]>()
  for (const o of orders) {
    if (!o.master_sku_id) continue
    const list = grouped.get(o.master_sku_id) ?? []
    list.push(o)
    grouped.set(o.master_sku_id, list)
  }

  // ----- 3. Compute per-SKU metrics -----
  for (const [skuId, skuOrders] of grouped) {
    const cogsEntry = cogsMap.get(skuId)
    const cogsPerUnit = cogsEntry?.full_cogs_per_unit ?? null

    // --- Aggregated unit counts ---
    let totalGross = 0
    let totalNet = 0
    let totalRto = 0
    let totalRvp = 0
    let totalCancelled = 0

    for (const o of skuOrders) {
      totalGross += o.gross_units
      totalNet += o.net_units
      totalRto += o.rto_units
      totalRvp += o.rvp_units
      totalCancelled += o.cancelled_units
    }

    const rtoRate = totalGross > 0 ? round2(totalRto / totalGross) : 0
    const rvpRate = totalGross > 0 ? round2(totalRvp / totalGross) : 0
    const cancelRate = totalGross > 0 ? round2(totalCancelled / totalGross) : 0
    const returnRate = rtoRate + rvpRate

    // --- Timeline metrics ---
    const orderToDelivery: (number | null)[] = []
    const orderToSettlement: (number | null)[] = []
    const rtoReturnDays: (number | null)[] = []
    const rvpReturnDays: (number | null)[] = []

    for (const o of skuOrders) {
      orderToDelivery.push(daysBetween(o.order_date, o.delivery_date))
      orderToSettlement.push(daysBetween(o.order_date, o.settlement_date))
      if (o.return_type === 'rto') {
        rtoReturnDays.push(daysBetween(o.dispatch_date, o.return_complete_date))
      }
      if (o.return_type === 'rvp') {
        rvpReturnDays.push(daysBetween(o.dispatch_date, o.return_complete_date))
      }
    }

    const avgOrderToDelivery = avgNonNull(orderToDelivery)
    const avgOrderToSettlement = avgNonNull(orderToSettlement)
    const avgRtoReturn = avgNonNull(rtoReturnDays)
    const avgRvpReturn = avgNonNull(rvpReturnDays)

    // Weighted average return days
    let avgReturnDays: number | null = null
    if (totalRto + totalRvp > 0) {
      const rtoWeight = totalRto / (totalRto + totalRvp)
      const rvpWeight = totalRvp / (totalRto + totalRvp)
      const rtoVal = avgRtoReturn ?? 0
      const rvpVal = avgRvpReturn ?? 0
      if (avgRtoReturn !== null || avgRvpReturn !== null) {
        avgReturnDays = round2(rtoWeight * rtoVal + rvpWeight * rvpVal)
      }
    }

    // Cash cycle = avg order-to-settlement + return_rate * avg_return_days
    let cashCycleDays: number | null = null
    if (avgOrderToSettlement !== null) {
      const returnComponent = avgReturnDays !== null ? returnRate * avgReturnDays : 0
      cashCycleDays = round2(avgOrderToSettlement + returnComponent)
    }

    // --- Cost metrics (from financials on delivered orders) ---
    const deliveredWithFinancials: Array<{
      accounted_net_sales: number
      amount_settled: number
      forward_shipping_fee: number
      reverse_shipping_fee: number
      pick_pack_fee: number
    }> = []

    let totalReverseShipping = 0

    for (const o of skuOrders) {
      const fin = o.order_financials?.[0]
      if (!fin) continue

      totalReverseShipping += Math.abs(fin.reverse_shipping_fee)

      // Delivered orders for per-unit fee averages
      if (o.status === 'delivered' && o.net_units > 0) {
        deliveredWithFinancials.push(fin)
      }
    }

    // Avg fees per unit (forward shipping + pick & pack) across delivered orders
    let avgFeesPerUnit: number | null = null
    if (deliveredWithFinancials.length > 0) {
      const totalFees = deliveredWithFinancials.reduce(
        (sum, f) => sum + Math.abs(f.forward_shipping_fee) + Math.abs(f.pick_pack_fee),
        0,
      )
      avgFeesPerUnit = round2(totalFees / deliveredWithFinancials.length)
    }

    // Return cost per unit = (avg_reverse_shipping + cogs * shrinkage_rate_proxy) * return_rate
    // We approximate the per-return cost as avg reverse shipping per return + lost COGS
    const totalReturns = totalRto + totalRvp
    const avgReversePerReturn = totalReturns > 0 ? totalReverseShipping / totalReturns : 0
    const lostCogsPerReturn = cogsPerUnit ?? 0
    const returnCostPerUnit = round2((avgReversePerReturn + lostCogsPerReturn) * returnRate)

    // Total return cost across all orders
    const totalReturnCost = round2(totalReverseShipping + lostCogsPerReturn * totalReturns)

    // All-in cost per unit
    let allInCost: number | null = null
    if (cogsPerUnit !== null) {
      allInCost = round2(cogsPerUnit + (avgFeesPerUnit ?? 0) + returnCostPerUnit)
    }

    // Net settlement per delivered unit
    let netSettlementPerUnit: number | null = null
    const settledOrders = deliveredWithFinancials.filter((f) => f.amount_settled > 0)
    if (settledOrders.length > 0) {
      netSettlementPerUnit = round2(
        settledOrders.reduce((s, f) => s + f.amount_settled, 0) / settledOrders.length,
      )
    }

    // Recovery rounds
    let recoveryRounds: number | null = null
    if (allInCost !== null && netSettlementPerUnit !== null && netSettlementPerUnit > 0) {
      recoveryRounds = round2(allInCost / netSettlementPerUnit)
    }

    // --- Margin (for verdict) ---
    let margin: number | null = null
    if (netSettlementPerUnit !== null && netSettlementPerUnit > 0 && cogsPerUnit !== null) {
      margin = round2(((netSettlementPerUnit - cogsPerUnit) / netSettlementPerUnit) * 100)
    } else if (deliveredWithFinancials.length > 0 && cogsPerUnit !== null) {
      // Fallback: use accounted_net_sales
      const avgNetSales = round2(
        deliveredWithFinancials.reduce((s, f) => s + f.accounted_net_sales, 0) /
          deliveredWithFinancials.length,
      )
      if (avgNetSales > 0) {
        margin = round2(((avgNetSales - cogsPerUnit) / avgNetSales) * 100)
      }
    }

    // --- Return reasons (top 5) ---
    const reasonCounts = new Map<string, number>()
    let totalWithReason = 0
    for (const o of skuOrders) {
      if (o.return_reason) {
        reasonCounts.set(o.return_reason, (reasonCounts.get(o.return_reason) ?? 0) + 1)
        totalWithReason++
      }
    }

    const topReturnReasons = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({
        reason,
        count,
        pct: round2((count / totalWithReason) * 100),
      }))

    // --- Verdict ---
    const { verdict, verdict_label } = computeVerdict(margin, returnRate, recoveryRounds)

    result.set(skuId, {
      all_in_cost_per_unit: allInCost,
      net_settlement_per_unit: netSettlementPerUnit,
      recovery_rounds: recoveryRounds,

      avg_order_to_delivery_days: avgOrderToDelivery,
      avg_order_to_settlement_days: avgOrderToSettlement,
      avg_rto_return_days: avgRtoReturn,
      avg_rvp_return_days: avgRvpReturn,
      cash_cycle_days: cashCycleDays,

      rto_rate: rtoRate,
      rvp_rate: rvpRate,
      cancel_rate: cancelRate,
      total_return_cost: totalReturnCost,

      top_return_reasons: topReturnReasons,

      verdict,
      verdict_label,
    })
  }

  return result
}
