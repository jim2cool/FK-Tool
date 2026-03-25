import { getTenantId } from '@/lib/db/tenant'
import { createClient } from '@/lib/supabase/server'
import { calculatePnl } from '@/lib/pnl/calculate'
import { computeWaterfall, computeMomDeltas, deriveTopBottom } from '@/lib/pnl/waterfall'
import { generateInsights } from '@/lib/pnl/insights'
import type { RecoveryData } from '@/lib/pnl/insights'
import { computeRecoveryMetrics } from '@/lib/pnl/recovery'
import { calculateCogsBatch } from '@/lib/cogs/calculate'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const params = request.nextUrl.searchParams

    const from = params.get('from') || ''
    const to = params.get('to') || ''
    const accountIdsParam = params.get('accountIds')
    const accountIds = accountIdsParam ? accountIdsParam.split(',').filter(Boolean) : undefined

    if (!from || !to) {
      return NextResponse.json({ error: 'from and to date params required' }, { status: 400 })
    }

    // 1. Current period P&L (product-grouped)
    const current = await calculatePnl({ tenantId, from, to, groupBy: 'product', accountIds })

    // 2. Prior month P&L (for MoM deltas)
    const fromDate = new Date(from)
    fromDate.setMonth(fromDate.getMonth() - 1)
    const toDate = new Date(to)
    toDate.setMonth(toDate.getMonth() - 1)
    // Adjust to last day of prior month
    const priorFrom = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-01`
    const priorLastDay = new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, 0).getDate()
    const priorTo = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(priorLastDay).padStart(2, '0')}`

    let priorSummary = null
    try {
      const prior = await calculatePnl({ tenantId, from: priorFrom, to: priorTo, groupBy: 'product', accountIds })
      if (prior.rows.length > 0) priorSummary = prior.summary
    } catch {
      // No prior data — deltas will be null
    }

    // 3. Fetch overheads for current and prior months
    const monthStr = from.substring(0, 7) // "YYYY-MM"
    const { data: overheadRows } = await supabase
      .from('monthly_overheads')
      .select('amount')
      .eq('tenant_id', tenantId)
      .eq('month', monthStr)

    const overheadsTotal = (overheadRows ?? []).reduce((s, r) => s + Number(r.amount), 0)

    const priorMonthStr = priorFrom.substring(0, 7)
    const { data: priorOverheadRows } = await supabase
      .from('monthly_overheads')
      .select('amount')
      .eq('tenant_id', tenantId)
      .eq('month', priorMonthStr)

    const priorOverheadsTotal = (priorOverheadRows ?? []).reduce((s, r) => s + Number(r.amount), 0)

    // 4. Waterfall + MoM + Top/Bottom
    const waterfall = computeWaterfall(current.rows, overheadsTotal)
    const mom_deltas = computeMomDeltas(current.summary, priorSummary, overheadsTotal, priorOverheadsTotal)
    const { top_profitable, top_losing, high_return } = deriveTopBottom(current.rows)

    // 5. Cash flow — per-order query
    let cashflowQuery = supabase
      .from('orders')
      .select(`
        order_date, platform_order_id, master_sku_id, combo_product_id,
        order_financials(accounted_net_sales, projected_settlement, amount_settled, amount_pending)
      `)
      .eq('tenant_id', tenantId)
      .gte('order_date', from)
      .lte('order_date', to)

    if (accountIds?.length) {
      cashflowQuery = cashflowQuery.in('marketplace_account_id', accountIds)
    }

    const { data: cashflowOrders } = await cashflowQuery

    // Aggregate timeline by date
    const timelineMap = new Map<string, { settled: number; pending: number }>()
    const pendingOrdersList: Array<{
      order_date: string; platform_order_id: string; sku_name: string
      revenue: number; projected: number; pending: number; days_since: number
    }> = []

    let totalSettled = 0
    let totalPending = 0
    const today = new Date()

    // Fetch SKU names for pending orders
    const skuIds = [...new Set((cashflowOrders ?? []).map(o => o.master_sku_id).filter(Boolean))]
    const comboIds = [...new Set((cashflowOrders ?? []).map(o => o.combo_product_id).filter(Boolean))]
    const nameMap = new Map<string, string>()

    if (skuIds.length > 0) {
      const { data: skus } = await supabase.from('master_skus').select('id, name').in('id', skuIds)
      for (const s of skus ?? []) nameMap.set(s.id, s.name)
    }
    if (comboIds.length > 0) {
      const { data: combos } = await supabase.from('combo_products').select('id, name').in('id', comboIds)
      for (const c of combos ?? []) nameMap.set(c.id, c.name)
    }

    for (const o of cashflowOrders ?? []) {
      const fin = (o.order_financials as Array<Record<string, number>>)?.[0]
      if (!fin) continue

      const settled = Number(fin.amount_settled) || 0
      const pending = Number(fin.amount_pending) || 0
      totalSettled += settled
      totalPending += pending

      const date = o.order_date
      const existing = timelineMap.get(date) || { settled: 0, pending: 0 }
      existing.settled += settled
      existing.pending += pending
      timelineMap.set(date, existing)

      if (pending > 0) {
        const daysSince = Math.floor((today.getTime() - new Date(date).getTime()) / 86400000)
        const skuName = nameMap.get(o.master_sku_id) || nameMap.get(o.combo_product_id) || `Order ${o.platform_order_id}`
        pendingOrdersList.push({
          order_date: date,
          platform_order_id: o.platform_order_id,
          sku_name: skuName,
          revenue: Number(fin.accounted_net_sales) || 0,
          projected: Number(fin.projected_settlement) || 0,
          pending,
          days_since: daysSince,
        })
      }
    }

    // Sort pending by days_since desc, limit 100
    pendingOrdersList.sort((a, b) => b.days_since - a.days_since)
    const pendingOrders = pendingOrdersList.slice(0, 100)

    // Timeline sorted by date
    const timeline = [...timelineMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date, settled: Math.round(vals.settled * 100) / 100, pending: Math.round(vals.pending * 100) / 100 }))

    const settlementRate = (totalSettled + totalPending) > 0
      ? Math.round((totalSettled / (totalSettled + totalPending)) * 1000) / 10
      : 0

    // 6. Insights
    const { data: rules } = await supabase
      .from('pnl_anomaly_rules')
      .select('rule_key, threshold_value')
      .eq('tenant_id', tenantId)
      .eq('enabled', true)

    const moneyLoserRule = (rules ?? []).find(r => r.rule_key === 'money_loser_margin')
    const returnRateRule = (rules ?? []).find(r => r.rule_key === 'high_return_rate')

    const thresholds = {
      moneyLoserMargin: moneyLoserRule?.threshold_value ?? 0,
      highReturnRate: returnRateRule?.threshold_value ?? 0.40,
    }

    const { data: dismissed } = await supabase
      .from('dismissed_insights')
      .select('insight_key')
      .eq('tenant_id', tenantId)

    const dismissedKeys = new Set((dismissed ?? []).map(d => d.insight_key))

    // 7. Recovery metrics for extended insights
    const productSkuIds = current.rows
      .filter(r => r.group_key !== 'unmapped')
      .map(r => r.group_key)

    let recoveryMap: Map<string, RecoveryData> | undefined
    try {
      if (productSkuIds.length > 0) {
        const cogsMap = await calculateCogsBatch(productSkuIds)
        const recoveryMetrics = await computeRecoveryMetrics(tenantId, productSkuIds, from, to, cogsMap)
        recoveryMap = new Map<string, RecoveryData>()
        for (const [skuId, metrics] of recoveryMetrics) {
          recoveryMap.set(skuId, {
            recovery_rounds: metrics.recovery_rounds,
            cash_cycle_days: metrics.cash_cycle_days,
            rto_rate: metrics.rto_rate,
            rvp_rate: metrics.rvp_rate,
            top_return_reasons: metrics.top_return_reasons,
          })
        }
      }
    } catch (err) {
      console.warn('[pnl/dashboard] Recovery metrics failed, continuing without:', err)
    }

    const contributionMargin = current.summary.total_true_profit

    const insights = generateInsights(current.rows, dismissedKeys, thresholds, {
      recoveryMap,
      overheadsTotal,
      contributionMargin,
    })

    const operatingProfit = waterfall.true_profit - overheadsTotal
    const breakEvenPct = overheadsTotal > 0
      ? Math.round((waterfall.true_profit / overheadsTotal) * 1000) / 10
      : 0

    return NextResponse.json({
      waterfall,
      mom_deltas,
      top_profitable,
      top_losing,
      high_return,
      cashflow: {
        settled: Math.round(totalSettled * 100) / 100,
        pending: Math.round(totalPending * 100) / 100,
        settlement_rate: settlementRate,
        timeline,
        pending_orders: pendingOrders,
      },
      insights,
      overheads_total: Math.round(overheadsTotal * 100) / 100,
      operating_profit: Math.round(operatingProfit * 100) / 100,
      break_even_pct: breakEvenPct,
    })
  } catch (e: unknown) {
    console.error('[pnl/dashboard]', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
