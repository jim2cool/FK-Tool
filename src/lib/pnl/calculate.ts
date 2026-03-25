import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { calculateCogsBatch, type CogsBreakdown } from '@/lib/cogs/calculate'

export interface PnlBreakdown {
  group_key: string
  group_name: string
  gross_orders: number
  returned_orders: number
  cancelled_orders: number
  net_orders: number
  revenue: number
  cogs_per_unit: number | null
  total_cogs: number | null
  platform_fees: number
  logistics_fees: number
  taxes: number
  benefits: number
  seller_burns: number
  fee_details: {
    commission_fee: number
    collection_fee: number
    fixed_fee: number
    pick_pack_fee: number
    forward_shipping_fee: number
    reverse_shipping_fee: number
    offer_adjustments: number
    tax_gst: number
    tax_tcs: number
    tax_tds: number
    rewards: number
    spf_payout: number
    seller_offer_burn: number
  }
  projected_settlement: number
  amount_settled: number
  amount_pending: number
  fk_net_earnings: number
  true_profit: number | null
  margin_pct: number | null
  return_rate: number
  expected_profit_per_dispatch: number | null
  anomaly_count: number
  cogs_breakdown?: CogsBreakdown
}

export interface PnlSummary {
  total_revenue: number
  total_cogs: number
  total_platform_fees: number
  total_logistics: number
  total_true_profit: number
  overall_margin_pct: number
}

interface PnlOptions {
  tenantId?: string
  from: string
  to: string
  groupBy: 'product' | 'channel' | 'account'
  accountIds?: string[]
}

interface OrderWithFinancials {
  id: string
  master_sku_id: string | null
  combo_product_id: string | null
  marketplace_account_id: string | null
  channel: string | null
  gross_units: number
  net_units: number
  rto_units: number
  rvp_units: number
  cancelled_units: number
  order_financials: Array<{
    accounted_net_sales: number
    sale_amount: number
    seller_offer_burn: number
    commission_fee: number
    collection_fee: number
    fixed_fee: number
    offer_adjustments: number
    pick_pack_fee: number
    forward_shipping_fee: number
    reverse_shipping_fee: number
    tax_gst: number
    tax_tcs: number
    tax_tds: number
    rewards: number
    spf_payout: number
    projected_settlement: number
    amount_settled: number
    amount_pending: number
    anomaly_flags: Array<{ rule_key: string; message: string }>
  }>
}

export async function calculatePnl(options: PnlOptions): Promise<{ summary: PnlSummary; rows: PnlBreakdown[] }> {
  const supabase = await createClient()
  const tenantId = options.tenantId || await getTenantId()

  // Fetch orders with financials in date range
  let query = supabase
    .from('orders')
    .select(`
      id, master_sku_id, combo_product_id, marketplace_account_id, channel,
      gross_units, net_units, rto_units, rvp_units, cancelled_units,
      order_financials(
        accounted_net_sales, sale_amount, seller_offer_burn,
        commission_fee, collection_fee, fixed_fee, offer_adjustments,
        pick_pack_fee, forward_shipping_fee, reverse_shipping_fee,
        tax_gst, tax_tcs, tax_tds, rewards, spf_payout,
        projected_settlement, amount_settled, amount_pending, anomaly_flags
      )
    `)
    .eq('tenant_id', tenantId)
    .gte('order_date', options.from)
    .lte('order_date', options.to)

  if (options.accountIds?.length) {
    query = query.in('marketplace_account_id', options.accountIds)
  }

  const { data: orders } = await query

  if (!orders || orders.length === 0) {
    return {
      summary: { total_revenue: 0, total_cogs: 0, total_platform_fees: 0, total_logistics: 0, total_true_profit: 0, overall_margin_pct: 0 },
      rows: [],
    }
  }

  // Group orders by dimension
  const groups = new Map<string, OrderWithFinancials[]>()

  for (const order of orders as OrderWithFinancials[]) {
    let key: string
    switch (options.groupBy) {
      case 'product':
        key = order.master_sku_id || order.combo_product_id || 'unmapped'
        break
      case 'channel':
        key = order.channel || 'unknown'
        break
      case 'account':
        key = order.marketplace_account_id || 'unknown'
        break
    }
    const list = groups.get(key) ?? []
    list.push(order)
    groups.set(key, list)
  }

  // Fetch names for groups
  let nameMap = new Map<string, string>()

  if (options.groupBy === 'product') {
    const skuIds = [...groups.keys()].filter(k => k !== 'unmapped')
    if (skuIds.length > 0) {
      const { data: skus } = await supabase
        .from('master_skus')
        .select('id, name')
        .in('id', skuIds)
      for (const s of skus ?? []) nameMap.set(s.id, s.name)

      // Also check combo products
      const comboIds = skuIds.filter(id => !nameMap.has(id))
      if (comboIds.length > 0) {
        const { data: combos } = await supabase
          .from('combo_products')
          .select('id, name')
          .in('id', comboIds)
        for (const c of combos ?? []) nameMap.set(c.id, c.name)
      }
    }
  } else if (options.groupBy === 'account') {
    const accountIds = [...groups.keys()].filter(k => k !== 'unknown')
    if (accountIds.length > 0) {
      const { data: accounts } = await supabase
        .from('marketplace_accounts')
        .select('id, account_name')
        .in('id', accountIds)
      for (const a of accounts ?? []) nameMap.set(a.id, a.account_name)
    }
  }

  // Get COGS data for all SKUs (batch)
  const allSkuIds = [...new Set(
    (orders as OrderWithFinancials[])
      .map(o => o.master_sku_id)
      .filter(Boolean) as string[]
  )]
  const cogsMap = allSkuIds.length > 0 ? await calculateCogsBatch(allSkuIds) : new Map<string, CogsBreakdown>()

  // Build PnlBreakdown for each group
  const rows: PnlBreakdown[] = []

  for (const [key, groupOrders] of groups) {
    const fd = {
      commission_fee: 0, collection_fee: 0, fixed_fee: 0, pick_pack_fee: 0,
      forward_shipping_fee: 0, reverse_shipping_fee: 0, offer_adjustments: 0,
      tax_gst: 0, tax_tcs: 0, tax_tds: 0, rewards: 0, spf_payout: 0,
      seller_offer_burn: 0,
    }
    let revenue = 0, projectedSettlement = 0, amountSettled = 0, amountPending = 0
    let grossOrders = 0, returnedOrders = 0, cancelledOrders = 0, netOrders = 0
    let totalGrossUnits = 0, totalRtoUnits = 0, totalRvpUnits = 0
    let anomalyCount = 0

    for (const o of groupOrders) {
      grossOrders += o.gross_units
      totalGrossUnits += o.gross_units
      totalRtoUnits += o.rto_units
      totalRvpUnits += o.rvp_units
      returnedOrders += o.rto_units + o.rvp_units
      cancelledOrders += o.cancelled_units
      netOrders += o.net_units

      const fin = o.order_financials?.[0]
      if (!fin) continue

      revenue += Number(fin.accounted_net_sales) || 0
      fd.commission_fee += Number(fin.commission_fee) || 0
      fd.collection_fee += Number(fin.collection_fee) || 0
      fd.fixed_fee += Number(fin.fixed_fee) || 0
      fd.pick_pack_fee += Number(fin.pick_pack_fee) || 0
      fd.forward_shipping_fee += Number(fin.forward_shipping_fee) || 0
      fd.reverse_shipping_fee += Number(fin.reverse_shipping_fee) || 0
      fd.offer_adjustments += Number(fin.offer_adjustments) || 0
      fd.tax_gst += Number(fin.tax_gst) || 0
      fd.tax_tcs += Number(fin.tax_tcs) || 0
      fd.tax_tds += Number(fin.tax_tds) || 0
      fd.rewards += Number(fin.rewards) || 0
      fd.spf_payout += Number(fin.spf_payout) || 0
      fd.seller_offer_burn += Number(fin.seller_offer_burn) || 0
      projectedSettlement += Number(fin.projected_settlement) || 0
      amountSettled += Number(fin.amount_settled) || 0
      amountPending += Number(fin.amount_pending) || 0
      anomalyCount += (fin.anomaly_flags?.length ?? 0)
    }

    const platformFees = fd.commission_fee + fd.collection_fee + fd.fixed_fee + fd.offer_adjustments
    const logisticsFees = fd.forward_shipping_fee + fd.reverse_shipping_fee + fd.pick_pack_fee
    const taxes = fd.tax_gst + fd.tax_tcs + fd.tax_tds
    const benefits = fd.rewards + fd.spf_payout
    const sellerBurns = fd.seller_offer_burn

    const fkNetEarnings = revenue + platformFees + logisticsFees + taxes + benefits + sellerBurns

    // COGS — only for product groupBy with a valid SKU
    let cogsPerUnit: number | null = null
    let totalCogs: number | null = null
    let trueProfit: number | null = null
    let marginPct: number | null = null
    let cogsBreakdown: CogsBreakdown | undefined

    if (options.groupBy === 'product' && key !== 'unmapped') {
      const cogs = cogsMap.get(key)
      if (cogs) {
        cogsPerUnit = cogs.full_cogs_per_unit
        totalCogs = cogsPerUnit * netOrders
        trueProfit = fkNetEarnings - totalCogs
        marginPct = revenue > 0 ? (trueProfit / revenue) * 100 : null
        cogsBreakdown = cogs
      } else {
        trueProfit = fkNetEarnings
        marginPct = revenue > 0 ? (fkNetEarnings / revenue) * 100 : null
      }
    } else {
      // For channel/account, sum COGS across all SKUs in the group
      let groupTotalCogs = 0
      let hasCogs = false
      for (const o of groupOrders) {
        if (o.master_sku_id) {
          const cogs = cogsMap.get(o.master_sku_id)
          if (cogs) {
            groupTotalCogs += cogs.full_cogs_per_unit * o.net_units
            hasCogs = true
          }
        }
      }
      if (hasCogs) {
        totalCogs = groupTotalCogs
        trueProfit = fkNetEarnings - totalCogs
        marginPct = revenue > 0 ? (trueProfit / revenue) * 100 : null
      } else {
        trueProfit = fkNetEarnings
        marginPct = revenue > 0 ? (fkNetEarnings / revenue) * 100 : null
      }
    }

    const returnRate = totalGrossUnits > 0 ? (totalRtoUnits + totalRvpUnits) / totalGrossUnits : 0
    let expectedProfitPerDispatch: number | null = null
    if (trueProfit !== null && netOrders > 0) {
      const profitPerDelivered = trueProfit / netOrders
      expectedProfitPerDispatch = Math.round(profitPerDelivered * (1 - returnRate) * 100) / 100
    }

    let groupName: string
    if (options.groupBy === 'channel') {
      groupName = key.charAt(0).toUpperCase() + key.slice(1)
    } else {
      groupName = nameMap.get(key) || (key === 'unmapped' ? 'Unmapped SKUs' : key === 'unknown' ? 'Unknown' : key)
    }

    rows.push({
      group_key: key,
      group_name: groupName,
      gross_orders: grossOrders,
      returned_orders: returnedOrders,
      cancelled_orders: cancelledOrders,
      net_orders: netOrders,
      revenue: Math.round(revenue * 100) / 100,
      cogs_per_unit: cogsPerUnit,
      total_cogs: totalCogs !== null ? Math.round(totalCogs * 100) / 100 : null,
      platform_fees: Math.round(platformFees * 100) / 100,
      logistics_fees: Math.round(logisticsFees * 100) / 100,
      taxes: Math.round(taxes * 100) / 100,
      benefits: Math.round(benefits * 100) / 100,
      seller_burns: Math.round(sellerBurns * 100) / 100,
      fee_details: {
        commission_fee: Math.round(fd.commission_fee * 100) / 100,
        collection_fee: Math.round(fd.collection_fee * 100) / 100,
        fixed_fee: Math.round(fd.fixed_fee * 100) / 100,
        pick_pack_fee: Math.round(fd.pick_pack_fee * 100) / 100,
        forward_shipping_fee: Math.round(fd.forward_shipping_fee * 100) / 100,
        reverse_shipping_fee: Math.round(fd.reverse_shipping_fee * 100) / 100,
        offer_adjustments: Math.round(fd.offer_adjustments * 100) / 100,
        tax_gst: Math.round(fd.tax_gst * 100) / 100,
        tax_tcs: Math.round(fd.tax_tcs * 100) / 100,
        tax_tds: Math.round(fd.tax_tds * 100) / 100,
        rewards: Math.round(fd.rewards * 100) / 100,
        spf_payout: Math.round(fd.spf_payout * 100) / 100,
        seller_offer_burn: Math.round(fd.seller_offer_burn * 100) / 100,
      },
      projected_settlement: Math.round(projectedSettlement * 100) / 100,
      amount_settled: Math.round(amountSettled * 100) / 100,
      amount_pending: Math.round(amountPending * 100) / 100,
      fk_net_earnings: Math.round(fkNetEarnings * 100) / 100,
      true_profit: trueProfit !== null ? Math.round(trueProfit * 100) / 100 : null,
      margin_pct: marginPct !== null ? Math.round(marginPct * 100) / 100 : null,
      return_rate: Math.round(returnRate * 10000) / 10000,
      expected_profit_per_dispatch: expectedProfitPerDispatch,
      anomaly_count: anomalyCount,
      cogs_breakdown: cogsBreakdown,
    })
  }

  // Sort by revenue desc
  rows.sort((a, b) => b.revenue - a.revenue)

  // Summary
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
  const totalCogs = rows.reduce((s, r) => s + (r.total_cogs ?? 0), 0)
  const totalPlatformFees = rows.reduce((s, r) => s + r.platform_fees, 0)
  const totalLogistics = rows.reduce((s, r) => s + r.logistics_fees, 0)
  const totalTrueProfit = rows.reduce((s, r) => s + (r.true_profit ?? r.fk_net_earnings), 0)

  return {
    summary: {
      total_revenue: Math.round(totalRevenue * 100) / 100,
      total_cogs: Math.round(totalCogs * 100) / 100,
      total_platform_fees: Math.round(totalPlatformFees * 100) / 100,
      total_logistics: Math.round(totalLogistics * 100) / 100,
      total_true_profit: Math.round(totalTrueProfit * 100) / 100,
      overall_margin_pct: totalRevenue > 0 ? Math.round((totalTrueProfit / totalRevenue) * 10000) / 100 : 0,
    },
    rows,
  }
}
