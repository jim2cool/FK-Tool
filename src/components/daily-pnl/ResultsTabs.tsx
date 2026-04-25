'use client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Download, AlertTriangle } from 'lucide-react'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import type { ResultsResponse } from '@/lib/daily-pnl/types'

function inr(n: number | null | undefined, dec = 0) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: dec }).format(n)
}

function pct(n: number | null | undefined) {
  if (n == null) return '—'
  return (n * 100).toFixed(1) + '%'
}

function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))].join('\n')
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: filename })
  a.click()
}

export function ResultsTabs({ data, from, to }: { data: ResultsResponse; from: string; to: string }) {
  const totalPnl   = data.consolidated.reduce((s, r) => s + (r.total_est_pnl ?? 0), 0)
  const totalUnits = data.consolidated.reduce((s, r) => s + r.quantity, 0)
  const wtMargin   = data.consolidated.reduce((s, r) =>
    r.avg_bank_settlement ? s + ((r.est_pnl_per_unit ?? 0) / r.avg_bank_settlement) * r.quantity : s, 0)
  const avgMarginPct = totalUnits > 0 ? (wtMargin / totalUnits) * 100 : 0

  return (
    <div className="space-y-4">
      {/* Validation warnings */}
      {data.unmapped_skus.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {data.unmapped_skus.length} SKU(s) in Orders not found in COGS — Master Product will show as unmapped.
        </div>
      )}
      {data.missing_listing_skus.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {data.missing_listing_skus.length} SKU(s) in Orders not found in Listing — prices will show as —.
        </div>
      )}

      {/* Headline KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Total Est. P&L</p>
          <p className={`text-2xl font-bold ${totalPnl >= 0 ? 'text-green-700' : 'text-red-600'}`}>{inr(totalPnl)}</p>
          <p className="text-xs text-muted-foreground">{from} → {to}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Units Dispatched</p>
          <p className="text-2xl font-bold">{totalUnits.toLocaleString('en-IN')}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Avg Margin %</p>
          <p className={`text-2xl font-bold ${avgMarginPct >= 0 ? 'text-green-700' : 'text-red-600'}`}>{avgMarginPct.toFixed(1)}%</p>
          <p className="text-xs text-muted-foreground">of bank settlement</p>
        </div>
      </div>

      <Tabs defaultValue="consolidated">
        <TabsList>
          <TabsTrigger value="consolidated">Consolidated P&L</TabsTrigger>
          <TabsTrigger value="order_detail">Order Detail ({data.order_detail.length})</TabsTrigger>
          <TabsTrigger value="return_costs">Return Costs</TabsTrigger>
        </TabsList>

        {/* ── Consolidated P&L ── */}
        <TabsContent value="consolidated">
          <div className="flex justify-end mb-2">
            <Button size="sm" variant="outline" onClick={() => downloadCsv(data.consolidated as unknown as Record<string, unknown>[], `consolidated-${from}-${to}.csv`)}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
          </div>
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Master Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">
                    Avg Settlement <InfoTooltip content="Weighted average Bank Settlement across all dispatched SKUs of this master product." />
                  </TableHead>
                  <TableHead className="text-right">
                    COGS/Unit <InfoTooltip content="Cost of Goods Sold per unit from your COGS mapping file." />
                  </TableHead>
                  <TableHead className="text-right">
                    Delivery Rate <InfoTooltip content="% of dispatched units actually delivered. Derived from 60–90 days of P&L History. Products with no history use the portfolio average." />
                  </TableHead>
                  <TableHead className="text-right">
                    Est. Rev/Unit <InfoTooltip content="Delivery Rate × Avg Bank Settlement. Only delivered units generate revenue." />
                  </TableHead>
                  <TableHead className="text-right">
                    Est. P&L/Unit <InfoTooltip content="Est. Revenue/Unit − (Delivery Rate × COGS/Unit) − Est. Return Cost/Unit" />
                  </TableHead>
                  <TableHead className="text-right">Total Est. P&L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.consolidated.map((row, i) => (
                  <TableRow key={i} className={(row.total_est_pnl ?? 0) < 0 ? 'bg-red-50' : ''}>
                    <TableCell className="font-medium">
                      {row.master_product}
                      {row.low_confidence && <Badge variant="outline" className="ml-2 text-xs text-amber-600 border-amber-300">low confidence</Badge>}
                    </TableCell>
                    <TableCell className="text-right">{row.quantity}</TableCell>
                    <TableCell className="text-right">{inr(row.avg_bank_settlement)}</TableCell>
                    <TableCell className="text-right">{inr(row.cogs_per_unit)}</TableCell>
                    <TableCell className="text-right">
                      {pct(row.delivery_rate)}
                      {row.delivery_rate != null && row.delivery_rate < 0.3 && <Badge className="ml-1 bg-red-100 text-red-700 border-0 text-xs">high risk</Badge>}
                    </TableCell>
                    <TableCell className="text-right">{inr(row.est_revenue_per_unit)}</TableCell>
                    <TableCell className={`text-right font-medium ${(row.est_pnl_per_unit ?? 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>{inr(row.est_pnl_per_unit)}</TableCell>
                    <TableCell className={`text-right font-bold ${(row.total_est_pnl ?? 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>{inr(row.total_est_pnl)}</TableCell>
                  </TableRow>
                ))}
                {data.consolidated.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No dispatched orders found in this date range</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── Order Detail ── */}
        <TabsContent value="order_detail">
          <div className="flex justify-end mb-2">
            <Button size="sm" variant="outline" onClick={() => downloadCsv(data.order_detail as unknown as Record<string, unknown>[], `order-detail-${from}-${to}.csv`)}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
          </div>
          <div className="border rounded-lg overflow-auto max-h-[520px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order Item ID</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Master Product</TableHead>
                  <TableHead>Dispatched</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Bank Settlement</TableHead>
                  <TableHead className="text-right">COGS/Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.order_detail.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{row.order_item_id}</TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate">{row.sku}</TableCell>
                    <TableCell>{row.master_product ?? <span className="text-amber-600 text-xs">unmapped</span>}</TableCell>
                    <TableCell className="text-xs">{row.dispatched_date}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{row.order_item_status}</Badge></TableCell>
                    <TableCell className="text-right">{row.quantity}</TableCell>
                    <TableCell className="text-right">{inr(row.bank_settlement)}</TableCell>
                    <TableCell className="text-right">{inr(row.cogs_per_unit)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── Return Costs ── */}
        <TabsContent value="return_costs">
          <div className="flex justify-end mb-2">
            <Button size="sm" variant="outline" onClick={() => downloadCsv(data.return_costs as unknown as Record<string, unknown>[], `return-costs.csv`)}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
          </div>
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Master Product</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Cancelled</TableHead>
                  <TableHead className="text-right">RTO</TableHead>
                  <TableHead className="text-right">RVP</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">
                    Delivery Rate <InfoTooltip content="Delivered ÷ Dispatched (Gross − Cancelled)" />
                  </TableHead>
                  <TableHead className="text-right">
                    Avg RVP Cost/Unit <InfoTooltip content="Total RVP fees ÷ RVP units" />
                  </TableHead>
                  <TableHead className="text-right">
                    Est. Return Cost/Unit <InfoTooltip content="(Total RVP fees + Total RTO fees) ÷ Dispatched units" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.return_costs.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{row.master_product}</TableCell>
                    <TableCell className="text-right">{row.gross_units}</TableCell>
                    <TableCell className="text-right">{row.cancelled_units}</TableCell>
                    <TableCell className="text-right">{row.rto_units}</TableCell>
                    <TableCell className="text-right">{row.rvp_units}</TableCell>
                    <TableCell className="text-right">{row.delivered_units}</TableCell>
                    <TableCell className={`text-right ${row.delivery_rate < 0.3 ? 'text-red-600 font-medium' : ''}`}>{pct(row.delivery_rate)}</TableCell>
                    <TableCell className="text-right">{inr(row.avg_rvp_cost_per_unit)}</TableCell>
                    <TableCell className="text-right">{inr(row.est_return_cost_per_dispatched_unit)}</TableCell>
                  </TableRow>
                ))}
                {data.return_costs.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Upload P&L History to see return cost analysis</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
