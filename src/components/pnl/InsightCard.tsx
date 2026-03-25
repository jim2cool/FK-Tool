'use client'

import { X, Loader2 } from 'lucide-react'
import type { PnlInsight } from '@/lib/pnl/insights'

interface Props {
  insight: PnlInsight
  onDismiss: (key: string) => void
  dismissing: boolean
}

const categoryConfig: Record<string, { border: string; badge: string; label: string }> = {
  money_loser: {
    border: 'border-l-4 border-l-red-500',
    badge: 'bg-red-100 text-red-700',
    label: 'Loss',
  },
  return_alert: {
    border: 'border-l-4 border-l-orange-500',
    badge: 'bg-orange-100 text-orange-700',
    label: 'Returns',
  },
  fee_anomaly: {
    border: 'border-l-4 border-l-yellow-500',
    badge: 'bg-yellow-100 text-yellow-700',
    label: 'Billing',
  },
  cash_trap: {
    border: 'border-l-4 border-l-purple-500',
    badge: 'bg-purple-100 text-purple-700',
    label: 'Cash Trap',
  },
  break_even: {
    border: 'border-l-4 border-l-red-500',
    badge: 'bg-red-100 text-red-700',
    label: 'Break-Even',
  },
  return_pattern: {
    border: 'border-l-4 border-l-orange-500',
    badge: 'bg-orange-100 text-orange-700',
    label: 'Return Pattern',
  },
}

export function InsightCard({ insight, onDismiss, dismissing }: Props) {
  const config = categoryConfig[insight.category]

  return (
    <div className={`relative rounded-lg border p-4 ${config.border}`}>
      {/* Dismiss button */}
      <button
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        onClick={() => onDismiss(insight.id)}
        disabled={dismissing}
        aria-label="Dismiss insight"
      >
        {dismissing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <X className="h-4 w-4" />
        )}
      </button>

      {/* Top row: badge + title */}
      <div className="flex items-start gap-2 pr-8">
        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${config.badge}`}>
          {config.label}
        </span>
        <span className="font-semibold text-sm">{insight.title}</span>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground mt-1">{insight.description}</p>

      {/* Metrics row */}
      <div className="flex gap-4 mt-3">
        {Object.entries(insight.metrics).map(([label, value]) => (
          <div key={label}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-sm font-medium">{value}</div>
          </div>
        ))}
      </div>

      {/* Actions row */}
      {insight.actions.length > 0 && (
        <div className="mt-3 flex gap-2 flex-wrap">
          {insight.actions.map((action) => (
            <span
              key={action}
              className="text-xs bg-muted px-2 py-1 rounded"
            >
              {action}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
