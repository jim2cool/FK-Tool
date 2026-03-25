'use client'

import { X } from 'lucide-react'
import type { PnlInsight } from '@/lib/pnl/insights'

interface Props {
  insights: PnlInsight[]
  onDismiss: (key: string) => void
  onSwitchTab: (tab: string) => void
}

const categoryDotColor: Record<string, string> = {
  money_loser: 'bg-red-500',
  return_alert: 'bg-orange-500',
  fee_anomaly: 'bg-yellow-500',
  cash_trap: 'bg-purple-500',
  break_even: 'bg-red-500',
  return_pattern: 'bg-orange-500',
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function toActionLine(insight: PnlInsight): string {
  const m = insight.metrics
  switch (insight.category) {
    case 'money_loser': {
      const name = m['Driver'] ? String(m['Product'] || insight.title.split(' is ')[0]) : insight.title.split(' is ')[0]
      const amount = insight.impact
      return `Stop selling ${name} \u2014 lost ${fmt(amount)} last month`
    }
    case 'return_alert': {
      const name = insight.title.split(' has ')[0]
      const rate = m['Return Rate'] || ''
      return `Investigate returns on ${name} \u2014 ${rate} return rate`
    }
    case 'fee_anomaly': {
      const name = String(m['Product'] || '')
      const count = m['Anomalies'] || ''
      return `Review billing on ${name} \u2014 ${count} anomalies detected`
    }
    case 'cash_trap': {
      const amount = insight.impact
      const name = insight.title.split(' locked up in ')[1] || ''
      const rounds = m['Recovery Rounds'] || ''
      return `${fmt(amount)} locked in ${name} \u2014 ${rounds} cycles to recover`
    }
    case 'break_even': {
      const shortfall = insight.impact
      return `${fmt(shortfall)} short of covering overheads \u2014 review costs`
    }
    case 'return_pattern': {
      const name = insight.title.split(' has ')[0]
      const isRto = insight.id.includes('::rto::')
      const rateStr = isRto ? (insight.metrics['RTO Rate'] || '') : (insight.metrics['RVP Rate'] || '')
      return `Fix ${isRto ? 'RTO' : 'RVP'} issue on ${name} \u2014 ${rateStr} failure rate`
    }
    default:
      return insight.title
  }
}

export function ActionDashboard({ insights, onDismiss, onSwitchTab }: Props) {
  if (insights.length === 0) return null

  const top5 = insights.slice(0, 5)
  const hasMore = insights.length > 5

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">
          Actions for You ({insights.length} item{insights.length !== 1 ? 's' : ''})
        </h3>
        {hasMore && (
          <button
            className="text-xs text-primary hover:underline"
            onClick={() => onSwitchTab('insights')}
          >
            View all in Insights tab
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {top5.map((insight) => (
          <div
            key={insight.id}
            className="flex items-center gap-2 group text-sm"
          >
            <span className={`h-2 w-2 rounded-full shrink-0 ${categoryDotColor[insight.category] || 'bg-gray-400'}`} />
            <span className="text-muted-foreground flex-1 truncate">
              {toActionLine(insight)}
            </span>
            <button
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity shrink-0"
              onClick={() => onDismiss(insight.id)}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
