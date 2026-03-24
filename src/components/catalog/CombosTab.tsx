'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { toast } from 'sonner'
import { Package, Pencil, Plus, Trash2, X } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────

interface ComboComponent {
  id?: string
  masterSkuId: string
  masterSkuName: string
  quantity: number
}

interface ComboSkuMapping {
  id: string
  platform: string
  platformSku: string
  marketplaceAccountId: string | null
}

interface Combo {
  id: string
  name: string
  is_archived: boolean
  created_at: string
  components: ComboComponent[]
  skuMappings: ComboSkuMapping[]
}

interface MasterSkuOption {
  id: string
  name: string
}

// ── Component ─────────────────────────────────────────────────────

export function CombosTab() {
  const [combos, setCombos] = useState<Combo[]>([])
  const [masterSkus, setMasterSkus] = useState<MasterSkuOption[]>([])
  const [loading, setLoading] = useState(true)

  // Create/edit dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [comboName, setComboName] = useState('')
  const [components, setComponents] = useState<Array<{ masterSkuId: string; quantity: number }>>([])
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [combosRes, skusRes] = await Promise.all([
        fetch('/api/catalog/combos'),
        fetch('/api/catalog/master-skus'),
      ])
      if (!combosRes.ok) throw new Error('Failed to fetch combos')
      if (!skusRes.ok) throw new Error('Failed to fetch catalog')
      const combosData: Combo[] = await combosRes.json()
      const skusData = await skusRes.json()

      setCombos(combosData ?? [])

      // Flatten master SKUs for the dropdown
      const flat: MasterSkuOption[] = (skusData ?? []).flatMap(
        (sku: { id: string; name: string; variants?: Array<{ id: string; name: string }> }) =>
          [{ id: sku.id, name: sku.name }, ...(sku.variants ?? []).map((v: { id: string; name: string }) => ({ id: v.id, name: v.name }))]
      )
      setMasterSkus(flat)
    } catch {
      toast.error('Failed to load combos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  function openCreate() {
    setEditingId(null)
    setComboName('')
    setComponents([{ masterSkuId: '', quantity: 1 }, { masterSkuId: '', quantity: 1 }])
    setDialogOpen(true)
  }

  function openEdit(combo: Combo) {
    setEditingId(combo.id)
    setComboName(combo.name)
    setComponents(combo.components.map(c => ({ masterSkuId: c.masterSkuId, quantity: c.quantity })))
    setDialogOpen(true)
  }

  function addComponent() {
    setComponents(prev => [...prev, { masterSkuId: '', quantity: 1 }])
  }

  function removeComponent(index: number) {
    if (components.length <= 2) return
    setComponents(prev => prev.filter((_, i) => i !== index))
  }

  function updateComponent(index: number, field: 'masterSkuId' | 'quantity', value: string | number) {
    setComponents(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c))
  }

  async function handleSave() {
    if (!comboName.trim()) { toast.error('Combo name is required'); return }
    const validComponents = components.filter(c => c.masterSkuId && c.quantity > 0)
    if (validComponents.length < 2) { toast.error('A combo must have at least 2 components'); return }

    // Check for duplicate master SKUs
    const skuIds = validComponents.map(c => c.masterSkuId)
    if (new Set(skuIds).size !== skuIds.length) { toast.error('Each component must be a different product'); return }

    setSaving(true)
    try {
      const body = editingId
        ? { id: editingId, name: comboName.trim(), components: validComponents.map(c => ({ master_sku_id: c.masterSkuId, quantity: c.quantity })) }
        : { name: comboName.trim(), components: validComponents.map(c => ({ master_sku_id: c.masterSkuId, quantity: c.quantity })) }

      const res = await fetch('/api/catalog/combos', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error ?? 'Failed to save combo')
      }

      toast.success(editingId ? 'Combo updated' : 'Combo created')
      setDialogOpen(false)
      await loadData()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(combo: Combo) {
    if (!confirm(`Delete combo "${combo.name}"? Any platform SKU mappings pointing to it will be unlinked.`)) return
    try {
      const res = await fetch('/api/catalog/combos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: combo.id }),
      })
      if (!res.ok) throw new Error('Failed to delete combo')
      toast.success(`Deleted "${combo.name}"`)
      await loadData()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  function getSkuName(id: string) {
    return masterSkus.find(s => s.id === id)?.name ?? 'Unknown'
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Loading combos...</div>
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            Define product bundles that are sold as a single listing on platforms
          </p>
          <InfoTooltip content="Combos let you map one platform SKU to multiple master products. When a combo is ordered, it's tracked as separate items for each component product." />
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Create Combo
        </Button>
      </div>

      {/* Empty state */}
      {combos.length === 0 && (
        <div className="border rounded-lg p-8 text-center text-muted-foreground">
          <Package className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p className="font-medium">No combos defined yet</p>
          <p className="text-sm mt-1">Create a combo to bundle multiple master products under one platform listing.</p>
        </div>
      )}

      {/* Combos table */}
      {combos.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Combo Name</TableHead>
              <TableHead>Components</TableHead>
              <TableHead>Platform SKU Mappings</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {combos.map(combo => (
              <TableRow key={combo.id}>
                <TableCell className="font-medium">{combo.name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {combo.components.map((c, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {c.quantity}x {c.masterSkuName}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  {combo.skuMappings.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No mappings</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {combo.skuMappings.map(m => (
                        <Badge key={m.id} variant="outline" className="text-xs font-mono">
                          {m.platformSku}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(combo)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => handleDelete(combo)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Combo' : 'Create Combo'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Combo Name</Label>
              <Input
                placeholder="e.g. Neem + Tulsi 3-Pack"
                value={comboName}
                onChange={e => setComboName(e.target.value)}
              />
            </div>

            <div>
              <Label className="flex items-center gap-1">
                Components
                <InfoTooltip content="Select which master products are included in this combo and how many of each." />
              </Label>
              <div className="space-y-2 mt-2">
                {components.map((comp, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Select value={comp.masterSkuId} onValueChange={v => updateComponent(index, 'masterSkuId', v)}>
                      <SelectTrigger className="flex-1 h-8 text-xs">
                        <SelectValue placeholder="Select product..." />
                      </SelectTrigger>
                      <SelectContent>
                        {masterSkus.map(sku => (
                          <SelectItem key={sku.id} value={sku.id}>{sku.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground">x</span>
                    <Input
                      type="number"
                      min={1}
                      className="w-16 h-8 text-xs"
                      value={comp.quantity}
                      onChange={e => updateComponent(index, 'quantity', parseInt(e.target.value) || 1)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      disabled={components.length <= 2}
                      onClick={() => removeComponent(index)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addComponent} className="text-xs">
                  <Plus className="h-3 w-3 mr-1" />
                  Add Component
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
