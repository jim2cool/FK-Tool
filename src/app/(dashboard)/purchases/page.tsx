'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { PurchasesImportDialog } from '@/components/purchases/PurchasesImportDialog'
import { toast } from 'sonner'
import { Plus, Upload, ChevronDown, ChevronRight, Pencil, Trash2, IndianRupee } from 'lucide-react'
import { format, parseISO } from 'date-fns'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MasterSku {
  id: string
  name: string
  parent_id: string | null
}

interface Warehouse {
  id: string
  name: string
}

interface Purchase {
  id: string
  master_sku_id: string
  warehouse_id: string
  quantity: number
  unit_purchase_price: number
  packaging_cost: number
  other_cost: number
  total_cogs: number
  supplier: string | null
  purchase_date: string
  received_date: string | null
  hsn_code: string | null
  gst_rate_slab: string | null
  tax_paid: boolean
  invoice_number: string | null
  master_skus: { id: string; name: string; parent_id: string | null } | null
  warehouses: { id: string; name: string } | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50
const GST_SLABS = ['0%', '5%', '12%', '18%', '28%']

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)
}

function calcGST(unitPrice: number, gstSlab: string | null, taxPaid: boolean, qty: number) {
  const rate     = parseFloat((gstSlab ?? '18').replace('%', '')) || 0
  const gstPerUnit = unitPrice * rate / 100
  const unitIncl = unitPrice + gstPerUnit
  const totalGst = taxPaid ? 0 : gstPerUnit * qty
  const totalAmt = unitIncl * qty
  return { gstPerUnit, unitIncl, totalGst, totalAmt }
}

function monthLabel(yearMonth: string) {
  try { return format(parseISO(yearMonth + '-01'), 'MMMM yyyy') }
  catch { return yearMonth }
}

// ── Empty form ────────────────────────────────────────────────────────────────

const emptyForm = {
  master_sku_id:       '',
  variant_sku_id:      '',
  warehouse_id:        '',
  quantity:            '',
  unit_purchase_price: '',
  packaging_cost:      '',
  other_cost:          '',
  supplier:            '',
  purchase_date:       format(new Date(), 'yyyy-MM-dd'),
  received_date:       '',
  hsn_code:            '',
  gst_rate_slab:       '18%',
  tax_paid:            'N' as 'Y' | 'N',
  invoice_number:      '',
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PurchasesPage() {
  const [purchases, setPurchases]   = useState<Purchase[]>([])
  const [skus, setSkus]             = useState<MasterSku[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading]       = useState(true)

  // Filters
  const [search,          setSearch]          = useState('')
  const [filterWarehouse, setFilterWarehouse] = useState('')
  const [filterFrom,      setFilterFrom]      = useState('')
  const [filterTo,        setFilterTo]        = useState('')
  const [filterGst,       setFilterGst]       = useState('')
  const [filterTaxPaid,   setFilterTaxPaid]   = useState('')

  // Pagination
  const [page, setPage] = useState(1)

  // Accordion open state
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set())

  // Import dialog
  const [importOpen, setImportOpen] = useState(false)

  // Add/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId,  setEditingId]  = useState<string | null>(null)
  const [form,       setForm]       = useState(emptyForm)
  const [saving,     setSaving]     = useState(false)

  // ── Fetch data ──────────────────────────────────────────────────────────────

  const loadPurchases = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/purchases')
      if (!res.ok) throw new Error('Failed to fetch')
      setPurchases(await res.json())
    } catch {
      toast.error('Failed to load purchases')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPurchases() }, [loadPurchases])

  useEffect(() => {
    Promise.all([
      fetch('/api/catalog/master-skus').then(r => r.json()),
      fetch('/api/warehouses').then(r => r.json()),
    ]).then(([s, w]) => {
      setSkus(Array.isArray(s) ? s : [])
      setWarehouses(Array.isArray(w) ? w : [])
    }).catch(() => {})
  }, [])

  // Auto-open most recent month on load
  useEffect(() => {
    if (purchases.length > 0) {
      const firstKey = purchases[0]?.purchase_date?.slice(0, 7)
      if (firstKey) setOpenMonths(new Set([firstKey]))
    }
  }, [purchases])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [search, filterWarehouse, filterFrom, filterTo, filterGst, filterTaxPaid])

  // ── Filtering ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let data = purchases
    if (search) {
      const q = search.toLowerCase()
      data = data.filter(p =>
        p.master_skus?.name.toLowerCase().includes(q) ||
        (p.supplier ?? '').toLowerCase().includes(q)
      )
    }
    if (filterWarehouse) data = data.filter(p => p.warehouse_id === filterWarehouse)
    if (filterFrom)      data = data.filter(p => p.purchase_date >= filterFrom)
    if (filterTo)        data = data.filter(p => p.purchase_date <= filterTo)
    if (filterGst)       data = data.filter(p => p.gst_rate_slab === filterGst)
    if (filterTaxPaid === 'Y') data = data.filter(p => p.tax_paid)
    if (filterTaxPaid === 'N') data = data.filter(p => !p.tax_paid)
    return data
  }, [purchases, search, filterWarehouse, filterFrom, filterTo, filterGst, filterTaxPaid])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pagedRows  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const hasFilters = !!(search || filterWarehouse || filterFrom || filterTo || filterGst || filterTaxPaid)

  // ── Group by month ──────────────────────────────────────────────────────────

  const monthGroups = useMemo(() => {
    const map = new Map<string, Purchase[]>()
    for (const p of pagedRows) {
      const key = p.purchase_date.slice(0, 7)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, rows]) => ({ key, label: monthLabel(key), rows }))
  }, [pagedRows])

  // ── Page totals ─────────────────────────────────────────────────────────────

  const pageTotals = useMemo(() => {
    let units = 0, gst = 0, amount = 0
    for (const p of pagedRows) {
      const { totalGst, totalAmt } = calcGST(p.unit_purchase_price, p.gst_rate_slab, p.tax_paid, p.quantity)
      units  += p.quantity
      gst    += totalGst
      amount += totalAmt
    }
    return { units, gst, amount }
  }, [pagedRows])

  // ── Month totals ────────────────────────────────────────────────────────────

  function monthTotals(rows: Purchase[]) {
    let units = 0, gst = 0, amount = 0
    for (const p of rows) {
      const { totalGst, totalAmt } = calcGST(p.unit_purchase_price, p.gst_rate_slab, p.tax_paid, p.quantity)
      units  += p.quantity
      gst    += totalGst
      amount += totalAmt
    }
    return { units, gst, amount }
  }

  // ── Dialog helpers ──────────────────────────────────────────────────────────

  const selectableSkus = useMemo(() => skus.filter(s => s.parent_id === null), [skus])

  const variantOptions = useMemo(() => {
    if (!form.master_sku_id) return []
    return skus.filter(s => s.parent_id === form.master_sku_id)
  }, [skus, form.master_sku_id])

  function setField<K extends keyof typeof emptyForm>(key: K, value: typeof emptyForm[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function openAdd() {
    setEditingId(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  function openEdit(p: Purchase) {
    setEditingId(p.id)
    const isVariant = !!p.master_skus?.parent_id
    setForm({
      master_sku_id:       isVariant ? (p.master_skus?.parent_id ?? '') : p.master_sku_id,
      variant_sku_id:      isVariant ? p.master_sku_id : '',
      warehouse_id:        p.warehouse_id,
      quantity:            String(p.quantity),
      unit_purchase_price: String(p.unit_purchase_price),
      packaging_cost:      String(p.packaging_cost),
      other_cost:          String(p.other_cost),
      supplier:            p.supplier ?? '',
      purchase_date:       p.purchase_date,
      received_date:       p.received_date ?? '',
      hsn_code:            p.hsn_code ?? '',
      gst_rate_slab:       p.gst_rate_slab ?? '18%',
      tax_paid:            p.tax_paid ? 'Y' : 'N',
      invoice_number:      p.invoice_number ?? '',
    })
    setDialogOpen(true)
  }

  function effectiveSkuId() {
    return form.variant_sku_id || form.master_sku_id
  }

  const liveCalc = useMemo(() => {
    const rate = parseFloat(form.unit_purchase_price) || 0
    const qty  = parseInt(form.quantity) || 1
    return calcGST(rate, form.gst_rate_slab, form.tax_paid === 'Y', qty)
  }, [form.unit_purchase_price, form.quantity, form.gst_rate_slab, form.tax_paid])

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.master_sku_id)                           return toast.error('Please select a master product')
    if (!form.warehouse_id)                            return toast.error('Please select a warehouse')
    if (!form.quantity || Number(form.quantity) <= 0)  return toast.error('Quantity must be > 0')
    if (!form.purchase_date)                           return toast.error('Receipt date is required')
    if (!form.unit_purchase_price)                     return toast.error('Rate per unit is required')

    setSaving(true)
    try {
      const payload = {
        ...(editingId ? { id: editingId } : {}),
        master_sku_id:       effectiveSkuId(),
        warehouse_id:        form.warehouse_id,
        quantity:            Number(form.quantity),
        unit_purchase_price: Number(form.unit_purchase_price) || 0,
        packaging_cost:      Number(form.packaging_cost) || 0,
        other_cost:          Number(form.other_cost) || 0,
        supplier:            form.supplier || null,
        purchase_date:       form.purchase_date,
        received_date:       form.received_date || null,
        hsn_code:            form.hsn_code || null,
        gst_rate_slab:       form.gst_rate_slab,
        tax_paid:            form.tax_paid === 'Y',
        invoice_number:      form.invoice_number || null,
      }
      const res = await fetch('/api/purchases', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Failed to save')
        return
      }
      toast.success(editingId ? 'Purchase updated' : 'Purchase added')
      setDialogOpen(false)
      loadPurchases()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this purchase record?')) return
    const res = await fetch('/api/purchases', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) { toast.success('Purchase deleted'); loadPurchases() }
    else toast.error('Failed to delete')
  }

  function toggleMonth(key: string) {
    setOpenMonths(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function clearFilters() {
    setSearch(''); setFilterWarehouse(''); setFilterFrom(''); setFilterTo('')
    setFilterGst(''); setFilterTaxPaid('')
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Purchases</h2>
          <p className="text-sm text-muted-foreground mt-1">Track procurement and cost of goods</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Bulk Import
          </Button>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-2" />
            Add Purchase
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <Input
            className="w-48"
            placeholder="Product or vendor…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Warehouse</Label>
          <Select value={filterWarehouse || '__all__'} onValueChange={v => setFilterWarehouse(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All warehouses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All warehouses</SelectItem>
              {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" className="w-36" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" className="w-36" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">GST Rate</Label>
          <Select value={filterGst || '__all__'} onValueChange={v => setFilterGst(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All rates</SelectItem>
              {GST_SLABS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Tax Paid</Label>
          <Select value={filterTaxPaid || '__all__'} onValueChange={v => setFilterTaxPaid(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All</SelectItem>
              <SelectItem value="Y">Paid</SelectItem>
              <SelectItem value="N">Unpaid</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
        )}
      </div>

      {/* Month accordions */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border py-16 text-center text-muted-foreground text-sm">
          {hasFilters
            ? 'No purchases match your filters.'
            : 'No purchases yet. Add your first purchase above.'}
        </div>
      ) : (
        <div className="space-y-3">
          {monthGroups.map(({ key, label, rows }) => {
            const isOpen = openMonths.has(key)
            const totals = monthTotals(rows)
            return (
              <div key={key} className="rounded-lg border overflow-hidden">
                {/* Accordion header */}
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => toggleMonth(key)}
                >
                  {isOpen
                    ? <ChevronDown  className="h-4 w-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  }
                  <span className="font-semibold text-sm">{label}</span>
                  <span className="text-muted-foreground text-sm ml-1">
                    — {rows.length} record{rows.length !== 1 ? 's' : ''}
                  </span>
                  <div className="ml-auto flex items-center gap-4 text-sm text-muted-foreground">
                    <span>₹{fmt(totals.amount)} total</span>
                    {totals.gst > 0 && <span>₹{fmt(totals.gst)} GST</span>}
                  </div>
                </button>

                {/* Accordion body */}
                {isOpen && (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Master Product</TableHead>
                          <TableHead>Variant</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead>HSN</TableHead>
                          <TableHead>GST Rate</TableHead>
                          <TableHead>Tax Paid</TableHead>
                          <TableHead className="text-right">Rate/Unit (ex)</TableHead>
                          <TableHead className="text-right">GST/Unit</TableHead>
                          <TableHead className="text-right">Unit Price (incl.)</TableHead>
                          <TableHead className="text-right">Total GST</TableHead>
                          <TableHead className="text-right font-semibold">Total Amount</TableHead>
                          <TableHead>Vendor</TableHead>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Warehouse</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map(p => {
                          const { gstPerUnit, unitIncl, totalGst, totalAmt } = calcGST(
                            p.unit_purchase_price, p.gst_rate_slab, p.tax_paid, p.quantity
                          )
                          const skuName   = p.master_skus?.name ?? '—'
                          const parentId  = p.master_skus?.parent_id
                          const parentSku = parentId ? skus.find(s => s.id === parentId) : null

                          return (
                            <TableRow key={p.id}>
                              <TableCell className="text-sm tabular-nums whitespace-nowrap">
                                {p.purchase_date}
                              </TableCell>
                              <TableCell className="font-medium text-sm">
                                {parentSku ? parentSku.name : skuName}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {parentSku ? skuName : '—'}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{p.quantity}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {p.hsn_code ?? '—'}
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary" className="text-xs">
                                  {p.gst_rate_slab ?? '18%'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm">
                                {p.tax_paid
                                  ? <span className="text-green-600 font-medium">✓ Paid</span>
                                  : <span className="text-muted-foreground">—</span>
                                }
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm">
                                ₹{fmt(p.unit_purchase_price)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                                ₹{fmt(gstPerUnit)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm">
                                ₹{fmt(unitIncl)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                                {totalGst === 0 ? '—' : `₹${fmt(totalGst)}`}
                              </TableCell>
                              <TableCell className="text-right tabular-nums font-semibold">
                                ₹{fmt(totalAmt)}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {p.supplier ?? '—'}
                              </TableCell>
                              <TableCell className="text-sm font-mono text-muted-foreground">
                                {p.invoice_number ?? '—'}
                              </TableCell>
                              <TableCell className="text-sm">
                                {p.warehouses?.name ?? '—'}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost" size="sm"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => handleDelete(p.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination + page totals */}
      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between text-sm pt-2">
          <div className="flex items-center gap-3 text-muted-foreground flex-wrap">
            <span>
              Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <Separator orientation="vertical" className="h-4" />
            <span>Units: <span className="font-semibold text-foreground">{fmt(pageTotals.units)}</span></span>
            {pageTotals.gst > 0 && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <span>GST: <span className="font-semibold text-foreground">₹{fmt(pageTotals.gst)}</span></span>
              </>
            )}
            <Separator orientation="vertical" className="h-4" />
            <span className="flex items-center gap-1">
              <IndianRupee className="h-3 w-3" />
              Total: <span className="font-semibold text-foreground ml-1">₹{fmt(pageTotals.amount)}</span>
            </span>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                ← Prev
              </Button>
              <span className="text-muted-foreground">Page {page} of {totalPages}</span>
              <Button
                variant="outline" size="sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Next →
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Purchase' : 'Add Purchase'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">

            {/* Master Product */}
            <div className="space-y-1">
              <Label>Master Product <span className="text-destructive">*</span></Label>
              <Select
                value={form.master_sku_id}
                onValueChange={v => { setField('master_sku_id', v); setField('variant_sku_id', '') }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select product…" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {selectableSkus.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Variant (conditional) */}
            {variantOptions.length > 0 && (
              <div className="space-y-1">
                <Label>Variant</Label>
                <Select
                  value={form.variant_sku_id || '__none__'}
                  onValueChange={v => setField('variant_sku_id', v === '__none__' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select variant…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No variant (use parent)</SelectItem>
                    {variantOptions.map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Warehouse + Qty */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Warehouse <span className="text-destructive">*</span></Label>
                <Select value={form.warehouse_id} onValueChange={v => setField('warehouse_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Quantity <span className="text-destructive">*</span></Label>
                <Input type="number" min={1} placeholder="0"
                  value={form.quantity} onChange={e => setField('quantity', e.target.value)} />
              </div>
            </div>

            {/* Rate + GST */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Rate Per Unit (ex-tax) <span className="text-destructive">*</span></Label>
                <Input type="number" min={0} step="0.01" placeholder="0.00"
                  value={form.unit_purchase_price}
                  onChange={e => setField('unit_purchase_price', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">GST Rate Slab</Label>
                <Select value={form.gst_rate_slab} onValueChange={v => setField('gst_rate_slab', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GST_SLABS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Tax Paid */}
            <div className="space-y-1">
              <Label className="text-xs">Tax Paid</Label>
              <Select value={form.tax_paid} onValueChange={v => setField('tax_paid', v as 'Y' | 'N')}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Y">Yes — already paid</SelectItem>
                  <SelectItem value="N">No — liability pending</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Live GST preview */}
            {form.unit_purchase_price && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1">
                <span>GST/unit: <span className="font-medium text-foreground">₹{fmt(liveCalc.gstPerUnit)}</span></span>
                <span>Unit price (incl.): <span className="font-medium text-foreground">₹{fmt(liveCalc.unitIncl)}</span></span>
                <span>Total GST: <span className="font-medium text-foreground">{liveCalc.totalGst === 0 ? '—' : `₹${fmt(liveCalc.totalGst)}`}</span></span>
                <span>Total amount: <span className="font-semibold text-foreground">₹{fmt(liveCalc.totalAmt)}</span></span>
              </div>
            )}

            {/* Packaging + Other */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Packaging Cost (₹)</Label>
                <Input type="number" min={0} step="0.01" placeholder="0.00"
                  value={form.packaging_cost}
                  onChange={e => setField('packaging_cost', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Other Cost (₹)</Label>
                <Input type="number" min={0} step="0.01" placeholder="0.00"
                  value={form.other_cost}
                  onChange={e => setField('other_cost', e.target.value)} />
              </div>
            </div>

            {/* HSN + Invoice */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">HSN Code</Label>
                <Input placeholder="e.g. 8523" value={form.hsn_code}
                  onChange={e => setField('hsn_code', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Invoice Number</Label>
                <Input placeholder="e.g. INV-001" value={form.invoice_number}
                  onChange={e => setField('invoice_number', e.target.value)} />
              </div>
            </div>

            {/* Vendor + Dates */}
            <div className="space-y-1">
              <Label className="text-xs">Vendor Name</Label>
              <Input placeholder="e.g. Rudra Enterprises" value={form.supplier}
                onChange={e => setField('supplier', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Receipt Date <span className="text-destructive">*</span></Label>
                <Input type="date" value={form.purchase_date}
                  onChange={e => setField('purchase_date', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Received Date</Label>
                <Input type="date" value={form.received_date}
                  onChange={e => setField('received_date', e.target.value)} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Purchase'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <PurchasesImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={loadPurchases}
      />
    </div>
  )
}
