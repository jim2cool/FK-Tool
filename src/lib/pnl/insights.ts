import type { PnlBreakdown } from './calculate'

export interface PnlInsight {
  id: string
  category: 'money_loser' | 'return_alert' | 'fee_anomaly' | 'cash_trap' | 'break_even' | 'return_pattern'
  title: string
  description: string
  metrics: Record<string, number | string>
  actions: string[]
  impact: number
}

interface InsightThresholds {
  moneyLoserMargin: number  // default 0 (actual losses only)
  highReturnRate: number    // default 0.40
}

export interface RecoveryData {
  recovery_rounds: number | null
  cash_cycle_days: number | null
  rto_rate: number
  rvp_rate: number
  top_return_reasons: Array<{ reason: string; count: number; pct: number }>
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

export function generateInsights(
  rows: PnlBreakdown[],
  dismissedKeys: Set<string>,
  thresholds: InsightThresholds,
  extras?: {
    recoveryMap?: Map<string, RecoveryData>
    overheadsTotal?: number
    contributionMargin?: number
  }
): PnlInsight[] {
  const insights: PnlInsight[] = []

  for (const r of rows) {
    if (r.group_key === 'unmapped') continue

    // Category 1: Money Losers
    if (r.true_profit !== null && r.margin_pct !== null && r.margin_pct < thresholds.moneyLoserMargin) {
      const key = `money_loser::${r.group_key}`
      if (!dismissedKeys.has(key)) {
        let driver: string
        let description: string
        if (r.return_rate > 0.4) {
          driver = 'high_returns'
          description = `High return rate (${Math.round(r.return_rate * 100)}%) is the main cost driver. Each returned unit costs you shipping + lost COGS.`
        } else if (Math.abs(r.platform_fees + r.logistics_fees) > (r.total_cogs ?? 0)) {
          driver = 'platform_fees'
          description = `Platform fees + logistics (${fmt(Math.abs(r.platform_fees + r.logistics_fees))}) exceed your COGS (${fmt(r.total_cogs ?? 0)}). Consider negotiating fees or switching fulfillment.`
        } else {
          driver = 'high_cogs'
          const cogsPerUnit = r.cogs_per_unit ?? 0
          const sellingPrice = r.net_orders > 0 ? r.revenue / r.net_orders : 0
          description = `COGS (${fmt(cogsPerUnit)}/unit) is too high relative to selling price (${fmt(sellingPrice)}). Find cheaper suppliers or raise prices.`
        }

        // Compute break-even price increase
        const lossPerUnit = r.net_orders > 0 ? Math.abs(r.true_profit) / r.net_orders : 0
        const actions = [`Raise price by ${fmt(lossPerUnit)} to break even`, 'Consider discontinuing']
        if (driver === 'high_returns') actions.push('Review listing accuracy & packaging')

        insights.push({
          id: key,
          category: 'money_loser',
          title: `${r.group_name} is losing ${fmt(Math.abs(r.true_profit))}`,
          description,
          metrics: {
            'Margin': `${r.margin_pct.toFixed(1)}%`,
            'Loss/unit': fmt(lossPerUnit),
            'Driver': driver === 'high_returns' ? 'Returns' : driver === 'platform_fees' ? 'Fees' : 'COGS',
          },
          actions,
          impact: Math.abs(r.true_profit),
        })
      }
    }

    // Category 2: Return Rate Alerts
    if (r.return_rate > thresholds.highReturnRate) {
      const key = `return_alert::${r.group_key}`
      if (!dismissedKeys.has(key)) {
        const returnCost = Math.abs(r.fee_details.reverse_shipping_fee) + (r.total_cogs ?? 0) * r.return_rate
        insights.push({
          id: key,
          category: 'return_alert',
          title: `${r.group_name} has ${Math.round(r.return_rate * 100)}% return rate`,
          description: `${r.returned_orders} of ${r.gross_orders} orders were returned. Estimated cost of returns: ${fmt(returnCost)}.`,
          metrics: {
            'Return Rate': `${Math.round(r.return_rate * 100)}%`,
            'Returns': `${r.returned_orders} of ${r.gross_orders}`,
            'Return Cost': fmt(returnCost),
          },
          actions: ['Check product listing accuracy', 'Review packaging quality', 'Consider removing from marketplace'],
          impact: returnCost,
        })
      }
    }

    // Category 3: Fee Anomalies
    if (r.anomaly_count > 0) {
      const key = `fee_anomaly::${r.group_key}`
      if (!dismissedKeys.has(key)) {
        insights.push({
          id: key,
          category: 'fee_anomaly',
          title: `${r.anomaly_count} billing anomal${r.anomaly_count > 1 ? 'ies' : 'y'} on ${r.group_name}`,
          description: `Potential billing errors detected. Review orders and file claims with Flipkart if charges are incorrect.`,
          metrics: {
            'Anomalies': `${r.anomaly_count}`,
            'Product': r.group_name,
          },
          actions: ['Review flagged orders', 'File claim with Flipkart support'],
          impact: r.anomaly_count * 50, // rough estimate per anomaly
        })
      }
    }

    // Category 4: Cash Traps (needs recoveryMap)
    if (extras?.recoveryMap) {
      const recovery = extras.recoveryMap.get(r.group_key)
      if (recovery && recovery.recovery_rounds !== null && recovery.recovery_rounds > 2 && r.revenue > 1000) {
        const key = `cash_trap::${r.group_key}`
        if (!dismissedKeys.has(key)) {
          const lockedCapital = r.revenue * (recovery.recovery_rounds - 1)
          const days = recovery.cash_cycle_days ?? 0
          insights.push({
            id: key,
            category: 'cash_trap',
            title: `${fmt(lockedCapital)} locked up in ${r.group_name}`,
            description: `This SKU needs ${recovery.recovery_rounds} selling cycles to recover your investment. Cash is locked for ~${days} days per sale.`,
            metrics: {
              'Recovery Rounds': `${recovery.recovery_rounds}`,
              'Cycle Days': `${days}`,
              'Revenue': fmt(r.revenue),
            },
            actions: ['Raise selling price', 'Negotiate lower COGS', 'Reduce returns'],
            impact: lockedCapital,
          })
        }
      }
    }

    // Category 6: Return Pattern Alerts (RTO vs RVP)
    if (extras?.recoveryMap) {
      const recovery = extras.recoveryMap.get(r.group_key)
      if (recovery) {
        // RTO alert: > 30%
        if (recovery.rto_rate > 0.30) {
          const key = `return_pattern::rto::${r.group_key}`
          if (!dismissedKeys.has(key)) {
            insights.push({
              id: key,
              category: 'return_pattern',
              title: `${r.group_name} has ${Math.round(recovery.rto_rate * 100)}% RTO rate`,
              description: `${Math.round(recovery.rto_rate * 100)}% of orders couldn't be delivered. Check serviceability and address validation.`,
              metrics: {
                'RTO Rate': `${Math.round(recovery.rto_rate * 100)}%`,
                'Orders': `${r.gross_orders}`,
              },
              actions: ['Check delivery coverage', 'Restrict COD for this SKU', 'Validate addresses'],
              impact: r.revenue * recovery.rto_rate,
            })
          }
        }

        // RVP alert: > 15%
        if (recovery.rvp_rate > 0.15) {
          const key = `return_pattern::rvp::${r.group_key}`
          if (!dismissedKeys.has(key)) {
            const topReason = recovery.top_return_reasons[0]
            const desc = topReason
              ? `${Math.round(recovery.rvp_rate * 100)}% of delivered orders were returned by customers. Top reason: ${topReason.reason} (${topReason.pct}%). Check listing accuracy.`
              : `${Math.round(recovery.rvp_rate * 100)}% of delivered orders were returned by customers. Review product quality and listing.`
            insights.push({
              id: key,
              category: 'return_pattern',
              title: `${r.group_name} has ${Math.round(recovery.rvp_rate * 100)}% customer return rate`,
              description: desc,
              metrics: {
                'RVP Rate': `${Math.round(recovery.rvp_rate * 100)}%`,
                'Orders': `${r.gross_orders}`,
                ...(topReason ? { 'Top Reason': topReason.reason } : {}),
              },
              actions: ['Update product images', 'Fix listing description', 'Check supplier quality'],
              impact: r.revenue * recovery.rvp_rate,
            })
          }
        }
      }
    }
  }

  // Category 5: Break-Even Alert (one per call, not per row)
  if (extras?.overheadsTotal && extras.overheadsTotal > 0 && extras.contributionMargin !== undefined) {
    if (extras.contributionMargin < extras.overheadsTotal) {
      const key = 'break_even::monthly'
      if (!dismissedKeys.has(key)) {
        const shortfall = extras.overheadsTotal - extras.contributionMargin
        const totalOrders = rows.reduce((sum, r) => sum + r.net_orders, 0)
        const totalProfit = rows.reduce((sum, r) => sum + (r.true_profit ?? 0), 0)
        const avgMarginPerOrder = totalOrders > 0 ? totalProfit / totalOrders : 0
        const extraOrders = avgMarginPerOrder > 0 ? Math.ceil(shortfall / avgMarginPerOrder) : 0

        insights.push({
          id: key,
          category: 'break_even',
          title: `${fmt(shortfall)} short of break-even this month`,
          description: `Your contribution margin (${fmt(extras.contributionMargin)}) doesn't cover monthly overheads (${fmt(extras.overheadsTotal)}). ${extraOrders > 0 ? `You need ${extraOrders} more orders at current margins.` : 'Increase margins or reduce overheads.'}`,
          metrics: {
            'Shortfall': fmt(shortfall),
            'Overheads': fmt(extras.overheadsTotal),
            'Margin': fmt(extras.contributionMargin),
          },
          actions: ['Review overhead costs', 'Focus on high-margin SKUs', 'Increase order volume'],
          impact: shortfall,
        })
      }
    }
  }

  // Sort by impact descending
  insights.sort((a, b) => b.impact - a.impact)
  return insights
}
