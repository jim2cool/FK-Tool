'use client'

import type { WaterfallData, TopBottomSku } from '@/lib/pnl/waterfall'
import WaterfallChart from './WaterfallChart'

interface Props {
  waterfall: WaterfallData
  topProfitable: TopBottomSku[]
  topLosing: TopBottomSku[]
  highReturn: TopBottomSku[]
  onSwitchTab: (tab: string) => void
  overheadsTotal: number
  operatingProfit: number
  breakEvenPct: number
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

export default function PnlOverviewTab({
  waterfall,
  topProfitable,
  topLosing,
  highReturn,
  onSwitchTab,
  overheadsTotal,
  operatingProfit,
  breakEvenPct,
}: Props) {
  const allEmpty =
    topProfitable.length === 0 &&
    topLosing.length === 0 &&
    highReturn.length === 0

  return (
    <div className="space-y-6">
      {/* Waterfall Chart */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">
          Revenue to Profit Flow
        </h3>
        <WaterfallChart data={waterfall} />
      </div>

      {/* Break-even indicator — only show when overheads are configured */}
      {overheadsTotal > 0 && (
        <div className="rounded-lg border bg-card p-4">
          {operatingProfit >= 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-green-700">
                Operating Profit: {fmt(operatingProfit)}
              </span>
              <span className="text-xs text-muted-foreground">
                ({breakEvenPct.toFixed(1)}% of overheads covered)
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-red-700">
                  {fmt(Math.abs(operatingProfit))} short of break-even
                </span>
                <span className="text-xs text-muted-foreground">
                  ({breakEvenPct.toFixed(1)}% of overheads covered)
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-amber-100">
                <div
                  className="h-2 rounded-full bg-amber-500 transition-all"
                  style={{ width: `${Math.min(Math.max(breakEvenPct, 0), 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Insight Cards */}
      {allEmpty ? (
        <p className="text-center text-muted-foreground py-8">
          Import more data to see insights.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Top Profitable */}
          <div className="rounded-lg border border-green-200 bg-card p-4">
            <h3 className="text-sm font-semibold text-green-700 mb-3">
              Top Profitable
            </h3>
            <div className="space-y-2">
              {topProfitable.length === 0 ? (
                <p className="text-xs text-muted-foreground">No profitable SKUs yet</p>
              ) : (
                topProfitable.map((sku) => (
                  <div
                    key={sku.group_key}
                    className="flex items-center justify-between cursor-pointer rounded px-2 py-1.5 hover:bg-green-50 transition-colors"
                    onClick={() => onSwitchTab('products')}
                  >
                    <span className="text-sm truncate mr-2">{sku.name}</span>
                    <div className="text-right shrink-0">
                      <span className="text-sm font-medium text-green-700">
                        {fmt(sku.profit ?? 0)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">
                        ({(sku.margin ?? 0).toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Losing Money */}
          <div className="rounded-lg border border-red-200 bg-card p-4">
            <h3 className="text-sm font-semibold text-red-700 mb-3">
              Losing Money
            </h3>
            <div className="space-y-2">
              {topLosing.length === 0 ? (
                <p className="text-xs text-muted-foreground">No loss-making SKUs</p>
              ) : (
                topLosing.map((sku) => (
                  <div
                    key={sku.group_key}
                    className="flex items-center justify-between cursor-pointer rounded px-2 py-1.5 hover:bg-red-50 transition-colors"
                    onClick={() => onSwitchTab('products')}
                  >
                    <span className="text-sm truncate mr-2">{sku.name}</span>
                    <div className="text-right shrink-0">
                      <span className="text-sm font-medium text-red-700">
                        -{fmt(sku.loss ?? 0)}
                      </span>
                      {sku.driver && (
                        <p className="text-xs text-muted-foreground">
                          {sku.driver}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Highest Returns */}
          <div className="rounded-lg border border-orange-200 bg-card p-4">
            <h3 className="text-sm font-semibold text-orange-700 mb-3">
              Highest Returns
            </h3>
            <div className="space-y-2">
              {highReturn.length === 0 ? (
                <p className="text-xs text-muted-foreground">No return data yet</p>
              ) : (
                highReturn.map((sku) => (
                  <div
                    key={sku.group_key}
                    className="flex items-center justify-between cursor-pointer rounded px-2 py-1.5 hover:bg-orange-50 transition-colors"
                    onClick={() => onSwitchTab('products')}
                  >
                    <span className="text-sm truncate mr-2">{sku.name}</span>
                    <span className="text-sm font-medium text-orange-700 shrink-0">
                      {((sku.return_rate ?? 0) * 100).toFixed(1)}%
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
