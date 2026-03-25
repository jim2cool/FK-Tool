import type { PnlBreakdown, PnlSummary } from './calculate'

export interface WaterfallData {
  revenue: number
  platform_fees: number
  seller_offers: number
  logistics: number
  cogs: number
  gst: number
  tcs_tds: number
  benefits: number
  true_profit: number
  overheads: number
  operating_profit: number
}

export interface MomDeltas {
  revenue_pct: number | null
  cogs_pct: number | null
  platform_fees_pct: number | null
  logistics_pct: number | null
  true_profit_pct: number | null
  margin_delta: number | null
  operating_profit_pct: number | null
}

export interface TopBottomSku {
  name: string
  group_key: string
  profit?: number
  margin?: number
  loss?: number
  driver?: string
  return_rate?: number
  cost?: number
}

export interface PnlDashboardResponse {
  waterfall: WaterfallData
  mom_deltas: MomDeltas
  top_profitable: TopBottomSku[]
  top_losing: TopBottomSku[]
  high_return: TopBottomSku[]
  cashflow: {
    settled: number
    pending: number
    settlement_rate: number
    timeline: Array<{ date: string; settled: number; pending: number }>
    pending_orders: Array<{
      order_date: string
      platform_order_id: string
      sku_name: string
      revenue: number
      projected: number
      pending: number
      days_since: number
    }>
  }
  insights: import('@/lib/pnl/insights').PnlInsight[]
  overheads_total: number
  operating_profit: number
  break_even_pct: number
}

export function computeWaterfall(rows: PnlBreakdown[], overheads: number = 0): WaterfallData {
  let platformFees = 0
  let sellerOffers = 0
  let logistics = 0
  let cogs = 0
  let gst = 0
  let tcsTds = 0
  let benefits = 0
  let revenue = 0

  for (const r of rows) {
    revenue += r.revenue
    platformFees += Math.abs(r.fee_details.commission_fee + r.fee_details.collection_fee + r.fee_details.fixed_fee + r.fee_details.offer_adjustments)
    sellerOffers += Math.abs(r.fee_details.seller_offer_burn)
    logistics += Math.abs(r.fee_details.pick_pack_fee + r.fee_details.forward_shipping_fee + r.fee_details.reverse_shipping_fee)
    cogs += r.total_cogs ?? 0
    gst += Math.abs(r.fee_details.tax_gst)
    tcsTds += Math.abs(r.fee_details.tax_tcs + r.fee_details.tax_tds)
    benefits += r.fee_details.rewards + r.fee_details.spf_payout
  }

  const trueProfit = revenue - platformFees - sellerOffers - logistics - cogs - gst - tcsTds + benefits
  const operatingProfit = trueProfit - overheads

  return {
    revenue: Math.round(revenue * 100) / 100,
    platform_fees: Math.round(platformFees * 100) / 100,
    seller_offers: Math.round(sellerOffers * 100) / 100,
    logistics: Math.round(logistics * 100) / 100,
    cogs: Math.round(cogs * 100) / 100,
    gst: Math.round(gst * 100) / 100,
    tcs_tds: Math.round(tcsTds * 100) / 100,
    benefits: Math.round(benefits * 100) / 100,
    true_profit: Math.round(trueProfit * 100) / 100,
    overheads: Math.round(overheads * 100) / 100,
    operating_profit: Math.round(operatingProfit * 100) / 100,
  }
}

function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return null
  return Math.round(((current - prior) / Math.abs(prior)) * 1000) / 10
}

export function computeMomDeltas(
  current: PnlSummary, prior: PnlSummary | null,
  currentOverheads: number = 0, priorOverheads: number = 0,
): MomDeltas {
  if (!prior) {
    return { revenue_pct: null, cogs_pct: null, platform_fees_pct: null, logistics_pct: null, true_profit_pct: null, margin_delta: null, operating_profit_pct: null }
  }
  const currentOp = current.total_true_profit - currentOverheads
  const priorOp = prior.total_true_profit - priorOverheads
  return {
    revenue_pct: pctChange(current.total_revenue, prior.total_revenue),
    cogs_pct: pctChange(current.total_cogs, prior.total_cogs),
    platform_fees_pct: pctChange(Math.abs(current.total_platform_fees), Math.abs(prior.total_platform_fees)),
    logistics_pct: pctChange(Math.abs(current.total_logistics), Math.abs(prior.total_logistics)),
    true_profit_pct: pctChange(current.total_true_profit, prior.total_true_profit),
    margin_delta: Math.round((current.overall_margin_pct - prior.overall_margin_pct) * 10) / 10,
    operating_profit_pct: pctChange(currentOp, priorOp),
  }
}

export function deriveTopBottom(rows: PnlBreakdown[]): {
  top_profitable: TopBottomSku[]
  top_losing: TopBottomSku[]
  high_return: TopBottomSku[]
} {
  const profitable = rows
    .filter(r => (r.true_profit ?? 0) > 0 && r.group_key !== 'unmapped')
    .sort((a, b) => (b.true_profit ?? 0) - (a.true_profit ?? 0))
    .slice(0, 3)
    .map(r => ({ name: r.group_name, group_key: r.group_key, profit: r.true_profit!, margin: r.margin_pct! }))

  const losing = rows
    .filter(r => (r.true_profit ?? 0) < 0 && r.group_key !== 'unmapped')
    .sort((a, b) => (a.true_profit ?? 0) - (b.true_profit ?? 0))
    .slice(0, 3)
    .map(r => {
      let driver = 'COGS too high'
      if (r.return_rate > 0.4) driver = `High returns (${Math.round(r.return_rate * 100)}%)`
      else if (Math.abs(r.platform_fees + r.logistics_fees) > (r.total_cogs ?? 0)) driver = 'Platform fees + logistics'
      return { name: r.group_name, group_key: r.group_key, loss: Math.abs(r.true_profit!), driver }
    })

  const highReturn = rows
    .filter(r => r.return_rate > 0 && r.group_key !== 'unmapped')
    .sort((a, b) => b.return_rate - a.return_rate)
    .slice(0, 3)
    .map(r => ({
      name: r.group_name,
      group_key: r.group_key,
      return_rate: r.return_rate,
      cost: Math.abs(r.fee_details.reverse_shipping_fee) + (r.total_cogs ?? 0) * r.return_rate,
    }))

  return { top_profitable: profitable, top_losing: losing, high_return: highReturn }
}
