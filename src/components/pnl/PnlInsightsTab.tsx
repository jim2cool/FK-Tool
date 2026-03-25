'use client'

import { CheckCircle2 } from 'lucide-react'
import type { PnlInsight } from '@/lib/pnl/insights'
import { InsightCard } from './InsightCard'

interface Props {
  insights: PnlInsight[]
  onDismiss: (key: string) => void
  dismissingKey: string | null
}

export function PnlInsightsTab({ insights, onDismiss, dismissingKey }: Props) {
  if (insights.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
        <h3 className="text-lg font-semibold">No actionable insights right now</h3>
        <p className="text-sm text-muted-foreground mt-1">Your P&L looks healthy!</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {insights.map((insight) => (
        <InsightCard
          key={insight.id}
          insight={insight}
          onDismiss={onDismiss}
          dismissing={dismissingKey === insight.id}
        />
      ))}
    </div>
  )
}
