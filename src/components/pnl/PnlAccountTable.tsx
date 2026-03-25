'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { PnlBreakdown } from '@/lib/pnl/calculate'

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function pct(n: number) {
  return `${n.toFixed(1)}%`
}

type SortKey =
  | 'group_name'
  | 'gross_orders'
  | 'return_rate'
  | 'net_orders'
  | 'revenue'
  | 'total_cogs'
  | 'platform_fees'
  | 'logistics_fees'
  | 'true_profit'
  | 'margin_pct'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'group_name', label: 'Account' },
  { key: 'gross_orders', label: 'Gross Orders' },
  { key: 'return_rate', label: 'Return Rate' },
  { key: 'net_orders', label: 'Net Orders' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'total_cogs', label: 'COGS' },
  { key: 'platform_fees', label: 'Platform Fees' },
  { key: 'logistics_fees', label: 'Logistics' },
  { key: 'true_profit', label: 'True Profit' },
  { key: 'margin_pct', label: 'Margin %' },
]

const FEE_LABELS: { key: keyof PnlBreakdown['fee_details']; label: string }[] = [
  { key: 'commission_fee', label: 'Commission Fee' },
  { key: 'collection_fee', label: 'Collection Fee' },
  { key: 'fixed_fee', label: 'Fixed Fee' },
  { key: 'pick_pack_fee', label: 'Pick & Pack Fee' },
  { key: 'forward_shipping_fee', label: 'Forward Shipping' },
  { key: 'reverse_shipping_fee', label: 'Reverse Shipping' },
  { key: 'offer_adjustments', label: 'Offer Adjustments' },
  { key: 'tax_gst', label: 'GST' },
  { key: 'tax_tcs', label: 'TCS' },
  { key: 'tax_tds', label: 'TDS' },
  { key: 'rewards', label: 'Rewards' },
  { key: 'spf_payout', label: 'SPF Payout' },
  { key: 'seller_offer_burn', label: 'Seller Offer Burn' },
]

function marginColor(m: number | null): string {
  if (m === null) return ''
  if (m > 20) return 'text-green-600'
  if (m >= 0) return 'text-yellow-600'
  return 'text-red-600'
}

function sortValue(row: PnlBreakdown, key: SortKey): number | string {
  switch (key) {
    case 'group_name':
      return row.group_name.toLowerCase()
    case 'total_cogs':
      return row.total_cogs ?? -Infinity
    case 'true_profit':
      return row.true_profit ?? -Infinity
    case 'margin_pct':
      return row.margin_pct ?? -Infinity
    default:
      return row[key] as number
  }
}

export function PnlAccountTable({ rows }: { rows: PnlBreakdown[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  function toggleRow(key: string) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const sorted = [...rows].sort((a, b) => {
    const av = sortValue(a, sortKey)
    const bv = sortValue(b, sortKey)
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    }
    const diff = (av as number) - (bv as number)
    return sortDir === 'asc' ? diff : -diff
  })

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="w-8 px-2 py-2" />
            {COLUMNS.map(col => (
              <th
                key={col.key}
                className="px-3 py-2 font-medium cursor-pointer hover:text-foreground select-none whitespace-nowrap"
                onClick={() => handleSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key && (
                    <span className="text-xs">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => {
            const expanded = expandedRows.has(row.group_key)
            return (
              <>
                <tr
                  key={row.group_key}
                  className="border-b hover:bg-muted/50 cursor-pointer"
                  onClick={() => toggleRow(row.group_key)}
                >
                  <td className="px-2 py-2">
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {row.group_name}
                      {row.anomaly_count > 0 && (
                        <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                          {row.anomaly_count}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{row.gross_orders}</td>
                  <td className="px-3 py-2 tabular-nums">{pct(row.return_rate * 100)}</td>
                  <td className="px-3 py-2 tabular-nums">{row.net_orders}</td>
                  <td className="px-3 py-2 tabular-nums">{fmt(row.revenue)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.total_cogs !== null ? fmt(row.total_cogs) : (
                      <span className="text-muted-foreground italic">COGS N/A</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmt(Math.abs(row.platform_fees))}</td>
                  <td className="px-3 py-2 tabular-nums">{fmt(Math.abs(row.logistics_fees))}</td>
                  <td className={`px-3 py-2 tabular-nums font-medium ${marginColor(row.margin_pct)}`}>
                    {row.true_profit !== null ? fmt(row.true_profit) : (
                      <span className="text-muted-foreground italic">N/A</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${marginColor(row.margin_pct)}`}>
                    {row.margin_pct !== null ? pct(row.margin_pct) : '—'}
                  </td>
                </tr>

                {expanded && (
                  <tr key={`${row.group_key}-expanded`} className="border-b bg-muted/30">
                    <td colSpan={COLUMNS.length + 1} className="px-6 py-4">
                      <div className="max-w-md">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                          Fee Breakdown (signed values)
                        </h4>
                        <table className="w-full text-sm">
                          <tbody>
                            {FEE_LABELS.map(({ key, label }) => (
                              <tr key={key} className="border-b border-muted">
                                <td className="py-1 text-muted-foreground">{label}</td>
                                <td className="py-1 text-right tabular-nums">
                                  {fmt(row.fee_details[key])}
                                </td>
                              </tr>
                            ))}
                            <tr className="font-medium">
                              <td className="py-1.5">FK Net Earnings</td>
                              <td className="py-1.5 text-right tabular-nums">
                                {fmt(row.fk_net_earnings)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <div className="mt-4 flex gap-6 text-xs text-muted-foreground">
                        <span>Projected Settlement: {fmt(row.projected_settlement)}</span>
                        <span>Settled: {fmt(row.amount_settled)}</span>
                        <span>Pending: {fmt(row.amount_pending)}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            )
          })}

          {sorted.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                No account data for the selected period.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
