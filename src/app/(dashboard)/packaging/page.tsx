'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { InfoTooltip } from '@/components/ui/info-tooltip'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PackagingMaterial {
  id: string
  tenant_id: string
  name: string
  unit: string
  unit_cost: number
  created_at: string
  updated_at: string
}

interface SkuPackagingConfig {
  id: string
  tenant_id: string
  master_sku_id: string
  packaging_material_id: string
  qty_per_dispatch: number
  created_at: string
  packaging_materials: {
    id: string
    name: string
    unit: string
    unit_cost: number
  }
}

interface MasterSku {
  id: string
  name: string
  variants?: MasterSku[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)
}

// ── Empty form shapes ─────────────────────────────────────────────────────────

const emptyMaterialForm = { name: '', unit: '', unit_cost: '' }
const emptySpecForm = { master_sku_id: '', packaging_material_id: '', qty_per_dispatch: '' }

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PackagingPage() {
  // ── Materials state ──────────────────────────────────────────────────────────
  const [materialsList, setMaterialsList] = useState<PackagingMaterial[]>([])
  const [materialsLoading, setMaterialsLoading] = useState(true)
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false)
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null)
  const [materialForm, setMaterialForm] = useState(emptyMaterialForm)
  const [materialSaving, setMaterialSaving] = useState(false)

  // ── SKU Specs state ──────────────────────────────────────────────────────────
  const [skuConfigs, setSkuConfigs] = useState<SkuPackagingConfig[]>([])
  const [skuConfigsLoading, setSkuConfigsLoading] = useState(true)
  const [masterSkus, setMasterSkus] = useState<MasterSku[]>([])
  const [specDialogOpen, setSpecDialogOpen] = useState(false)
  const [editingSpecId, setEditingSpecId] = useState<string | null>(null)
  const [specForm, setSpecForm] = useState(emptySpecForm)
  const [specSaving, setSpecSaving] = useState(false)

  // ── Field setters ─────────────────────────────────────────────────────────────

  function setMaterialField<K extends keyof typeof emptyMaterialForm>(
    key: K,
    value: (typeof emptyMaterialForm)[K],
  ) {
    setMaterialForm(prev => ({ ...prev, [key]: value }))
  }

  function setSpecField<K extends keyof typeof emptySpecForm>(
    key: K,
    value: (typeof emptySpecForm)[K],
  ) {
    setSpecForm(prev => ({ ...prev, [key]: value }))
  }

  // ── Load functions ────────────────────────────────────────────────────────────

  async function loadMaterials() {
    setMaterialsLoading(true)
    try {
      const res = await fetch('/api/packaging/materials')
      if (!res.ok) throw new Error('Failed to load')
      setMaterialsList(await res.json())
    } catch {
      toast.error('Failed to load packaging materials')
    } finally {
      setMaterialsLoading(false)
    }
  }

  async function loadSkuConfigs() {
    setSkuConfigsLoading(true)
    try {
      const res = await fetch('/api/packaging/sku-config')
      if (!res.ok) throw new Error('Failed to load')
      setSkuConfigs(await res.json())
    } catch {
      toast.error('Failed to load SKU packaging specs')
    } finally {
      setSkuConfigsLoading(false)
    }
  }

  async function loadMasterSkus() {
    try {
      const res = await fetch('/api/catalog/master-skus')
      if (!res.ok) throw new Error('Failed to load')
      const data: MasterSku[] = await res.json()
      setMasterSkus(data.flatMap(sku => [sku, ...(sku.variants ?? [])]))
    } catch {
      toast.error('Failed to load SKU list')
    }
  }

  useEffect(() => {
    loadMaterials()
    loadSkuConfigs()
    loadMasterSkus()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Materials dialog ──────────────────────────────────────────────────────────

  function openAddMaterial() {
    setEditingMaterialId(null)
    setMaterialForm(emptyMaterialForm)
    setMaterialDialogOpen(true)
  }

  function openEditMaterial(m: PackagingMaterial) {
    setEditingMaterialId(m.id)
    setMaterialForm({ name: m.name, unit: m.unit, unit_cost: String(m.unit_cost) })
    setMaterialDialogOpen(true)
  }

  async function handleSaveMaterial() {
    if (!materialForm.name.trim()) return toast.error('Name is required')
    if (!materialForm.unit.trim()) return toast.error('Unit is required')
    if (!materialForm.unit_cost || Number(materialForm.unit_cost) < 0)
      return toast.error('Unit cost must be 0 or more')

    setMaterialSaving(true)
    try {
      const payload = {
        ...(editingMaterialId ? { id: editingMaterialId } : {}),
        name: materialForm.name.trim(),
        unit: materialForm.unit.trim(),
        unit_cost: Number(materialForm.unit_cost),
      }
      const res = await fetch('/api/packaging/materials', {
        method: editingMaterialId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Failed to save')
        return
      }
      toast.success(editingMaterialId ? 'Material updated' : 'Material added')
      setMaterialDialogOpen(false)
      loadMaterials()
    } finally {
      setMaterialSaving(false)
    }
  }

  async function handleDeleteMaterial(id: string) {
    if (!confirm('Delete this packaging material? This will also remove any SKU specs using it.')) return
    const res = await fetch('/api/packaging/materials', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      toast.success('Material deleted')
      loadMaterials()
      loadSkuConfigs()
    } else {
      toast.error('Failed to delete material')
    }
  }

  // ── SKU Specs dialog ──────────────────────────────────────────────────────────

  function openAddSpec() {
    setEditingSpecId(null)
    setSpecForm(emptySpecForm)
    setSpecDialogOpen(true)
  }

  function openEditSpec(s: SkuPackagingConfig) {
    setEditingSpecId(s.id)
    setSpecForm({
      master_sku_id: s.master_sku_id,
      packaging_material_id: s.packaging_material_id,
      qty_per_dispatch: String(s.qty_per_dispatch),
    })
    setSpecDialogOpen(true)
  }

  async function handleSaveSpec() {
    if (!specForm.master_sku_id) return toast.error('SKU is required')
    if (!specForm.packaging_material_id) return toast.error('Material is required')
    if (!specForm.qty_per_dispatch || Number(specForm.qty_per_dispatch) <= 0)
      return toast.error('Qty per dispatch must be greater than 0')

    setSpecSaving(true)
    try {
      const payload = editingSpecId
        ? { id: editingSpecId, qty_per_dispatch: Number(specForm.qty_per_dispatch) }
        : {
            master_sku_id: specForm.master_sku_id,
            packaging_material_id: specForm.packaging_material_id,
            qty_per_dispatch: Number(specForm.qty_per_dispatch),
          }
      const res = await fetch('/api/packaging/sku-config', {
        method: editingSpecId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Failed to save')
        return
      }
      toast.success(editingSpecId ? 'Spec updated' : 'Spec added')
      setSpecDialogOpen(false)
      loadSkuConfigs()
    } finally {
      setSpecSaving(false)
    }
  }

  async function handleDeleteSpec(id: string) {
    if (!confirm('Delete this SKU packaging spec?')) return
    const res = await fetch('/api/packaging/sku-config', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      toast.success('Spec deleted')
      loadSkuConfigs()
    } else {
      toast.error('Failed to delete spec')
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Packaging</h1>
        <p className="text-sm text-muted-foreground">
          Manage packaging materials and per-SKU usage specs
        </p>
      </div>

      <Tabs defaultValue="materials">
        <TabsList>
          <TabsTrigger value="materials">Materials</TabsTrigger>
          <TabsTrigger value="sku-specs">SKU Specs</TabsTrigger>
        </TabsList>

        {/* ── Materials Tab ────────────────────────────────────────────────────── */}
        <TabsContent value="materials" className="space-y-3 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={openAddMaterial}>
              <Plus className="h-4 w-4 mr-1" /> Add Material
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right"><span className="inline-flex items-center gap-1">Unit Cost (&#x20b9;)<InfoTooltip content="Cost per single unit of this packaging material (per piece, per meter, etc.)" /></span></TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {materialsLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : materialsList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No packaging materials yet
                    </TableCell>
                  </TableRow>
                ) : (
                  materialsList.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className="text-sm font-medium">{m.name}</TableCell>
                      <TableCell className="text-sm">{m.unit}</TableCell>
                      <TableCell className="text-right text-sm">&#x20b9;{fmt(m.unit_cost)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openEditMaterial(m)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteMaterial(m.id)}
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
          </div>
        </TabsContent>

        {/* ── SKU Specs Tab ────────────────────────────────────────────────────── */}
        <TabsContent value="sku-specs" className="space-y-3 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={openAddSpec}>
              <Plus className="h-4 w-4 mr-1" /> Add Spec
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right"><span className="inline-flex items-center gap-1">Qty per Dispatch<InfoTooltip content="How many units of this packaging material are used each time you ship one order of this product" /></span></TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {skuConfigsLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : skuConfigs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No SKU packaging specs yet
                    </TableCell>
                  </TableRow>
                ) : (
                  skuConfigs.map(s => {
                    const sku = masterSkus.find(sk => sk.id === s.master_sku_id)
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm font-medium">
                          {sku?.name ?? <span className="font-mono text-xs text-muted-foreground">{s.master_sku_id}</span>}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {s.packaging_materials.name}
                        </TableCell>
                        <TableCell className="text-sm">{s.packaging_materials.unit}</TableCell>
                        <TableCell className="text-right text-sm">
                          {fmt(s.qty_per_dispatch)}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => openEditSpec(s)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteSpec(s.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Add / Edit Material Dialog ──────────────────────────────────────── */}
      <Dialog open={materialDialogOpen} onOpenChange={setMaterialDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingMaterialId ? 'Edit Packaging Material' : 'Add Packaging Material'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label className="text-xs">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. Bubble Wrap, Corrugated Box"
                value={materialForm.name}
                onChange={e => setMaterialField('name', e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">
                Unit <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. pcs, kg, m"
                value={materialForm.unit}
                onChange={e => setMaterialField('unit', e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">
                Unit Cost (&#x20b9;) <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={materialForm.unit_cost}
                onChange={e => setMaterialField('unit_cost', e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMaterialDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveMaterial} disabled={materialSaving}>
              {materialSaving ? 'Saving...' : editingMaterialId ? 'Save Changes' : 'Add Material'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* ── Add / Edit SKU Spec Dialog ──────────────────────────────────────── */}
      <Dialog open={specDialogOpen} onOpenChange={setSpecDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingSpecId ? 'Edit SKU Packaging Spec' : 'Add SKU Packaging Spec'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label className="text-xs">
                SKU <span className="text-destructive">*</span>
              </Label>
              <Select
                value={specForm.master_sku_id}
                onValueChange={v => setSpecField('master_sku_id', v)}
                disabled={!!editingSpecId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a SKU..." />
                </SelectTrigger>
                <SelectContent>
                  {masterSkus.map(sku => (
                    <SelectItem key={sku.id} value={sku.id}>
                      {sku.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingSpecId && (
                <p className="text-xs text-muted-foreground">SKU cannot be changed when editing</p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">
                Material <span className="text-destructive">*</span>
              </Label>
              <Select
                value={specForm.packaging_material_id}
                onValueChange={v => setSpecField('packaging_material_id', v)}
                disabled={!!editingSpecId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a material..." />
                </SelectTrigger>
                <SelectContent>
                  {materialsList.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} ({m.unit}) &mdash; &#x20b9;{fmt(m.unit_cost)}/{m.unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingSpecId && (
                <p className="text-xs text-muted-foreground">Material cannot be changed when editing</p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">
                Qty per Dispatch <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min={0.001}
                step="0.001"
                placeholder="e.g. 1, 2, 0.5"
                value={specForm.qty_per_dispatch}
                onChange={e => setSpecField('qty_per_dispatch', e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSpecDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveSpec} disabled={specSaving}>
              {specSaving ? 'Saving...' : editingSpecId ? 'Save Changes' : 'Add Spec'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
