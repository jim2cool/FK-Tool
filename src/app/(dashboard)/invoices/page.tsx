'use client'
import { useEffect, useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { format, parseISO } from 'date-fns'

// ── Types ─────────────────────────────────────────────────────────────────────────────────

interface FreightInvoice {
  id: string
  freight_invoice_number: string | null
  purchase_invoice_number: string
  vendor: string | null
  freight_date: string
  total_amount: number
  tax_paid: boolean
  gst_rate_slab: string
  notes: string | null
}

interface PackagingPurchase {
  id: string
  packaging_material_id: string
  invoice_number: string | null
  quantity: number
  unit_cost: number
  tax_paid: boolean
  gst_rate_slab: string
  vendor: string | null
  purchase_date: string
  created_at: string
  // joined:
  packaging_materials: { id: string; name: string; unit: string } | null
}

interface PackagingMaterial {
  id: string
  name: string
  unit: string
  unit_cost: number
}

// ── Constants ─────────────────────────────────────────────────────────────────────────────

const GST_SLABS = ['0%', '5%', '12%', '18%', '28%']

const emptyFreightForm = {
  purchase_invoice_number: '',
  freight_invoice_number: '',
  vendor: '',
  freight_date: format(new Date(), 'yyyy-MM-dd'),
  total_amount: '',
  tax_paid: 'N' as 'Y' | 'N',
  gst_rate_slab: '18%',
  notes: '',
}

const emptyPurchaseForm = {
  packaging_material_id: '',
  invoice_number: '',
  vendor: '',
  purchase_date: format(new Date(), 'yyyy-MM-dd'),
  quantity: '',
  unit_cost: '',
  tax_paid: 'N' as 'Y' | 'N',
  gst_rate_slab: '18%',
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)
}

function calcGstAmount(totalAmount: number, gstSlab: string, taxPaid: boolean) {
  const rate = parseFloat(gstSlab.replace('%', '')) || 0
  if (taxPaid) {
    // GST is embedded in the total — reverse calculation
    return (totalAmount * rate) / (100 + rate)
  } else {
    // Kaccha bill — GST not charged, shown as notional
    return (totalAmount * rate) / 100
  }
}

// ── Page ─────────────────────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  // ── Freight state ────────────────────────────────────────────────────────────────────────
  const [freightInvoices, setFreightInvoices] = useState<FreightInvoice[]>([])
  const [freightLoading, setFreightLoading] = useState(true)
  const [freightDialogOpen, setFreightDialogOpen] = useState(false)
  const [editingFreightId, setEditingFreightId] = useState<string | null>(null)
  const [freightForm, setFreightForm] = useState(emptyFreightForm)
  const [freightSaving, setFreightSaving] = useState(false)

  // ── Packaging state ──────────────────────────────────────────────────────────────────────
  const [packagingPurchases, setPackagingPurchases] = useState<PackagingPurchase[]>([])
  const [packagingLoading, setPackagingLoading] = useState(true)
  const [packagingDialogOpen, setPackagingDialogOpen] = useState(false)
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null)
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchaseForm)
  const [purchaseSaving, setPurchaseSaving] = useState(false)

  // ── Shared state ───────────────────────────────────────────────────────────────────────────
  const [materials, setMaterials] = useState<PackagingMaterial[]>([])

  function setFreightField<K extends keyof typeof emptyFreightForm>(key: K, value: (typeof emptyFreightForm)[K]) {
    setFreightForm(prev => ({ ...prev, [key]: value }))
  }

  function setPurchaseField<K extends keyof typeof emptyPurchaseForm>(key: K, value: (typeof emptyPurchaseForm)[K]) {
    setPurchaseForm(prev => ({ ...prev, [key]: value }))
  }

  // ── Load ──────────────────────────────────────────────────────────────────────────────────

  async function loadFreight() {
    setFreightLoading(true)
    try {
      const res = await fetch('/api/freight-invoices')
      if (!res.ok) throw new Error('Failed to load')
      setFreightInvoices(await res.json())
    } catch {
      toast.error('Failed to load freight invoices')
    } finally {
      setFreightLoading(false)
    }
  }

  async function loadPackagingPurchases() {
    setPackagingLoading(true)
    try {
      const res = await fetch('/api/packaging/purchases')
      if (!res.ok) throw new Error('Failed to load')
      setPackagingPurchases(await res.json())
    } catch {
      toast.error('Failed to load packaging purchases')
    } finally {
      setPackagingLoading(false)
    }
  }

  async function loadMaterials() {
    try {
      const res = await fetch('/api/packaging/materials')
      if (!res.ok) throw new Error('Failed to load')
      setMaterials(await res.json())
    } catch {
      toast.error('Failed to load packaging materials')
    }
  }

  useEffect(() => {
    loadFreight()
    loadPackagingPurchases()
    loadMaterials()
  }, [])

  // ── Freight Dialog ──────────────────────────────────────────────────────────────────────

  function openFreightAdd() {
    setEditingFreightId(null)
    setFreightForm(emptyFreightForm)
    setFreightDialogOpen(true)
  }

  function openFreightEdit(f: FreightInvoice) {
    setEditingFreightId(f.id)
    setFreightForm({
      purchase_invoice_number: f.purchase_invoice_number,
      freight_invoice_number: f.freight_invoice_number ?? '',
      vendor: f.vendor ?? '',
      freight_date: f.freight_date,
      total_amount: String(f.total_amount),
      tax_paid: f.tax_paid ? 'Y' : 'N',
      gst_rate_slab: f.gst_rate_slab,
      notes: f.notes ?? '',
    })
    setFreightDialogOpen(true)
  }

  // ── Freight Save / Delete ───────────────────────────────────────────────────────────────────

  async function handleFreightSave() {
    if (!freightForm.purchase_invoice_number.trim()) return toast.error('Purchase Invoice # is required')
    if (!freightForm.total_amount || Number(freightForm.total_amount) <= 0) return toast.error('Amount must be > 0')
    if (!freightForm.freight_date) return toast.error('Freight date is required')

    setFreightSaving(true)
    try {
      const payload = {
        ...(editingFreightId ? { id: editingFreightId } : {}),
        purchase_invoice_number: freightForm.purchase_invoice_number.trim(),
        freight_invoice_number: freightForm.freight_invoice_number.trim() || null,
        vendor: freightForm.vendor.trim() || null,
        freight_date: freightForm.freight_date,
        total_amount: Number(freightForm.total_amount),
        tax_paid: freightForm.tax_paid === 'Y',
        gst_rate_slab: freightForm.gst_rate_slab,
        notes: freightForm.notes.trim() || null,
      }
      const res = await fetch('/api/freight-invoices', {
        method: editingFreightId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Failed to save')
        return
      }
      toast.success(editingFreightId ? 'Freight invoice updated' : 'Freight invoice added')
      setFreightDialogOpen(false)
      loadFreight()
    } finally {
      setFreightSaving(false)
    }
  }

  async function handleFreightDelete(id: string) {
    if (!confirm('Delete this freight invoice?')) return
    const res = await fetch('/api/freight-invoices', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) { toast.success('Deleted'); loadFreight() }
    else toast.error('Failed to delete')
  }

  // ── Packaging Dialog ──────────────────────────────────────────────────────────────────────

  function openPackagingAdd() {
    setEditingPurchaseId(null)
    setPurchaseForm(emptyPurchaseForm)
    setPackagingDialogOpen(true)
  }

  function openPackagingEdit(p: PackagingPurchase) {
    setEditingPurchaseId(p.id)
    setPurchaseForm({
      packaging_material_id: p.packaging_material_id,
      invoice_number: p.invoice_number ?? '',
      vendor: p.vendor ?? '',
      purchase_date: p.purchase_date,
      quantity: String(p.quantity),
      unit_cost: String(p.unit_cost),
      tax_paid: p.tax_paid ? 'Y' : 'N',
      gst_rate_slab: p.gst_rate_slab,
    })
    setPackagingDialogOpen(true)
  }

  // ── Packaging Save / Delete ─────────────────────────────────────────────────────────────────

  async function handlePackagingSave() {
    if (!purchaseForm.packaging_material_id) return toast.error('Material is required')
    if (!purchaseForm.purchase_date) return toast.error('Date is required')
    if (!purchaseForm.quantity || Number(purchaseForm.quantity) <= 0) return toast.error('Quantity must be > 0')
    if (!purchaseForm.unit_cost || Number(purchaseForm.unit_cost) <= 0) return toast.error('Unit cost must be > 0')

    setPurchaseSaving(true)
    try {
      const payload = {
        ...(editingPurchaseId ? { id: editingPurchaseId } : {}),
        packaging_material_id: purchaseForm.packaging_material_id,
        invoice_number: purchaseForm.invoice_number.trim() || null,
        vendor: purchaseForm.vendor.trim() || null,
        purchase_date: purchaseForm.purchase_date,
        quantity: Number(purchaseForm.quantity),
        unit_cost: Number(purchaseForm.unit_cost),
        tax_paid: purchaseForm.tax_paid === 'Y',
        gst_rate_slab: purchaseForm.gst_rate_slab,
      }
      const res = await fetch('/api/packaging/purchases', {
        method: editingPurchaseId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Failed to save')
        return
      }
      toast.success(editingPurchaseId ? 'Packaging purchase updated' : 'Packaging purchase added')
      setPackagingDialogOpen(false)
      loadPackagingPurchases()
    } finally {
      setPurchaseSaving(false)
    }
  }

  async function handlePackagingDelete(id: string) {
    if (!confirm('Delete this packaging purchase?')) return
    const res = await fetch('/api/packaging/purchases', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) { toast.success('Deleted'); loadPackagingPurchases() }
    else toast.error('Failed to delete')
  }

  // ── Footer totals ────────────────────────────────────────────────────────────────────────────

  const freightTotals = useMemo(() => {
    let totalFreight = 0
    let totalGstNotCharged = 0
    for (const f of freightInvoices) {
      totalFreight += f.total_amount
      if (!f.tax_paid) totalGstNotCharged += calcGstAmount(f.total_amount, f.gst_rate_slab, false)
    }
    return { totalFreight, totalGstNotCharged }
  }, [freightInvoices])

  const packagingTotals = useMemo(() => {
    let totalSpend = 0
    let totalGstNotCharged = 0
    for (const p of packagingPurchases) {
      const lineTotal = p.quantity * p.unit_cost
      totalSpend += lineTotal
      if (!p.tax_paid) totalGstNotCharged += calcGstAmount(lineTotal, p.gst_rate_slab, false)
    }
    return { totalSpend, totalGstNotCharged }
  }, [packagingPurchases])

  // ── Live GST previews ─────────────────────────────────────────────────────────────────────────────

  const freightLiveGst = useMemo(() => {
    const amt = Number(freightForm.total_amount) || 0
    return calcGstAmount(amt, freightForm.gst_rate_slab, freightForm.tax_paid === 'Y')
  }, [freightForm.total_amount, freightForm.gst_rate_slab, freightForm.tax_paid])

  const packagingLiveGst = useMemo(() => {
    const lineTotal = (Number(purchaseForm.quantity) || 0) * (Number(purchaseForm.unit_cost) || 0)
    return calcGstAmount(lineTotal, purchaseForm.gst_rate_slab, purchaseForm.tax_paid === 'Y')
  }, [purchaseForm.quantity, purchaseForm.unit_cost, purchaseForm.gst_rate_slab, purchaseForm.tax_paid])

  const packagingLiveTotal = useMemo(() => {
    return (Number(purchaseForm.quantity) || 0) * (Number(purchaseForm.unit_cost) || 0)
  }, [purchaseForm.quantity, purchaseForm.unit_cost])

  // ── Render ───────────────────────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Invoices</h1>
          <p className="text-sm text-muted-foreground">Track freight and packaging material invoices</p>
        </div>
      </div>

      <Tabs defaultValue="freight">
        <TabsList>
          <TabsTrigger value="freight">Freight</TabsTrigger>
          <TabsTrigger value="packaging">Packaging Purchases</TabsTrigger>
        </TabsList>

        {/* ── Freight Tab ────────────────────────────────────────────────────────────────── */}
        <TabsContent value="freight" className="space-y-3 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={openFreightAdd}>
              <Plus className="h-4 w-4 mr-1" /> Add Freight Invoice
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Freight Invoice #</TableHead>
                  <TableHead>Purchase Invoice #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Amount (₹)</TableHead>
                  <TableHead>GST Rate</TableHead>
                  <TableHead><span className="inline-flex items-center gap-1">Tax Paid<InfoTooltip content="Whether GST was charged on this invoice. 'Paid' means you have input credit available. 'Not Charged' (kaccha bill) means no GST credit" /></span></TableHead>
                  <TableHead className="text-right"><span className="inline-flex items-center gap-1">GST Amount (₹)<InfoTooltip content="The GST component of this invoice. If tax was paid, this is claimable as input credit" /></span></TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {freightLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                ) : freightInvoices.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No freight invoices yet</TableCell></TableRow>
                ) : freightInvoices.map(f => {
                  const gstAmt = calcGstAmount(f.total_amount, f.gst_rate_slab, f.tax_paid)
                  return (
                    <TableRow key={f.id}>
                      <TableCell className="text-sm">{format(parseISO(f.freight_date), 'd MMM yyyy')}</TableCell>
                      <TableCell className="text-sm font-mono">{f.freight_invoice_number ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-sm font-mono">{f.purchase_invoice_number}</TableCell>
                      <TableCell className="text-sm">{f.vendor ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right text-sm font-medium">₹{fmt(f.total_amount)}</TableCell>
                      <TableCell><Badge variant="outline">{f.gst_rate_slab}</Badge></TableCell>
                      <TableCell>
                        {f.tax_paid
                          ? <Badge variant="secondary">Paid</Badge>
                          : <Badge variant="outline" className="text-amber-600 border-amber-300">Not Charged</Badge>}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {f.tax_paid
                          ? <span className="text-muted-foreground">₹{fmt(gstAmt)} <span className="text-xs">(incl.)</span></span>
                          : <span className="text-amber-600">₹{fmt(gstAmt)}</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openFreightEdit(f)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleFreightDelete(f.id)}>
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

          {/* Freight footer totals */}
          {freightInvoices.length > 0 && (
            <div className="flex justify-end gap-8 text-sm px-2">
              <span>Total freight: <span className="font-semibold">₹{fmt(freightTotals.totalFreight)}</span></span>
              {freightTotals.totalGstNotCharged > 0 && (
                <span className="text-amber-600">GST not charged: <span className="font-semibold">₹{fmt(freightTotals.totalGstNotCharged)}</span></span>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── Packaging Purchases Tab ─────────────────────────────────────────────────────── */}
        <TabsContent value="packaging" className="space-y-3 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={openPackagingAdd}>
              <Plus className="h-4 w-4 mr-1" /> Add Packaging Purchase
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit Cost (₹)</TableHead>
                  <TableHead className="text-right">Total (₹)</TableHead>
                  <TableHead>GST Rate</TableHead>
                  <TableHead><span className="inline-flex items-center gap-1">Tax Paid<InfoTooltip content="Whether GST was charged on this invoice. 'Paid' means you have input credit available. 'Not Charged' (kaccha bill) means no GST credit" /></span></TableHead>
                  <TableHead className="text-right"><span className="inline-flex items-center gap-1">GST Amount (₹)<InfoTooltip content="The GST component of this invoice. If tax was paid, this is claimable as input credit" /></span></TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {packagingLoading ? (
                  <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                ) : packagingPurchases.length === 0 ? (
                  <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-8">No packaging purchases yet</TableCell></TableRow>
                ) : packagingPurchases.map(p => {
                  const lineTotal = p.quantity * p.unit_cost
                  const gstAmt = calcGstAmount(lineTotal, p.gst_rate_slab, p.tax_paid)
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{format(parseISO(p.purchase_date), 'd MMM yyyy')}</TableCell>
                      <TableCell className="text-sm font-mono">{p.invoice_number ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-sm">{p.vendor ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-sm">{p.packaging_materials?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.packaging_materials?.unit ?? '—'}</TableCell>
                      <TableCell className="text-right text-sm">{fmt(p.quantity)}</TableCell>
                      <TableCell className="text-right text-sm">₹{fmt(p.unit_cost)}</TableCell>
                      <TableCell className="text-right text-sm font-medium">₹{fmt(lineTotal)}</TableCell>
                      <TableCell><Badge variant="outline">{p.gst_rate_slab}</Badge></TableCell>
                      <TableCell>
                        {p.tax_paid
                          ? <Badge variant="secondary">Paid</Badge>
                          : <Badge variant="outline" className="text-amber-600 border-amber-300">Not Charged</Badge>}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {p.tax_paid
                          ? <span className="text-muted-foreground">₹{fmt(gstAmt)} <span className="text-xs">(incl.)</span></span>
                          : <span className="text-amber-600">₹{fmt(gstAmt)}</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openPackagingEdit(p)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handlePackagingDelete(p.id)}>
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

          {/* Packaging footer totals */}
          {packagingPurchases.length > 0 && (
            <div className="flex justify-end gap-8 text-sm px-2">
              <span>Total spend: <span className="font-semibold">₹{fmt(packagingTotals.totalSpend)}</span></span>
              {packagingTotals.totalGstNotCharged > 0 && (
                <span className="text-amber-600">GST not charged: <span className="font-semibold">₹{fmt(packagingTotals.totalGstNotCharged)}</span></span>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Freight Add / Edit Dialog ─────────────────────────────────────────────────────────── */}
      <Dialog open={freightDialogOpen} onOpenChange={setFreightDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingFreightId ? 'Edit Freight Invoice' : 'Add Freight Invoice'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {/* Purchase Invoice # */}
            <div className="space-y-1">
              <Label className="text-xs">Purchase Invoice # <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g. INV-2024-001"
                value={freightForm.purchase_invoice_number}
                onChange={e => setFreightField('purchase_invoice_number', e.target.value)} />
              <p className="text-xs text-muted-foreground">Match exactly to the Invoice # on your purchase records</p>
            </div>

            {/* Freight Invoice # */}
            <div className="space-y-1">
              <Label className="text-xs">Freight Invoice #</Label>
              <Input placeholder="e.g. KB-20260128-001 (self-generate for kaccha bills)"
                value={freightForm.freight_invoice_number}
                onChange={e => setFreightField('freight_invoice_number', e.target.value)} />
            </div>

            {/* Vendor */}
            <div className="space-y-1">
              <Label className="text-xs">Vendor (Courier / Transporter)</Label>
              <Input placeholder="e.g. DTDC, Delhivery"
                value={freightForm.vendor}
                onChange={e => setFreightField('vendor', e.target.value)} />
            </div>

            {/* Date + Amount */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Freight Date <span className="text-destructive">*</span></Label>
                <Input type="date" value={freightForm.freight_date}
                  onChange={e => setFreightField('freight_date', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Total Amount (₹) <span className="text-destructive">*</span></Label>
                <Input type="number" min={0} step="0.01" placeholder="0.00"
                  value={freightForm.total_amount}
                  onChange={e => setFreightField('total_amount', e.target.value)} />
              </div>
            </div>

            {/* Tax Paid + GST Rate */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tax Paid?</Label>
                <Select value={freightForm.tax_paid} onValueChange={v => setFreightField('tax_paid', v as 'Y' | 'N')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Y">Yes — already paid</SelectItem>
                    <SelectItem value="N">No — kaccha bill</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">GST Rate</Label>
                <Select value={freightForm.gst_rate_slab} onValueChange={v => setFreightField('gst_rate_slab', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GST_SLABS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Live GST preview */}
            {freightForm.total_amount && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                {freightForm.tax_paid === 'Y'
                  ? <>GST embedded in total: <span className="font-medium text-foreground">₹{fmt(freightLiveGst)}</span> (reverse calc)</>
                  : <>Notional GST not charged: <span className="font-medium text-amber-600">₹{fmt(freightLiveGst)}</span></>
                }
              </div>
            )}

            {/* Notes */}
            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Input placeholder="Optional"
                value={freightForm.notes}
                onChange={e => setFreightField('notes', e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFreightDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleFreightSave} disabled={freightSaving}>
              {freightSaving ? 'Saving…' : editingFreightId ? 'Save Changes' : 'Add Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Packaging Add / Edit Dialog ───────────────────────────────────────────────────────────── */}
      <Dialog open={packagingDialogOpen} onOpenChange={setPackagingDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPurchaseId ? 'Edit Packaging Purchase' : 'Add Packaging Purchase'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {/* Material */}
            <div className="space-y-1">
              <Label className="text-xs">Material <span className="text-destructive">*</span></Label>
              <Select value={purchaseForm.packaging_material_id} onValueChange={v => setPurchaseField('packaging_material_id', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a material…" />
                </SelectTrigger>
                <SelectContent>
                  {materials.length === 0
                    ? <SelectItem value="__none" disabled>No materials found — add from Packaging page</SelectItem>
                    : materials.map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.name} ({m.unit})</SelectItem>
                      ))
                  }
                </SelectContent>
              </Select>
            </div>

            {/* Invoice # */}
            <div className="space-y-1">
              <Label className="text-xs">Invoice #</Label>
              <Input placeholder="e.g. KB-20260128-001"
                value={purchaseForm.invoice_number}
                onChange={e => setPurchaseField('invoice_number', e.target.value)} />
            </div>

            {/* Vendor */}
            <div className="space-y-1">
              <Label className="text-xs">Vendor</Label>
              <Input placeholder="e.g. Uline, local market"
                value={purchaseForm.vendor}
                onChange={e => setPurchaseField('vendor', e.target.value)} />
            </div>

            {/* Date */}
            <div className="space-y-1">
              <Label className="text-xs">Date <span className="text-destructive">*</span></Label>
              <Input type="date" value={purchaseForm.purchase_date}
                onChange={e => setPurchaseField('purchase_date', e.target.value)} />
            </div>

            {/* Qty + Unit Cost */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Quantity <span className="text-destructive">*</span></Label>
                <Input type="number" min={0.001} step="0.001" placeholder="0"
                  value={purchaseForm.quantity}
                  onChange={e => setPurchaseField('quantity', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Unit Cost (₹) <span className="text-destructive">*</span></Label>
                <Input type="number" min={0} step="0.01" placeholder="0.00"
                  value={purchaseForm.unit_cost}
                  onChange={e => setPurchaseField('unit_cost', e.target.value)} />
              </div>
            </div>

            {/* Tax Paid + GST Rate */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tax Paid?</Label>
                <Select value={purchaseForm.tax_paid} onValueChange={v => setPurchaseField('tax_paid', v as 'Y' | 'N')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Y">Yes — already paid</SelectItem>
                    <SelectItem value="N">No — kaccha bill</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">GST Rate</Label>
                <Select value={purchaseForm.gst_rate_slab} onValueChange={v => setPurchaseField('gst_rate_slab', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GST_SLABS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Live GST + total preview */}
            {purchaseForm.quantity && purchaseForm.unit_cost && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
                <div>Line total: <span className="font-medium text-foreground">₹{fmt(packagingLiveTotal)}</span></div>
                <div>
                  {purchaseForm.tax_paid === 'Y'
                    ? <>GST embedded in total: <span className="font-medium text-foreground">₹{fmt(packagingLiveGst)}</span> (reverse calc)</>
                    : <>Notional GST not charged: <span className="font-medium text-amber-600">₹{fmt(packagingLiveGst)}</span></>
                  }
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPackagingDialogOpen(false)}>Cancel</Button>
            <Button onClick={handlePackagingSave} disabled={purchaseSaving}>
              {purchaseSaving ? 'Saving…' : editingPurchaseId ? 'Save Changes' : 'Add Purchase'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
