import type { PnlBreakdown } from './calculate'

export interface PnlInsight {
  id: string
  category: 'money_loser' | 'return_alert' | 'fee_anomaly'
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

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

export function generateInsights(
  rows: PnlBreakdown[],
  dismissedKeys: Set<string>,
  thresholds: InsightThresholds,
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
  }

  // Sort by impact descending
  insights.sort((a, b) => b.impact - a.impact)
  return insights
}
