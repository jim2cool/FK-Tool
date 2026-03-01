'use client'

import * as React from 'react'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface CogsBreakdown {
  sku_id: string
  sku_name: string
  wac_base_per_unit: number
  wac_freight_per_unit: number
  purchase_cogs_per_unit: number
  packaging_cost_per_dispatch: number
  delivery_rate: number
  dispatch_cogs_per_unit: number
  shrinkage_rate: number
  shrinkage_per_unit: number
  full_cogs_per_unit: number
  total_units_purchased: number
  lot_count: number
  latest_purchase_date: string | null
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)
}

type PopoverKey = `${string}-delivery` | `${string}-shrinkage`

export default function CogsPage() {
  const [cogsData, setCogsData] = useState<CogsBreakdown[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [popoverOpen, setPopoverOpen] = useState<Partial<Record<PopoverKey, boolean>>>({})
  const [editDeliveryRate, setEditDeliveryRate] = useState<Record<string, string>>({})
  const [editShrinkageRate, setEditShrinkageRate] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetchCogs()
  }, [])

  async function fetchCogs() {
    setLoading(true)
    try {
      const res = await fetch('/api/cogs')
      if (!res.ok) throw new Error('Failed to fetch COGS data')
      const data: CogsBreakdown[] = await res.json()
      setCogsData(data)
    } catch {
      toast.error('Failed to load COGS data')
    } finally {
      setLoading(false)
    }
  }

  function toggleRow(skuId: string) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(skuId)) {
        next.delete(skuId)
      } else {
        next.add(skuId)
      }
      return next
    })
  }

  function openPopover(key: PopoverKey, currentValue: string) {
    const parts = key.split('-')
    const field = parts[parts.length - 1] as 'delivery' | 'shrinkage'
    const skuId = parts.slice(0, -1).join('-')
    if (field === 'delivery') {
      setEditDeliveryRate(prev => ({ ...prev, [skuId]: currentValue }))
    } else {
      setEditShrinkageRate(prev => ({ ...prev, [skuId]: currentValue }))
    }
    setPopoverOpen(prev => ({ ...prev, [key]: true }))
  }

  function closePopover(key: PopoverKey) {
    setPopoverOpen(prev => ({ ...prev, [key]: false }))
  }

  async function saveField(skuId: string, field: 'delivery_rate' | 'shrinkage_rate') {
    const popKey: PopoverKey = field === 'delivery_rate'
      ? `${skuId}-delivery`
      : `${skuId}-shrinkage`

    const rawValue = field === 'delivery_rate'
      ? editDeliveryRate[skuId]
      : editShrinkageRate[skuId]

    const parsed = parseFloat(rawValue ?? '')
    if (isNaN(parsed) || parsed <= 0) {
      toast.error('Please enter a valid positive number')
      return
    }

    // For shrinkage_rate the user enters a percentage (e.g. 2), store as 0.02
    const valueToSend = field === 'shrinkage_rate' ? parsed / 100 : parsed

    setSaving(prev => ({ ...prev, [`${skuId}-${field}`]: true }))
    try {
      const res = await fetch(`/api/cogs/${skuId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: valueToSend }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Failed to save')
      }
      const updated: CogsBreakdown = await res.json()
      setCogsData(prev => prev.map(r => (r.sku_id === skuId ? updated : r)))
      closePopover(popKey)
      toast.success('Updated successfully')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(prev => ({ ...prev, [`${skuId}-${field}`]: false }))
    }
  }

  const avgFullCogs =
    cogsData.length > 0
      ? cogsData.reduce((s, r) => s + r.full_cogs_per_unit, 0) / cogsData.length
      : 0
  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">COGS</h1>
          <p className="text-sm text-muted-foreground">
            Weighted average cost per delivered unit
          </p>
        </div>
        <p className="text-muted-foreground">Loading COGS data…</p>
      </div>
    )
  }

  if (cogsData.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">COGS</h1>
          <p className="text-sm text-muted-foreground">
            Weighted average cost per delivered unit
          </p>
        </div>
        <p className="text-muted-foreground">
          No purchases found. Add purchases to see COGS calculations.
        </p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">COGS</h1>
        <p className="text-sm text-muted-foreground">
          Weighted average cost per delivered unit
        </p>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Lots</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">WAC Base</TableHead>
              <TableHead className="text-right">Freight/unit</TableHead>
              <TableHead className="text-right">Purchase COGS</TableHead>
              <TableHead className="text-right">Dispatch COGS</TableHead>
              <TableHead className="text-right">Shrinkage</TableHead>
              <TableHead className="text-right font-semibold">Full COGS/unit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cogsData.map(row => {
              const isExpanded = expandedRows.has(row.sku_id)
              const deliveryPopKey: PopoverKey = `${row.sku_id}-delivery`
              const shrinkagePopKey: PopoverKey = `${row.sku_id}-shrinkage`
              const deliverySaving = saving[`${row.sku_id}-delivery_rate`] ?? false
              const shrinkageSaving = saving[`${row.sku_id}-shrinkage_rate`] ?? false

              return (
                <>
                  {/* Main row */}
                  <TableRow
                    key={row.sku_id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => toggleRow(row.sku_id)}
                  >
                    <TableCell className="pr-0">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{row.sku_name}</TableCell>
                    <TableCell className="text-right">{row.lot_count}</TableCell>
                    <TableCell className="text-right">{fmt(row.total_units_purchased)}</TableCell>
                    <TableCell className="text-right">₹{fmt(row.wac_base_per_unit)}</TableCell>
                    <TableCell className="text-right">₹{fmt(row.wac_freight_per_unit)}</TableCell>
                    <TableCell className="text-right">₹{fmt(row.purchase_cogs_per_unit)}</TableCell>
                    <TableCell className="text-right">₹{fmt(row.dispatch_cogs_per_unit)}</TableCell>
                    <TableCell className="text-right">₹{fmt(row.shrinkage_per_unit)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary" className="font-semibold text-sm">
                        ₹{fmt(row.full_cogs_per_unit)}
                      </Badge>
                    </TableCell>
                  </TableRow>

                  {/* Expanded breakdown row */}
                  {isExpanded && (
                    <TableRow key={`${row.sku_id}-expanded`} className="hover:bg-transparent">
                      <TableCell colSpan={10} className="p-0 border-t-0">
                        <div
                          className="bg-muted/30 p-4 rounded-md mx-4 mb-3 mt-1"
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        >
                          <div className="grid grid-cols-2 gap-8">
                            {/* Left: Purchase COGS */}
                            <div className="space-y-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Purchase COGS</p>
                              <div className="space-y-1.5 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Avg Rate/Unit (ex-GST)</span>
                                  <span>
                                    ₹{fmt(row.wac_base_per_unit)}{' '}
                                    <span className="text-xs text-muted-foreground">({row.lot_count} lot{row.lot_count !== 1 ? 's' : ''})</span>
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Allocated inward freight/unit</span>
                                  <span>₹{fmt(row.wac_freight_per_unit)}</span>
                                </div>
                                <div className="flex justify-between font-medium border-t pt-1.5">
                                  <span>Purchase COGS/unit</span>
                                  <span>₹{fmt(row.purchase_cogs_per_unit)}</span>
                                </div>
                              </div>
                            </div>
                            {/* Right: Dispatch + Shrinkage + Full */}
                            <div className="space-y-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dispatch COGS</p>
                              <div className="space-y-1.5 text-sm">                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Packaging cost/dispatch</span>
                                  <span>₹{fmt(row.packaging_cost_per_dispatch)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-muted-foreground">Delivery rate</span>
                                  <Popover
                                    open={!!popoverOpen[deliveryPopKey]}
                                    onOpenChange={(open: boolean) => {
                                      if (open) openPopover(deliveryPopKey, String(row.delivery_rate))
                                      else closePopover(deliveryPopKey)
                                    }}
                                  >
                                    <PopoverTrigger asChild>                                      <button className="text-primary underline underline-offset-2 text-sm hover:text-primary/80 font-mono" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                        {row.delivery_rate.toFixed(2)}
                                      </button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-56 p-3 space-y-2" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                      <Label className="text-xs">Delivery rate (0–1)</Label>
                                      <Input type="number" min={0.01} max={1} step={0.01}
                                        value={editDeliveryRate[row.sku_id] ?? String(row.delivery_rate)}
                                        onChange={e => setEditDeliveryRate(prev => ({ ...prev, [row.sku_id]: e.target.value }))}
                                        className="h-8 text-sm" />
                                      <div className="flex gap-2">
                                        <Button size="sm" className="h-7 text-xs flex-1" disabled={deliverySaving} onClick={() => saveField(row.sku_id, 'delivery_rate')}>
                                          {deliverySaving ? 'Saving…' : 'Save'}
                                        </Button>
                                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => closePopover(deliveryPopKey)}>Cancel</Button>
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                </div>
                                <div className="flex justify-between font-medium border-t pt-1.5">
                                  <span>Dispatch COGS/unit <span className="text-xs font-normal text-muted-foreground">(packaging ÷ rate)</span></span>
                                  <span>₹{fmt(row.dispatch_cogs_per_unit)}</span>
                                </div>
                              </div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1">Shrinkage</p>
                              <div className="space-y-1.5 text-sm">
                                <div className="flex justify-between items-center">
                                  <span className="text-muted-foreground">Shrinkage rate</span>
                                  <Popover
                                    open={!!popoverOpen[shrinkagePopKey]}
                                    onOpenChange={(open: boolean) => {
                                      if (open) openPopover(shrinkagePopKey, String((row.shrinkage_rate * 100).toFixed(2)))
                                      else closePopover(shrinkagePopKey)
                                    }}
                                  >
                                    <PopoverTrigger asChild>
                                      <button className="text-primary underline underline-offset-2 text-sm hover:text-primary/80 font-mono" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                        {(row.shrinkage_rate * 100).toFixed(2)}%
                                      </button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-56 p-3 space-y-2" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                      <Label className="text-xs">Shrinkage rate (%)</Label>
                                      <Input type="number" min={0} max={100} step={0.1}
                                        value={editShrinkageRate[row.sku_id] ?? String((row.shrinkage_rate * 100).toFixed(2))}
                                        onChange={e => setEditShrinkageRate(prev => ({ ...prev, [row.sku_id]: e.target.value }))}
                                        className="h-8 text-sm" />
                                      <div className="flex gap-2">
                                        <Button size="sm" className="h-7 text-xs flex-1" disabled={shrinkageSaving} onClick={() => saveField(row.sku_id, 'shrinkage_rate')}>
                                          {shrinkageSaving ? 'Saving…' : 'Save'}
                                        </Button>
                                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => closePopover(shrinkagePopKey)}>Cancel</Button>
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Shrinkage/unit <span className="text-xs">(rate × purchase COGS)</span></span>
                                  <span>₹{fmt(row.shrinkage_per_unit)}</span>
                                </div>
                              </div>
                              <div className="flex justify-between items-center border-t pt-2 mt-1">
                                <span className="font-semibold">Full COGS/unit</span>
                                <Badge variant="secondary" className="font-bold text-sm">₹{fmt(row.full_cogs_per_unit)}</Badge>
                              </div>

                              {row.latest_purchase_date && (
                                <p className="text-xs text-muted-foreground pt-1">
                                  Latest purchase:{' '}
                                  {new Date(row.latest_purchase_date).toLocaleDateString('en-IN')}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-sm text-muted-foreground pt-1">
        <span>{cogsData.length} SKU{cogsData.length !== 1 ? 's' : ''}</span>
        <span>
          Avg full COGS:{' '}
          <span className="font-medium text-foreground">₹{fmt(avgFullCogs)}</span>
        </span>
      </div>
    </div>
  )
}