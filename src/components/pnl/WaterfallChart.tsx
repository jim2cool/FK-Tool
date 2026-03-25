'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { WaterfallData } from '@/lib/pnl/waterfall'

interface Props {
  data: WaterfallData
}

interface WaterfallEntry {
  name: string
  base: number
  value: number
  color: string
  raw: number
}

function fmtCompact(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 100000) return `${sign}\u20B9${(abs / 100000).toFixed(1)}L`
  if (abs >= 1000) return `${sign}\u20B9${(abs / 1000).toFixed(1)}K`
  return `${sign}\u20B9${abs.toFixed(0)}`
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

function buildEntries(data: WaterfallData): WaterfallEntry[] {
  const GREEN = '#22c55e'
  const RED = '#ef4444'
  const AMBER = '#f59e0b'

  const entries: WaterfallEntry[] = []
  let running = 0

  // Revenue: starts at 0, goes up
  entries.push({
    name: 'Revenue',
    base: 0,
    value: data.revenue,
    color: GREEN,
    raw: data.revenue,
  })
  running = data.revenue

  // Deductions: each starts at running total, goes down
  const deductions: Array<{ name: string; amount: number; color: string }> = [
    { name: 'Platform Fees', amount: data.platform_fees, color: RED },
    { name: 'Seller Offers', amount: data.seller_offers, color: RED },
    { name: 'Logistics', amount: data.logistics, color: RED },
    { name: 'COGS', amount: data.cogs, color: RED },
    { name: 'GST', amount: data.gst, color: AMBER },
    { name: 'TCS+TDS', amount: data.tcs_tds, color: RED },
  ]

  for (const d of deductions) {
    if (d.amount === 0) continue
    running -= d.amount
    entries.push({
      name: d.name,
      base: running,
      value: d.amount,
      color: d.color,
      raw: -d.amount,
    })
  }

  // Benefits: goes up from running
  if (data.benefits > 0) {
    entries.push({
      name: 'Benefits',
      base: running,
      value: data.benefits,
      color: GREEN,
      raw: data.benefits,
    })
    running += data.benefits
  }

  // Contribution Margin: starts at 0
  entries.push({
    name: 'Contribution',
    base: data.true_profit >= 0 ? 0 : data.true_profit,
    value: Math.abs(data.true_profit),
    color: data.true_profit >= 0 ? GREEN : RED,
    raw: data.true_profit,
  })

  return entries
}

function CustomTooltip({
  active,
  payload,
  revenue,
}: {
  active?: boolean
  payload?: Array<{ payload: WaterfallEntry }>
  revenue: number
}) {
  if (!active || !payload?.[0]) return null
  const entry = payload[0].payload
  const pctOfRevenue =
    revenue > 0 ? ((Math.abs(entry.raw) / revenue) * 100).toFixed(1) : '0'

  return (
    <div className="rounded-md border bg-background px-3 py-2 shadow-md text-sm">
      <p className="font-medium">{entry.name}</p>
      <p>{fmt(entry.raw)}</p>
      <p className="text-muted-foreground">{pctOfRevenue}% of revenue</p>
    </div>
  )
}

export default function WaterfallChart({ data }: Props) {
  const entries = buildEntries(data)

  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart
        data={entries}
        margin={{ top: 10, right: 10, left: 10, bottom: 20 }}
      >
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11 }}
          angle={-30}
          textAnchor="end"
          height={60}
        />
        <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11 }} width={60} />
        <Tooltip
          content={<CustomTooltip revenue={data.revenue} />}
          cursor={{ fill: 'rgba(0,0,0,0.04)' }}
        />
        <Bar dataKey="base" stackId="waterfall" fill="transparent" isAnimationActive={false}>
          {entries.map((_, i) => (
            <Cell key={i} fill="transparent" />
          ))}
        </Bar>
        <Bar dataKey="value" stackId="waterfall" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {entries.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
