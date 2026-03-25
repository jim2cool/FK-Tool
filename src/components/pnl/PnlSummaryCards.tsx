'use client'

import type { PnlSummary } from '@/lib/pnl/calculate'

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

export function PnlSummaryCards({ summary }: { summary: PnlSummary }) {
  const cards = [
    { label: 'Revenue', value: fmt(summary.total_revenue) },
    { label: 'COGS', value: fmt(summary.total_cogs) },
    { label: 'Platform Fees', value: fmt(Math.abs(summary.total_platform_fees)) },
    { label: 'Logistics', value: fmt(Math.abs(summary.total_logistics)) },
    {
      label: 'True Profit',
      value: fmt(summary.total_true_profit),
      color: summary.total_true_profit >= 0 ? 'text-green-700' : 'text-red-700',
    },
    {
      label: 'Margin %',
      value: `${summary.overall_margin_pct.toFixed(1)}%`,
      color: summary.overall_margin_pct >= 0 ? 'text-green-700' : 'text-red-700',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border bg-white p-4">
          <div className="text-xs text-muted-foreground">{card.label}</div>
          <div className={`text-lg font-semibold mt-1 tabular-nums ${card.color ?? ''}`}>
            {card.value}
          </div>
        </div>
      ))}
    </div>
  )
}
