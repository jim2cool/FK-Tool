'use client'
import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { Plus, Edit2, Trash2, IndianRupee } from 'lucide-react'
import { format } from 'date-fns'

interface MasterSku {
  id: string
  name: string
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
  unit_cost: number
  packaging_cost: number
  other_cost: number
  total_cogs: number
  supplier: string | null
  purchase_date: string
  received_date: string | null
  created_at: string
  master_skus: { id: string; name: string } | null
  warehouses: { id: string; name: string } | null
}

const emptyForm = {
  master_sku_id: '',
  warehouse_id: '',
  quantity: '',
  unit_cost: '',
  packaging_cost: '',
  other_cost: '',
  supplier: '',
  purchase_date: format(new Date(), 'yyyy-MM-dd'),
  received_date: '',
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)
}

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [skus, setSkus] = useState<MasterSku[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [filterWarehouse, setFilterWarehouse] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterSku, setFilterSku] = useState('')

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const fetchPurchases = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterWarehouse) params.set('warehouse_id', filterWarehouse)
      if (filterFrom) params.set('from', filterFrom)
      if (filterTo) params.set('to', filterTo)
      const res = await fetch(`/api/purchases?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      let data: Purchase[] = await res.json()
      if (filterSku) {
        const q = filterSku.toLowerCase()
        data = data.filter(p => p.master_skus?.name.toLowerCase().includes(q))
      }
      setPurchases(data)
    } catch {
      toast.error('Failed to load purchases')
    } finally {
      setLoading(false)
    }
  }, [filterWarehouse, filterFrom, filterTo, filterSku])

  useEffect(() => { fetchPurchases() }, [fetchPurchases])

  useEffect(() => {
    Promise.all([
      fetch('/api/catalog/master-skus').then(r => r.json()),
      fetch('/api/warehouses').then(r => r.json()),
    ]).then(([s, w]) => {
      setSkus(s)
      setWarehouses(w)
    }).catch(() => {})
  }, [])

  function openAdd() {
    setEditingId(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  function openEdit(p: Purchase) {
    setEditingId(p.id)
    setForm({
      master_sku_id: p.master_sku_id,
      warehouse_id: p.warehouse_id,
      quantity: String(p.quantity),
      unit_cost: String(p.unit_cost),
      packaging_cost: String(p.packaging_cost),
      other_cost: String(p.other_cost),
      supplier: p.supplier ?? '',
      purchase_date: p.purchase_date,
      received_date: p.received_date ?? '',
    })
    setDialogOpen(true)
  }

  function setField(key: keyof typeof emptyForm, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave() {
    if (!form.master_sku_id) return toast.error('Please select a master SKU')
    if (!form.warehouse_id) return toast.error('Please select a warehouse')
    if (!form.quantity || Number(form.quantity) <= 0) return toast.error('Quantity must be > 0')
    if (!form.purchase_date) return toast.error('Purchase date is required')

    setSaving(true)
    try {
      const payload = {
        ...(editingId ? { id: editingId } : {}),
        master_sku_id: form.master_sku_id,
        warehouse_id: form.warehouse_id,
        quantity: Number(form.quantity),
        unit_cost: Number(form.unit_cost) || 0,
        packaging_cost: Number(form.packaging_cost) || 0,
        other_cost: Number(form.other_cost) || 0,
        supplier: form.supplier || null,
        purchase_date: form.purchase_date,
        received_date: form.received_date || null,
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
      fetchPurchases()
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
    if (res.ok) {
      toast.success('Purchase deleted')
      fetchPurchases()
    } else {
      toast.error('Failed to delete')
    }
  }

  // Totals
  const totals = purchases.reduce(
    (acc, p) => ({
      qty: acc.qty + p.quantity,
      cogs: acc.cogs + Number(p.total_cogs),
    }),
    { qty: 0, cogs: 0 }
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Purchases</h2>
          <p className="text-sm text-muted-foreground mt-1">Track procurement and cost of goods</p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4 mr-2" />
          Add Purchase
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">SKU Search</Label>
          <Input
            className="w-48"
            placeholder="Search by SKU name…"
            value={filterSku}
            onChange={e => setFilterSku(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Warehouse</Label>
          <Select value={filterWarehouse} onValueChange={setFilterWarehouse}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All warehouses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All warehouses</SelectItem>
              {warehouses.map(w => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
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
        {(filterWarehouse || filterFrom || filterTo || filterSku) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFilterWarehouse(''); setFilterFrom(''); setFilterTo(''); setFilterSku('') }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Master SKU</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Pkg Cost</TableHead>
                <TableHead className="text-right">Other</TableHead>
                <TableHead className="text-right font-semibold">Total COGS</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Received</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 11 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : purchases.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                    No purchases found. Add your first purchase above.
                  </TableCell>
                </TableRow>
              ) : (
                purchases.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="tabular-nums text-sm">{p.purchase_date}</TableCell>
                    <TableCell className="font-medium">{p.master_skus?.name ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{p.warehouses?.name ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">₹{fmt(p.unit_cost)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">₹{fmt(p.packaging_cost)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">₹{fmt(p.other_cost)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">₹{fmt(p.total_cogs)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{p.supplier ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.received_date ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(p.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Totals row */}
      {purchases.length > 0 && (
        <div className="flex items-center gap-6 px-4 py-3 bg-muted/50 rounded-lg text-sm">
          <span className="text-muted-foreground">
            {purchases.length} record{purchases.length !== 1 ? 's' : ''}
          </span>
          <Separator orientation="vertical" className="h-4" />
          <span>Total units: <span className="font-semibold tabular-nums">{fmt(totals.qty)}</span></span>
          <Separator orientation="vertical" className="h-4" />
          <span className="flex items-center gap-1">
            Total COGS:
            <span className="font-semibold tabular-nums ml-1">₹{fmt(totals.cogs)}</span>
          </span>
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Purchase' : 'Add Purchase'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* SKU */}
            <div className="space-y-1">
              <Label>Master SKU <span className="text-destructive">*</span></Label>
              <Select value={form.master_sku_id} onValueChange={v => setField('master_sku_id', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select SKU…" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {skus.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Warehouse + Qty */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Warehouse <span className="text-destructive">*</span></Label>
                <Select value={form.warehouse_id} onValueChange={v => setField('warehouse_id', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map(w => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Quantity <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="0"
                  value={form.quantity}
                  onChange={e => setField('quantity', e.target.value)}
                />
              </div>
            </div>

            {/* Costs */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Unit Cost (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  value={form.unit_cost}
                  onChange={e => setField('unit_cost', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Packaging (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  value={form.packaging_cost}
                  onChange={e => setField('packaging_cost', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Other (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0.00"
                  value={form.other_cost}
                  onChange={e => setField('other_cost', e.target.value)}
                />
              </div>
            </div>

            {/* Live COGS preview */}
            {(form.unit_cost || form.packaging_cost || form.other_cost) && (
              <div className="flex items-center gap-2 text-sm bg-muted/50 px-3 py-2 rounded">
                <IndianRupee className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Total COGS:</span>
                <span className="font-semibold">
                  ₹{fmt(
                    (Number(form.unit_cost) || 0) +
                    (Number(form.packaging_cost) || 0) +
                    (Number(form.other_cost) || 0)
                  )}
                </span>
                {form.quantity && Number(form.quantity) > 1 && (
                  <span className="text-muted-foreground ml-auto">
                    × {form.quantity} units = ₹{fmt(
                      ((Number(form.unit_cost) || 0) +
                      (Number(form.packaging_cost) || 0) +
                      (Number(form.other_cost) || 0)) * Number(form.quantity)
                    )}
                  </span>
                )}
              </div>
            )}

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Purchase Date <span className="text-destructive">*</span></Label>
                <Input
                  type="date"
                  value={form.purchase_date}
                  onChange={e => setField('purchase_date', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Received Date</Label>
                <Input
                  type="date"
                  value={form.received_date}
                  onChange={e => setField('received_date', e.target.value)}
                />
              </div>
            </div>

            {/* Supplier */}
            <div className="space-y-1">
              <Label className="text-xs">Supplier <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                placeholder="e.g. ABC Textiles"
                value={form.supplier}
                onChange={e => setField('supplier', e.target.value)}
              />
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
    </div>
  )
}
