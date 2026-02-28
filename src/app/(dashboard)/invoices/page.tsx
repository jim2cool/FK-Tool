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
import { format, parseISO } from 'date-fns'

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Constants ─────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const [freightInvoices, setFreightInvoices] = useState<FreightInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyFreightForm)
  const [saving, setSaving] = useState(false)

  function setField<K extends keyof typeof emptyFreightForm>(key: K, value: (typeof emptyFreightForm)[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  // ── Load ────────────────────────────────────────────────────────────────────

  async function loadFreight() {
    setLoading(true)
    try {
      const res = await fetch('/api/freight-invoices')
      if (!res.ok) throw new Error('Failed to load')
      setFreightInvoices(await res.json())
    } catch {
      toast.error('Failed to load freight invoices')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadFreight() }, [])

  // ── Dialog ──────────────────────────────────────────────────────────────────

  function openAdd() {
    setEditingId(null)
    setForm(emptyFreightForm)
    setDialogOpen(true)
  }

  function openEdit(f: FreightInvoice) {
    setEditingId(f.id)
    setForm({
      purchase_invoice_number: f.purchase_invoice_number,
      freight_invoice_number: f.freight_invoice_number ?? '',
      vendor: f.vendor ?? '',
      freight_date: f.freight_date,
      total_amount: String(f.total_amount),
      tax_paid: f.tax_paid ? 'Y' : 'N',
      gst_rate_slab: f.gst_rate_slab,
      notes: f.notes ?? '',
    })
    setDialogOpen(true)
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.purchase_invoice_number.trim()) return toast.error('Purchase Invoice # is required')
    if (!form.total_amount || Number(form.total_amount) <= 0) return toast.error('Amount must be > 0')
    if (!form.freight_date) return toast.error('Freight date is required')

    setSaving(true)
    try {
      const payload = {
        ...(editingId ? { id: editingId } : {}),
        purchase_invoice_number: form.purchase_invoice_number.trim(),
        freight_invoice_number: form.freight_invoice_number.trim() || null,
        vendor: form.vendor.trim() || null,
        freight_date: form.freight_date,
        total_amount: Number(form.total_amount),
        tax_paid: form.tax_paid === 'Y',
        gst_rate_slab: form.gst_rate_slab,
        notes: form.notes.trim() || null,
      }
      const res = await fetch('/api/freight-invoices', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Failed to save')
        return
      }
      toast.success(editingId ? 'Freight invoice updated' : 'Freight invoice added')
      setDialogOpen(false)
      loadFreight()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this freight invoice?')) return
    const res = await fetch('/api/freight-invoices', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) { toast.success('Deleted'); loadFreight() }
    else toast.error('Failed to delete')
  }

  // ── Footer totals ────────────────────────────────────────────────────────────

  const totals = useMemo(() => {
    let totalFreight = 0
    let totalGstNotCharged = 0
    for (const f of freightInvoices) {
      totalFreight += f.total_amount
      if (!f.tax_paid) totalGstNotCharged += calcGstAmount(f.total_amount, f.gst_rate_slab, false)
    }
    return { totalFreight, totalGstNotCharged }
  }, [freightInvoices])

  // ── Live GST preview ──────────────────────────────────────────────────────────

  const liveGst = useMemo(() => {
    const amt = Number(form.total_amount) || 0
    return calcGstAmount(amt, form.gst_rate_slab, form.tax_paid === 'Y')
  }, [form.total_amount, form.gst_rate_slab, form.tax_paid])

  // ── Render ───────────────────────────────────────────────────────────────────

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
          <TabsTrigger value="packaging" disabled>Packaging Materials (coming soon)</TabsTrigger>
        </TabsList>

        {/* ── Freight Tab ────────────────────────────────────────────────────── */}
        <TabsContent value="freight" className="space-y-3 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={openAdd}>
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
                  <TableHead>Tax Paid</TableHead>
                  <TableHead className="text-right">GST Amount (₹)</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
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
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(f)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(f.id)}>
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

          {/* Footer totals */}
          {freightInvoices.length > 0 && (
            <div className="flex justify-end gap-8 text-sm px-2">
              <span>Total freight: <span className="font-semibold">₹{fmt(totals.totalFreight)}</span></span>
              {totals.totalGstNotCharged > 0 && (
                <span className="text-amber-600">GST not charged: <span className="font-semibold">₹{fmt(totals.totalGstNotCharged)}</span></span>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Add / Edit Dialog ──────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Freight Invoice' : 'Add Freight Invoice'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {/* Purchase Invoice # */}
            <div className="space-y-1">
              <Label className="text-xs">Purchase Invoice # <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g. INV-2024-001"
                value={form.purchase_invoice_number}
                onChange={e => setField('purchase_invoice_number', e.target.value)} />
              <p className="text-xs text-muted-foreground">Match exactly to the Invoice # on your purchase records</p>
            </div>

            {/* Freight Invoice # */}
            <div className="space-y-1">
              <Label className="text-xs">Freight Invoice #</Label>
              <Input placeholder="e.g. KB-20260128-001 (self-generate for kaccha bills)"
                value={form.freight_invoice_number}
                onChange={e => setField('freight_invoice_number', e.target.value)} />
            </div>

            {/* Vendor */}
            <div className="space-y-1">
              <Label className="text-xs">Vendor (Courier / Transporter)</Label>
              <Input placeholder="e.g. DTDC, Delhivery"
                value={form.vendor}
                onChange={e => setField('vendor', e.target.value)} />
            </div>

            {/* Date + Amount */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Freight Date <span className="text-destructive">*</span></Label>
                <Input type="date" value={form.freight_date}
                  onChange={e => setField('freight_date', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Total Amount (₹) <span className="text-destructive">*</span></Label>
                <Input type="number" min={0} step="0.01" placeholder="0.00"
                  value={form.total_amount}
                  onChange={e => setField('total_amount', e.target.value)} />
              </div>
            </div>

            {/* Tax Paid + GST Rate */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tax Paid?</Label>
                <Select value={form.tax_paid} onValueChange={v => setField('tax_paid', v as 'Y' | 'N')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Y">Yes — already paid</SelectItem>
                    <SelectItem value="N">No — kaccha bill</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">GST Rate</Label>
                <Select value={form.gst_rate_slab} onValueChange={v => setField('gst_rate_slab', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GST_SLABS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Live GST preview */}
            {form.total_amount && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                {form.tax_paid === 'Y'
                  ? <>GST embedded in total: <span className="font-medium text-foreground">₹{fmt(liveGst)}</span> (reverse calc)</>
                  : <>Notional GST not charged: <span className="font-medium text-amber-600">₹{fmt(liveGst)}</span></>
                }
              </div>
            )}

            {/* Notes */}
            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Input placeholder="Optional"
                value={form.notes}
                onChange={e => setField('notes', e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
