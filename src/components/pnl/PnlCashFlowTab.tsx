'use client'

import SettlementChart from './SettlementChart'
import { InfoTooltip } from '@/components/ui/info-tooltip'

interface Props {
  cashflow: {
    settled: number
    pending: number
    settlement_rate: number
    timeline: Array<{ date: string; settled: number; pending: number }>
    pending_orders: Array<{
      order_date: string
      platform_order_id: string
      sku_name: string
      revenue: number
      projected: number
      pending: number
      days_since: number
    }>
  }
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

export default function PnlCashFlowTab({ cashflow }: Props) {
  const displayOrders = cashflow.pending_orders.slice(0, 100)

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total Settled<InfoTooltip content="Amount Flipkart has actually paid into your bank account" /></p>
          <p className="text-2xl font-semibold text-green-600">
            {fmt(cashflow.settled)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total Pending<InfoTooltip content="Amount Flipkart still owes you — not yet deposited" /></p>
          <p className="text-2xl font-semibold text-orange-600">
            {fmt(cashflow.pending)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Settlement Rate<InfoTooltip content="Percentage of total expected payments that have been settled" /></p>
          <p className="text-2xl font-semibold">
            {cashflow.settlement_rate}%
          </p>
        </div>
      </div>

      {/* Settlement Chart */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">
          Settlement Timeline
        </h3>
        <SettlementChart timeline={cashflow.timeline} />
      </div>

      {/* Pending Orders Table */}
      {cashflow.pending_orders.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            All orders settled! No pending payments.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Pending Orders{' '}
            <span className="text-xs font-normal">
              ({cashflow.pending_orders.length})
            </span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Order Date</th>
                  <th className="pb-2 pr-3 font-medium">Order ID</th>
                  <th className="pb-2 pr-3 font-medium">SKU</th>
                  <th className="pb-2 pr-3 font-medium text-right">Revenue</th>
                  <th className="pb-2 pr-3 font-medium text-right">Projected</th>
                  <th className="pb-2 pr-3 font-medium text-right">Pending</th>
                  <th className="pb-2 font-medium text-right">Days</th>
                </tr>
              </thead>
              <tbody>
                {displayOrders.map((order, i) => (
                  <tr
                    key={`${order.platform_order_id}-${i}`}
                    className={`border-b last:border-0 ${
                      order.days_since > 14 ? 'bg-yellow-50' : ''
                    }`}
                  >
                    <td className="py-2 pr-3">
                      {new Date(order.order_date).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {order.platform_order_id}
                    </td>
                    <td className="py-2 pr-3 truncate max-w-[200px]">
                      {order.sku_name}
                    </td>
                    <td className="py-2 pr-3 text-right">{fmt(order.revenue)}</td>
                    <td className="py-2 pr-3 text-right">
                      {fmt(order.projected)}
                    </td>
                    <td className="py-2 pr-3 text-right text-orange-600 font-medium">
                      {fmt(order.pending)}
                    </td>
                    <td className="py-2 text-right">
                      <span
                        className={
                          order.days_since > 14
                            ? 'text-yellow-700 font-medium'
                            : ''
                        }
                      >
                        {order.days_since}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
