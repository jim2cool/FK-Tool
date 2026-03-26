'use client'

import { Fragment } from 'react'
import { InfoTooltip } from '@/components/ui/info-tooltip'

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function formatMonth(month: string): string {
  const [year, m] = month.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(m) - 1]} '${year.slice(2)}`
}

function marginColor(pct: number | null): string {
  if (pct === null) return 'text-muted-foreground'
  if (pct > 20) return 'text-green-600'
  if (pct >= 0) return 'text-yellow-600'
  return 'text-red-600'
}

interface ComparisonRow {
  group_key: string
  group_name: string
  revenue: number
  margin_pct: number | null
  return_rate: number
  net_orders: number
}

interface ComparisonMonth {
  month: string
  rows: ComparisonRow[]
}

interface Props {
  months: ComparisonMonth[]
}

type TrendResult = { label: string; color: string }

function computeTrend(first: ComparisonRow | undefined, last: ComparisonRow | undefined): TrendResult {
  if (!first || !last) return { label: '-- Stable', color: 'text-muted-foreground' }

  const marginFirst = first.margin_pct
  const marginLast = last.margin_pct
  const returnFirst = first.return_rate
  const returnLast = last.return_rate

  // Check return rate increase first (more alarming)
  if (returnLast - returnFirst > 0.05) {
    return { label: '!! Returns rising', color: 'text-orange-600' }
  }

  if (marginFirst !== null && marginLast !== null) {
    const delta = marginLast - marginFirst
    if (delta > 2) return { label: '^ Improving', color: 'text-green-600' }
    if (delta < -2) return { label: 'v Declining', color: 'text-red-600' }
  }

  return { label: '-- Stable', color: 'text-muted-foreground' }
}

export function PnlComparisonTable({ months }: Props) {
  if (months.length === 0) return null

  // Collect all unique SKUs across all months, keyed by group_key
  const skuMap = new Map<string, { group_key: string; group_name: string }>()
  // Track latest-month revenue for sorting
  const latestRevenue = new Map<string, number>()
  const lastMonth = months[months.length - 1]

  for (const m of months) {
    for (const r of m.rows) {
      if (!skuMap.has(r.group_key)) {
        skuMap.set(r.group_key, { group_key: r.group_key, group_name: r.group_name })
      }
    }
  }

  if (lastMonth) {
    for (const r of lastMonth.rows) {
      latestRevenue.set(r.group_key, r.revenue)
    }
  }

  // Sort SKUs by latest month revenue descending
  const skus = [...skuMap.values()].sort((a, b) => {
    return (latestRevenue.get(b.group_key) ?? 0) - (latestRevenue.get(a.group_key) ?? 0)
  })

  // Build lookup: month -> group_key -> row
  const lookup = new Map<string, Map<string, ComparisonRow>>()
  for (const m of months) {
    const rowMap = new Map<string, ComparisonRow>()
    for (const r of m.rows) {
      rowMap.set(r.group_key, r)
    }
    lookup.set(m.month, rowMap)
  }

  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left px-4 py-3 font-medium min-w-[200px]">Product</th>
            {months.map(m => (
              <th key={m.month} colSpan={3} className="text-center px-2 py-3 font-medium border-l">
                {formatMonth(m.month)}
              </th>
            ))}
            <th className="text-center px-4 py-3 font-medium border-l min-w-[140px]">
              Trend
              <InfoTooltip content="Compares your first and last month to show if metrics are improving or declining" />
            </th>
          </tr>
          <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
            <th className="px-4 py-1.5"></th>
            {months.map(m => (
              <Fragment key={m.month}>
                <th className="text-right px-2 py-1.5 border-l">Revenue</th>
                <th className="text-right px-2 py-1.5">Margin</th>
                <th className="text-right px-2 py-1.5">Returns</th>
              </Fragment>
            ))}
            <th className="px-4 py-1.5 border-l"></th>
          </tr>
        </thead>
        <tbody>
          {skus.map(sku => {
            const firstRow = lookup.get(months[0]?.month ?? '')?.get(sku.group_key)
            const lastRow = lookup.get(lastMonth?.month ?? '')?.get(sku.group_key)
            const trend = computeTrend(firstRow, lastRow)

            return (
              <tr key={sku.group_key} className="border-b hover:bg-muted/20">
                <td className="px-4 py-3 font-medium truncate max-w-[250px]" title={sku.group_name}>
                  {sku.group_name}
                </td>
                {months.map(m => {
                  const row = lookup.get(m.month)?.get(sku.group_key)
                  if (!row) {
                    return (
                      <Fragment key={m.month}>
                        <td className="text-right px-2 py-3 text-muted-foreground border-l">--</td>
                        <td className="text-right px-2 py-3 text-muted-foreground">--</td>
                        <td className="text-right px-2 py-3 text-muted-foreground">--</td>
                      </Fragment>
                    )
                  }
                  return (
                    <Fragment key={m.month}>
                      <td className="text-right px-2 py-3 border-l tabular-nums">{fmt(row.revenue)}</td>
                      <td className={`text-right px-2 py-3 tabular-nums font-medium ${marginColor(row.margin_pct)}`}>
                        {row.margin_pct !== null ? `${row.margin_pct.toFixed(1)}%` : '--'}
                      </td>
                      <td className="text-right px-2 py-3 tabular-nums">
                        {(row.return_rate * 100).toFixed(1)}%
                      </td>
                    </Fragment>
                  )
                })}
                <td className={`text-center px-4 py-3 font-medium text-sm ${trend.color}`}>
                  {trend.label}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
