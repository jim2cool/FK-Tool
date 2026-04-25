'use client'
import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Download, AlertTriangle, ChevronDown, ChevronUp, FunctionSquare } from 'lucide-react'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import type { ResultsResponse } from '@/lib/daily-pnl/types'

function inr(n: number | null | undefined, dec = 0) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: dec }).format(n)
}

function pct(n: number | null | undefined, dec = 1) {
  if (n == null) return '—'
  return (n * 100).toFixed(dec) + '%'
}

function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))].join('\n')
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: filename })
  a.click()
}

export function ResultsTabs({ data, from, to }: { data: ResultsResponse; from: string; to: string }) {
  const [showFormula, setShowFormula] = useState(false)

  // Revenue-weighted aggregates (matches the spec's Consolidated Report total row)
  const totalPnl       = data.consolidated.reduce((s, r) => s + (r.total_est_pnl ?? 0), 0)
  const totalUnits     = data.consolidated.reduce((s, r) => s + r.quantity, 0)
  const totalBankProj  = data.consolidated.reduce(
    (s, r) => s + ((r.avg_bank_settlement ?? 0) * r.quantity), 0)
  // Avg Margin % = Total P&L ÷ Total Projected Bank Settlement (revenue-weighted, matches spec)
  const avgMarginPct   = totalBankProj > 0 ? (totalPnl / totalBankProj) * 100 : 0

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

      {/* How is P&L calculated? — collapsible formula explainer */}
      <div className="rounded-lg border bg-muted/30">
        <button
          type="button"
          onClick={() => setShowFormula(s => !s)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          <span className="flex items-center gap-2">
            <FunctionSquare className="h-4 w-4 text-primary" />
            How is the estimated P&amp;L calculated?
          </span>
          {showFormula
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
        {showFormula && (
          <div className="px-4 pb-4 pt-1 text-sm space-y-3 border-t">
            <p className="text-muted-foreground">
              Flipkart only confirms actual P&amp;L 20–30 days after dispatch. We <span className="font-medium text-foreground">estimate</span> it now
              using each master product&apos;s historical delivery rate and return-fee burden.
            </p>

            <div className="bg-background rounded border p-3 font-mono text-xs space-y-1.5 leading-relaxed">
              <div><span className="text-blue-600 font-semibold">Est. Rev / Unit</span> = Delivery Rate × Avg Settlement</div>
              <div><span className="text-blue-600 font-semibold">Est. P&amp;L / Unit</span> = Est. Rev/Unit − (Delivery Rate × COGS/Unit) − Est. Return Cost/Unit</div>
              <div><span className="text-blue-600 font-semibold">Total Est. P&amp;L</span> = Qty × Est. P&amp;L/Unit</div>
              <div className="pt-1.5 mt-1 border-t border-dashed">
                <span className="text-blue-600 font-semibold">Est. P&amp;L %</span> = Total Est. P&amp;L ÷ Total Bank Settlement
              </div>
              <div>
                <span className="text-blue-600 font-semibold">Return on COGS</span> = Total Est. P&amp;L ÷ (Total COGS × Delivery Rate)
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Why DR × COGS?</span> Returns come back to inventory — you only economically consume COGS on delivered units.
              </div>
              <div>
                <span className="font-medium text-foreground">Why Return Cost is still subtracted?</span> The marketplace fees on RTO/RVP shipments are real cash losses, even when goods come back.
              </div>
              <div>
                <span className="font-medium text-foreground">Est. P&amp;L % vs Return on COGS:</span> P&amp;L % = profit per rupee of revenue. Return on COGS = profit per rupee of inventory you burn — better for comparing products with different delivery rates.
              </div>
              <div>
                <span className="font-medium text-foreground">Where the inputs come from:</span> Avg Settlement &amp; COGS → Order Detail tab. Delivery Rate &amp; Est. Return Cost → Return Costs tab.
              </div>
            </div>
          </div>
        )}
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
                    Avg Settlement <InfoTooltip content="Quantity-weighted Bank Settlement per unit. Pulled from your Listing upload — see Order Detail tab for the per-order values." />
                  </TableHead>
                  <TableHead className="text-right">
                    Delivery Rate <InfoTooltip content="% of dispatched units that actually get delivered. Pulled from your historical P&L — see Return Costs tab for the breakdown." />
                  </TableHead>
                  <TableHead className="text-right">
                    Est. Rev/Unit <InfoTooltip content="= Delivery Rate × Avg Settlement. Only delivered units generate revenue." />
                  </TableHead>
                  <TableHead className="text-right">
                    COGS/Unit <InfoTooltip content="Your inward cost per piece, from the COGS upload. Only delivered units economically consume this — see Order Detail tab for per-order COGS." />
                  </TableHead>
                  <TableHead className="text-right">
                    Est. Return Cost/Unit <InfoTooltip content="Marketplace fee burden from RTO + RVP returns, allocated per dispatched unit. Pulled from your historical P&L — see Return Costs tab for the per-product breakdown." />
                  </TableHead>
                  <TableHead className="text-right">
                    Est. P&L/Unit <InfoTooltip content="= Est. Rev/Unit − (Delivery Rate × COGS/Unit) − Est. Return Cost/Unit" />
                  </TableHead>
                  <TableHead className="text-right">
                    Total Est. P&L <InfoTooltip content="= Qty × Est. P&L/Unit" />
                  </TableHead>
                  <TableHead className="text-right">
                    Est. P&L % <InfoTooltip content="= Total Est. P&L ÷ Total Bank Settlement. Profit as a % of projected revenue." />
                  </TableHead>
                  <TableHead className="text-right">
                    Return on COGS <InfoTooltip content="= Total Est. P&L ÷ (Total COGS × Delivery Rate). Profit per rupee of COGS you actually consume on delivered units." />
                  </TableHead>
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
                    <TableCell className="text-right">
                      {pct(row.delivery_rate)}
                      {row.delivery_rate != null && row.delivery_rate < 0.3 && <Badge className="ml-1 bg-red-100 text-red-700 border-0 text-xs">high risk</Badge>}
                    </TableCell>
                    <TableCell className="text-right">{inr(row.est_revenue_per_unit)}</TableCell>
                    <TableCell className="text-right">{inr(row.cogs_per_unit)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{inr(row.est_return_cost_per_unit)}</TableCell>
                    <TableCell className={`text-right font-medium ${(row.est_pnl_per_unit ?? 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>{inr(row.est_pnl_per_unit)}</TableCell>
                    <TableCell className={`text-right font-bold ${(row.total_est_pnl ?? 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>{inr(row.total_est_pnl)}</TableCell>
                    <TableCell className={`text-right ${(row.est_pnl_pct ?? 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>{pct(row.est_pnl_pct)}</TableCell>
                    <TableCell className={`text-right ${(row.return_on_cogs ?? 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>{pct(row.return_on_cogs)}</TableCell>
                  </TableRow>
                ))}
                {data.consolidated.length === 0 && (
                  <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">No dispatched orders found in this date range</TableCell></TableRow>
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
                    Delivery Rate <InfoTooltip content="Delivered ÷ Dispatched, where Dispatched = Gross Units − Cancelled and Delivered = Dispatched − RTO − RVP. This is the same Delivery Rate used in the Consolidated P&L estimate." />
                  </TableHead>
                  <TableHead className="text-right">
                    Avg RVP Cost/Unit <InfoTooltip content="Total RVP fees ÷ RVP units. Average marketplace fee burden you pay per customer-return shipment (commission reversal + reverse shipping + return processing)." />
                  </TableHead>
                  <TableHead className="text-right">
                    Est. Return Cost/Unit <InfoTooltip content="(Total RVP fees + Total RTO fees) ÷ Total Dispatched Units. Spreads the full return-fee burden across every dispatched unit — this is the per-dispatched-unit deduction we apply in the Consolidated P&L formula." />
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
