'use client'

import * as React from 'react'
import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, Search, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { InfoTooltip } from '@/components/ui/info-tooltip'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrderFinancials {
  accounted_net_sales: number | null
  sale_amount: number | null
  seller_offer_burn: number | null
  commission_fee: number | null
  collection_fee: number | null
  fixed_fee: number | null
  pick_pack_fee: number | null
  forward_shipping_fee: number | null
  reverse_shipping_fee: number | null
  projected_settlement: number | null
  amount_settled: number | null
  amount_pending: number | null
}

interface Order {
  id: string
  platform_order_id: string
  order_item_id: string | null
  order_date: string
  status: string
  quantity: number
  sale_price: number
  final_selling_price: number | null
  channel: string | null
  fulfillment_type: string | null
  payment_mode: string | null
  gross_units: number | null
  net_units: number | null
  rto_units: number | null
  rvp_units: number | null
  cancelled_units: number | null
  dispatch_date: string | null
  delivery_date: string | null
  cancellation_date: string | null
  cancellation_reason: string | null
  return_request_date: string | null
  return_complete_date: string | null
  return_type: string | null
  return_status: string | null
  return_reason: string | null
  return_sub_reason: string | null
  settlement_date: string | null
  neft_id: string | null
  master_sku_id: string | null
  marketplace_account_id: string | null
  combo_product_id: string | null
  master_skus: { id: string; name: string } | null
  marketplace_accounts: { id: string; account_name: string; platform: string } | null
  order_financials: OrderFinancials[] | null
}

interface MarketplaceAccount {
  id: string
  account_name: string
  platform: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50
const STATUSES = ['pending', 'dispatched', 'delivered', 'returned', 'cancelled'] as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null) return '-'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '-'
  try {
    return new Date(d).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return d
  }
}

function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null
  const d1 = new Date(a)
  const d2 = new Date(b)
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24))
}

function statusBadge(status: string) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
    delivered:  { variant: 'default',     className: 'bg-green-600 hover:bg-green-700 text-white' },
    dispatched: { variant: 'default',     className: 'bg-blue-600 hover:bg-blue-700 text-white' },
    pending:    { variant: 'default',     className: 'bg-yellow-500 hover:bg-yellow-600 text-white' },
    returned:   { variant: 'destructive', className: '' },
    cancelled:  { variant: 'secondary',   className: '' },
  }
  const cfg = map[status] ?? { variant: 'outline' as const, className: '' }
  return (
    <Badge variant={cfg.variant} className={cfg.className}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  )
}

function getFinancials(order: Order): OrderFinancials | null {
  if (!order.order_financials || order.order_financials.length === 0) return null
  return order.order_financials[0]
}

function totalFees(fin: OrderFinancials | null): number | null {
  if (!fin) return null
  return (fin.commission_fee ?? 0) + (fin.collection_fee ?? 0) + (fin.fixed_fee ?? 0) +
         (fin.pick_pack_fee ?? 0) + (fin.forward_shipping_fee ?? 0) + (fin.reverse_shipping_fee ?? 0)
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function OrdersViewPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [accounts, setAccounts] = useState<MarketplaceAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // Filters
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [accountId, setAccountId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  // Fetch accounts for filter dropdown
  useEffect(() => {
    fetch('/api/marketplace-accounts')
      .then(r => r.json())
      .then((data: MarketplaceAccount[]) => {
        if (Array.isArray(data)) setAccounts(data)
      })
      .catch(() => {})
  }, [])

  // Fetch orders
  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (status) params.set('status', status)
      if (fromDate) params.set('from', fromDate)
      if (toDate) params.set('to', toDate)
      if (accountId) params.set('accountId', accountId)

      const res = await fetch(`/api/orders-view?${params}`)
      if (!res.ok) throw new Error('Failed to fetch orders')
      const data = await res.json()
      setOrders(data.orders)
      setTotal(data.total)
    } catch {
      toast.error('Failed to load orders')
    } finally {
      setLoading(false)
    }
  }, [page, debouncedSearch, status, fromDate, toDate, accountId])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, status, fromDate, toDate, accountId])

  function toggleRow(id: string) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Orders & Returns</h1>
        <p className="text-sm text-muted-foreground">
          Browse all orders with lifecycle tracking — dispatched, delivered, returned, settled
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search order ID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
        </div>

        <div className="w-[160px]">
          <Select value={status} onValueChange={v => setStatus(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUSES.map(s => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[180px]">
          <Select value={accountId} onValueChange={v => setAccountId(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="All Accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Accounts</SelectItem>
              {accounts.map(a => (
                <SelectItem key={a.id} value={a.id}>
                  {a.account_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="h-9 w-[140px]"
            placeholder="From"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="h-9 w-[140px]"
            placeholder="To"
          />
        </div>

        {(search || status || accountId || fromDate || toDate) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => {
              setSearch('')
              setStatus('')
              setAccountId('')
              setFromDate('')
              setToDate('')
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && orders.length === 0 && (
        <div className="text-center py-16 space-y-3">
          <Package className="h-12 w-12 mx-auto text-muted-foreground/50" />
          <h3 className="text-lg font-medium">No orders found</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {search || status || accountId || fromDate || toDate
              ? 'No orders match your filters. Try adjusting or clearing them.'
              : 'No orders yet. Import order data from the Import Data page.'}
          </p>
        </div>
      )}

      {/* Table */}
      {!loading && orders.length > 0 && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Order Date</TableHead>
                  <TableHead>Order ID</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1">
                      Revenue
                      <InfoTooltip content="Accounted net sales after returns and cancellations. From the order financials imported via P&L reports." />
                    </span>
                  </TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1">
                      Fees
                      <InfoTooltip content="Total platform fees: commission + collection + fixed + pick & pack + forward shipping + reverse shipping" />
                    </span>
                  </TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1">
                      Settlement
                      <InfoTooltip content="Amount settled by the platform. Shows pending amount if not yet settled." />
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map(order => {
                  const isExpanded = expandedRows.has(order.id)
                  const fin = getFinancials(order)
                  const fees = totalFees(fin)

                  return (
                    <React.Fragment key={order.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleRow(order.id)}
                      >
                        <TableCell className="pr-0">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {fmtDate(order.order_date)}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs text-muted-foreground">
                            {order.platform_order_id.length > 18
                              ? order.platform_order_id.slice(0, 18) + '...'
                              : order.platform_order_id}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm">
                          {order.master_skus?.name ?? (
                            <span className="text-muted-foreground italic">Unmapped</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {order.marketplace_accounts?.account_name ?? '-'}
                        </TableCell>
                        <TableCell>{statusBadge(order.status)}</TableCell>
                        <TableCell className="text-right text-sm">
                          {fmt(fin?.accounted_net_sales)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {fmt(fees)}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {fin?.amount_settled && Number(fin.amount_settled) > 0 ? (
                            <span className="text-green-600 font-medium">
                              {fmt(fin.amount_settled)}
                            </span>
                          ) : fin?.amount_pending && Number(fin.amount_pending) > 0 ? (
                            <span className="text-yellow-600">
                              {fmt(fin.amount_pending)} pending
                            </span>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                      </TableRow>

                      {/* Expanded detail row */}
                      {isExpanded && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={9} className="p-0 border-t-0">
                            <div className="bg-muted/30 p-4 rounded-md mx-4 mb-3 mt-1">
                              <div className="grid grid-cols-2 gap-8">
                                {/* Left: Lifecycle timeline */}
                                <div className="space-y-3">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Order Lifecycle
                                  </p>
                                  <div className="space-y-1.5 text-sm">
                                    <TimelineStep
                                      label="Ordered"
                                      date={order.order_date}
                                    />
                                    {order.dispatch_date && (
                                      <TimelineStep
                                        label="Dispatched"
                                        date={order.dispatch_date}
                                        days={daysBetween(order.order_date, order.dispatch_date)}
                                      />
                                    )}
                                    {order.delivery_date && (
                                      <TimelineStep
                                        label="Delivered"
                                        date={order.delivery_date}
                                        days={daysBetween(order.dispatch_date ?? order.order_date, order.delivery_date)}
                                      />
                                    )}
                                    {order.cancellation_date && (
                                      <TimelineStep
                                        label="Cancelled"
                                        date={order.cancellation_date}
                                        note={order.cancellation_reason ?? undefined}
                                      />
                                    )}
                                    {order.return_request_date && (
                                      <TimelineStep
                                        label={order.return_type === 'RTO' ? 'RTO Initiated' : 'Return Requested'}
                                        date={order.return_request_date}
                                        note={order.return_reason ?? undefined}
                                      />
                                    )}
                                    {order.return_complete_date && (
                                      <TimelineStep
                                        label="Return Received"
                                        date={order.return_complete_date}
                                        days={daysBetween(order.return_request_date ?? order.dispatch_date, order.return_complete_date)}
                                      />
                                    )}
                                    {order.settlement_date && (
                                      <TimelineStep
                                        label="Settled"
                                        date={order.settlement_date}
                                        days={daysBetween(order.order_date, order.settlement_date)}
                                        note={order.neft_id ? `NEFT: ${order.neft_id}` : undefined}
                                      />
                                    )}

                                    {/* Total cycle */}
                                    {order.settlement_date && (
                                      <div className="pt-1 border-t mt-2">
                                        <span className="text-muted-foreground">Total cycle: </span>
                                        <span className="font-medium">
                                          {daysBetween(order.order_date, order.settlement_date)} days
                                        </span>
                                      </div>
                                    )}
                                  </div>

                                  {/* Extra info */}
                                  <div className="text-xs text-muted-foreground space-y-0.5 pt-2 border-t">
                                    {order.order_item_id && (
                                      <div>Item ID: <span className="font-mono">{order.order_item_id}</span></div>
                                    )}
                                    {order.fulfillment_type && <div>Fulfillment: {order.fulfillment_type}</div>}
                                    {order.payment_mode && <div>Payment: {order.payment_mode}</div>}
                                    {order.channel && <div>Channel: {order.channel}</div>}
                                    <div>Qty: {order.quantity} | Sale Price: {fmt(order.sale_price)}</div>
                                  </div>
                                </div>

                                {/* Right: Fee breakdown */}
                                <div className="space-y-3">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Fee Breakdown
                                  </p>
                                  {fin ? (
                                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Commission</span>
                                        <span>{fmt(fin.commission_fee)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Forward Shipping</span>
                                        <span>{fmt(fin.forward_shipping_fee)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Collection</span>
                                        <span>{fmt(fin.collection_fee)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Pick & Pack</span>
                                        <span>{fmt(fin.pick_pack_fee)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Fixed Fee</span>
                                        <span>{fmt(fin.fixed_fee)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Reverse Shipping</span>
                                        <span>{fmt(fin.reverse_shipping_fee)}</span>
                                      </div>

                                      <div className="col-span-2 border-t pt-2 mt-1 space-y-1.5">
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">Accounted Net Sales</span>
                                          <span className="font-medium">{fmt(fin.accounted_net_sales)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">Total Fees</span>
                                          <span className="font-medium text-red-600">{fmt(totalFees(fin))}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">Projected Settlement</span>
                                          <span>{fmt(fin.projected_settlement)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">Amount Settled</span>
                                          <span className="font-medium text-green-600">{fmt(fin.amount_settled)}</span>
                                        </div>
                                        {Number(fin.amount_pending ?? 0) > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Amount Pending</span>
                                            <span className="text-yellow-600">{fmt(fin.amount_pending)}</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-muted-foreground italic">
                                      No financial data. Import a P&L report to see fee breakdowns.
                                    </p>
                                  )}

                                  {/* Return details */}
                                  {(order.return_type || order.return_reason) && (
                                    <div className="space-y-1 pt-2 border-t">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                        Return Details
                                      </p>
                                      <div className="text-sm space-y-0.5">
                                        {order.return_type && (
                                          <div>
                                            <span className="text-muted-foreground">Type: </span>
                                            {order.return_type}
                                          </div>
                                        )}
                                        {order.return_status && (
                                          <div>
                                            <span className="text-muted-foreground">Status: </span>
                                            {order.return_status}
                                          </div>
                                        )}
                                        {order.return_reason && (
                                          <div>
                                            <span className="text-muted-foreground">Reason: </span>
                                            {order.return_reason}
                                          </div>
                                        )}
                                        {order.return_sub_reason && (
                                          <div>
                                            <span className="text-muted-foreground">Sub-reason: </span>
                                            {order.return_sub_reason}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-muted-foreground pt-1">
            <span>
              Showing {rangeStart.toLocaleString('en-IN')}–{rangeEnd.toLocaleString('en-IN')} of{' '}
              {total.toLocaleString('en-IN')} orders
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-sm tabular-nums">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Timeline Step Component ─────────────────────────────────────────────────

function TimelineStep({
  label,
  date,
  days,
  note,
}: {
  label: string
  date: string
  days?: number | null
  note?: string
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex flex-col items-center mt-1">
        <div className="w-2 h-2 rounded-full bg-primary" />
        <div className="w-px h-3 bg-border" />
      </div>
      <div className="flex-1 -mt-0.5">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground">{fmtDate(date)}</span>
          {days != null && days > 0 && (
            <span className="text-xs text-muted-foreground">
              ({days} day{days !== 1 ? 's' : ''})
            </span>
          )}
        </div>
        {note && (
          <p className="text-xs text-muted-foreground mt-0.5">{note}</p>
        )}
      </div>
    </div>
  )
}
