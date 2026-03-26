'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import type { PnlBreakdown } from '@/lib/pnl/calculate'
import type { RecoveryMetrics } from '@/lib/pnl/recovery'

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
  | 'expected_profit_per_dispatch'
  | 'recovery_rounds'
  | 'cash_cycle_days'

const COLUMNS: { key: SortKey; label: string; tooltip?: string; productOnly?: boolean }[] = [
  { key: 'group_name', label: 'Product Name' },
  { key: 'gross_orders', label: 'Gross Orders', tooltip: 'Total orders placed (before returns and cancellations)' },
  { key: 'return_rate', label: 'Return Rate', tooltip: 'Percentage of orders that were returned (RTO + RVP). Below 30% is normal, above 40% is concerning' },
  { key: 'net_orders', label: 'Net Orders', tooltip: 'Orders that were actually delivered and kept by customers' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'total_cogs', label: 'COGS' },
  { key: 'platform_fees', label: 'Platform Fees' },
  { key: 'logistics_fees', label: 'Logistics' },
  { key: 'true_profit', label: 'Contribution' },
  { key: 'margin_pct', label: 'Margin %' },
  {
    key: 'expected_profit_per_dispatch',
    label: 'Exp. Profit/Dispatch',
    tooltip:
      'Expected profit each time you dispatch one unit, accounting for the probability of returns',
    productOnly: true,
  },
  {
    key: 'recovery_rounds',
    label: 'Recovery Rounds',
    tooltip:
      'How many times you need to sell this product to recover your total investment. Below 2 is healthy',
    productOnly: true,
  },
  {
    key: 'cash_cycle_days',
    label: 'Cash Cycle',
    tooltip:
      'Average days from order to settlement, adjusted for return rate. Shows how long your capital is locked up.',
    productOnly: true,
  },
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

function recoveryRoundsColor(rr: number): string {
  if (rr < 1) return 'text-green-600'
  if (rr <= 2) return 'text-yellow-600'
  if (rr <= 3) return 'text-orange-500'
  return 'text-red-600'
}

const VERDICT_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  star:      { bg: 'bg-green-100',  text: 'text-green-800',  label: 'Star' },
  healthy:   { bg: 'bg-green-50',   text: 'text-green-700',  label: 'Healthy' },
  watch:     { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Watch' },
  reduce:    { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Reduce' },
  stop:      { bg: 'bg-red-100',    text: 'text-red-800',    label: 'Stop' },
  cash_trap: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Cash Trap' },
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const style = VERDICT_STYLES[verdict]
  if (!style) return null
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  )
}

function sortValue(row: PnlBreakdown, key: SortKey, recoveryMap?: Map<string, RecoveryMetrics>): number | string {
  switch (key) {
    case 'group_name':
      return row.group_name.toLowerCase()
    case 'total_cogs':
      return row.total_cogs ?? -Infinity
    case 'true_profit':
      return row.true_profit ?? -Infinity
    case 'margin_pct':
      return row.margin_pct ?? -Infinity
    case 'expected_profit_per_dispatch':
      return row.expected_profit_per_dispatch ?? -Infinity
    case 'recovery_rounds': {
      const rm = recoveryMap?.get(row.group_key)
      return rm?.recovery_rounds ?? -Infinity
    }
    case 'cash_cycle_days': {
      const rm = recoveryMap?.get(row.group_key)
      return rm?.cash_cycle_days ?? -Infinity
    }
    default:
      return row[key] as number
  }
}

type GroupBy = 'product' | 'channel' | 'account'

const GROUP_LABELS: Record<GroupBy, string> = {
  product: 'Product Name',
  channel: 'Channel',
  account: 'Account',
}

export function PnlProductTable({ productRows, channelRows, accountRows, recoveryMap }: {
  productRows: PnlBreakdown[]
  channelRows: PnlBreakdown[]
  accountRows: PnlBreakdown[]
  recoveryMap?: Map<string, RecoveryMetrics>
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>('product')
  const rows = groupBy === 'product' ? productRows : groupBy === 'channel' ? channelRows : accountRows
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const isProduct = groupBy === 'product'

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
    const av = sortValue(a, sortKey, recoveryMap)
    const bv = sortValue(b, sortKey, recoveryMap)
    if (typeof av === 'string' && typeof bv === 'string') {
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    }
    const diff = (av as number) - (bv as number)
    return sortDir === 'asc' ? diff : -diff
  })

  // Override first column label based on groupBy, filter product-only columns
  const displayColumns = COLUMNS.map((col, i) =>
    i === 0 ? { ...col, label: GROUP_LABELS[groupBy] } : col
  ).filter(col => {
    if (col.productOnly && !isProduct) return false
    return true
  })

  const colCount = displayColumns.length + 1 // +1 for expand chevron column

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Group by:</label>
        <select
          value={groupBy}
          onChange={e => { setGroupBy(e.target.value as GroupBy); setExpandedRows(new Set()) }}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
        >
          <option value="product">Product</option>
          <option value="channel">Channel</option>
          <option value="account">Account</option>
        </select>
      </div>
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="w-8 px-2 py-2" />
            {displayColumns.map(col => (
              <th
                key={col.key}
                className="px-3 py-2 font-medium cursor-pointer hover:text-foreground select-none whitespace-nowrap"
                onClick={() => handleSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {col.tooltip && <InfoTooltip content={col.tooltip} />}
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
            const recovery = isProduct ? recoveryMap?.get(row.group_key) : undefined
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
                      {isProduct && recovery && (
                        <VerdictBadge verdict={recovery.verdict} />
                      )}
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
                    {row.margin_pct !== null ? pct(row.margin_pct) : '\u2014'}
                  </td>
                  {isProduct && (
                    <>
                      <td className="px-3 py-2 tabular-nums">
                        {row.expected_profit_per_dispatch !== null
                          ? fmt(row.expected_profit_per_dispatch)
                          : '\u2014'}
                      </td>
                      <td className={`px-3 py-2 tabular-nums ${recovery?.recovery_rounds != null ? recoveryRoundsColor(recovery.recovery_rounds) : ''}`}>
                        {recovery?.recovery_rounds != null
                          ? recovery.recovery_rounds.toFixed(2)
                          : '\u2014'}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {recovery?.cash_cycle_days != null
                          ? `${Math.round(recovery.cash_cycle_days)} days`
                          : '\u2014'}
                      </td>
                    </>
                  )}
                </tr>

                {expanded && (
                  <tr key={`${row.group_key}-expanded`} className="border-b bg-muted/30">
                    <td colSpan={colCount} className="px-6 py-4">
                      <div className="grid grid-cols-2 gap-8">
                        {/* Fee breakdown */}
                        <div>
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

                        {/* COGS breakdown */}
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                            COGS Breakdown
                          </h4>
                          {row.cogs_breakdown ? (
                            <table className="w-full text-sm">
                              <tbody>
                                <tr className="border-b border-muted">
                                  <td className="py-1 text-muted-foreground">Purchase COGS/unit</td>
                                  <td className="py-1 text-right tabular-nums">
                                    {fmt(row.cogs_breakdown.purchase_cogs_per_unit)}
                                  </td>
                                </tr>
                                <tr className="border-b border-muted">
                                  <td className="py-1 text-muted-foreground">Dispatch COGS/unit</td>
                                  <td className="py-1 text-right tabular-nums">
                                    {fmt(row.cogs_breakdown.dispatch_cogs_per_unit)}
                                  </td>
                                </tr>
                                <tr className="border-b border-muted">
                                  <td className="py-1 text-muted-foreground">
                                    Shrinkage/unit ({pct(row.cogs_breakdown.shrinkage_rate * 100)})
                                  </td>
                                  <td className="py-1 text-right tabular-nums">
                                    {fmt(row.cogs_breakdown.shrinkage_per_unit)}
                                  </td>
                                </tr>
                                <tr className="font-medium">
                                  <td className="py-1.5">Full COGS/unit</td>
                                  <td className="py-1.5 text-right tabular-nums">
                                    {fmt(row.cogs_breakdown.full_cogs_per_unit)}
                                  </td>
                                </tr>
                                <tr className="border-t border-muted">
                                  <td className="py-1 text-muted-foreground">
                                    Total COGS ({row.net_orders} units)
                                  </td>
                                  <td className="py-1 text-right tabular-nums font-medium">
                                    {row.total_cogs !== null ? fmt(row.total_cogs) : '\u2014'}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">
                              COGS data not available for this product. Set up purchases and packaging in the COGS page.
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Returns Analysis — only for product grouping with recovery data */}
                      {isProduct && recovery && (
                        <div className="mt-6">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                            Returns Analysis
                          </h4>
                          <div className="grid grid-cols-2 gap-8">
                            <div>
                              <table className="w-full text-sm">
                                <tbody>
                                  <tr className="border-b border-muted">
                                    <td className="py-1 text-muted-foreground">RTO (Logistics Returns)<InfoTooltip content="Return to Origin — orders that couldn't be delivered (wrong address, customer unavailable, refused)" /></td>
                                    <td className="py-1 text-right tabular-nums">
                                      {pct(recovery.rto_rate * 100)}
                                    </td>
                                    <td className="py-1 text-right tabular-nums text-muted-foreground text-xs pl-3">
                                      {recovery.avg_rto_return_days != null
                                        ? `Avg ${Math.round(recovery.avg_rto_return_days)} days`
                                        : ''}
                                    </td>
                                  </tr>
                                  <tr className="border-b border-muted">
                                    <td className="py-1 text-muted-foreground">RVP (Customer Returns)<InfoTooltip content="Customer Returns — orders the customer received but sent back (didn't like it, wrong product, quality issue)" /></td>
                                    <td className="py-1 text-right tabular-nums">
                                      {pct(recovery.rvp_rate * 100)}
                                    </td>
                                    <td className="py-1 text-right tabular-nums text-muted-foreground text-xs pl-3">
                                      {recovery.avg_rvp_return_days != null
                                        ? `Avg ${Math.round(recovery.avg_rvp_return_days)} days`
                                        : ''}
                                    </td>
                                  </tr>
                                  <tr className="border-b border-muted">
                                    <td className="py-1 text-muted-foreground">Cancellations</td>
                                    <td className="py-1 text-right tabular-nums">
                                      {pct(recovery.cancel_rate * 100)}
                                    </td>
                                    <td className="py-1" />
                                  </tr>
                                  <tr className="font-medium">
                                    <td className="py-1.5">Total Return Cost</td>
                                    <td className="py-1.5 text-right tabular-nums text-red-600">
                                      {fmt(recovery.total_return_cost)}
                                    </td>
                                    <td className="py-1" />
                                  </tr>
                                </tbody>
                              </table>
                            </div>

                            <div>
                              {recovery.top_return_reasons.length > 0 ? (
                                <>
                                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Top Return Reasons</p>
                                  <table className="w-full text-sm">
                                    <tbody>
                                      {recovery.top_return_reasons.map((r, i) => (
                                        <tr key={i} className="border-b border-muted">
                                          <td className="py-1 text-muted-foreground w-5">{i + 1}.</td>
                                          <td className="py-1">{r.reason}</td>
                                          <td className="py-1 text-right tabular-nums text-muted-foreground">
                                            {r.count} ({r.pct}%)
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </>
                              ) : (
                                <p className="text-sm text-muted-foreground italic">
                                  No return reason data available.
                                </p>
                              )}

                              {/* Recovery summary */}
                              <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                                {recovery.all_in_cost_per_unit != null && (
                                  <span>All-in cost/unit: {fmt(recovery.all_in_cost_per_unit)}</span>
                                )}
                                {recovery.net_settlement_per_unit != null && (
                                  <span>Net settlement/unit: {fmt(recovery.net_settlement_per_unit)}</span>
                                )}
                              </div>
                              {recovery.verdict_label && (
                                <div className="mt-2">
                                  <VerdictBadge verdict={recovery.verdict} />
                                  <span className="ml-2 text-xs text-muted-foreground">{recovery.verdict_label}</span>
                                  <InfoTooltip content="Auto-computed recommendation based on margin, return rate, and capital recovery speed" />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Settlement info */}
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
              <td colSpan={colCount} className="px-3 py-8 text-center text-muted-foreground">
                No product data for the selected period.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    </div>
  )
}
