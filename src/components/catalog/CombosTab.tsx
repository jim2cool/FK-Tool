'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { toast } from 'sonner'
import { Link2, Package, Pencil, Plus, Trash2, X } from 'lucide-react'

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

interface MarketplaceAccount {
  id: string
  account_name: string
  platform: string
}

// ── Component ─────────────────────────────────────────────────────

export function CombosTab() {
  const [combos, setCombos] = useState<Combo[]>([])
  const [masterSkus, setMasterSkus] = useState<MasterSkuOption[]>([])
  const [accounts, setAccounts] = useState<MarketplaceAccount[]>([])
  const [loading, setLoading] = useState(true)

  // Create/edit combo dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [comboName, setComboName] = useState('')
  const [components, setComponents] = useState<Array<{ masterSkuId: string; quantity: number }>>([])
  const [saving, setSaving] = useState(false)

  // Add mapping dialog
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false)
  const [mappingComboId, setMappingComboId] = useState<string | null>(null)
  const [mappingComboName, setMappingComboName] = useState('')
  const [mappingChannel, setMappingChannel] = useState('')
  const [mappingAccountName, setMappingAccountName] = useState('')
  const [mappingSkuId, setMappingSkuId] = useState('')
  const [mappingSaving, setMappingSaving] = useState(false)
  const [mappingError, setMappingError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [combosRes, skusRes, accountsRes] = await Promise.all([
        fetch('/api/catalog/combos'),
        fetch('/api/catalog/master-skus'),
        fetch('/api/marketplace-accounts'),
      ])
      if (!combosRes.ok) throw new Error('Failed to fetch combos')
      if (!skusRes.ok) throw new Error('Failed to fetch catalog')
      if (!accountsRes.ok) throw new Error('Failed to fetch accounts')
      const combosData: Combo[] = await combosRes.json()
      const skusData = await skusRes.json()
      const accountsData: MarketplaceAccount[] = await accountsRes.json()

      setCombos(combosData ?? [])
      setAccounts(accountsData ?? [])

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

  // ── Combo create/edit ───────────────────────────────────────────

  function openCreate() {
    setEditingId(null)
    setComboName('')
    setComponents([{ masterSkuId: '', quantity: 1 }])
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
    if (components.length <= 1) return
    setComponents(prev => prev.filter((_, i) => i !== index))
  }

  function updateComponent(index: number, field: 'masterSkuId' | 'quantity', value: string | number) {
    setComponents(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c))
  }

  async function handleSave() {
    if (!comboName.trim()) { toast.error('Combo name is required'); return }
    const validComponents = components.filter(c => c.masterSkuId && c.quantity > 0)
    if (!validComponents.length) { toast.error('A combo must have at least 1 component'); return }

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

  // ── Add mapping dialog ──────────────────────────────────────────

  function openAddMapping(combo: Combo) {
    setMappingComboId(combo.id)
    setMappingComboName(combo.name)
    setMappingChannel('')
    setMappingAccountName('')
    setMappingSkuId('')
    setMappingError('')
    setMappingDialogOpen(true)
  }

  const mappingChannelOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const a of accounts) seen.add(a.platform)
    return [...seen].sort()
  }, [accounts])

  const mappingAccountOptions = useMemo(() => {
    if (!mappingChannel) return accounts.map(a => a.account_name)
    return accounts.filter(a => a.platform === mappingChannel).map(a => a.account_name)
  }, [accounts, mappingChannel])

  async function handleAddMapping() {
    if (!mappingComboId) return
    if (!mappingSkuId.trim()) { setMappingError('Platform SKU ID is required'); return }
    if (!mappingChannel) { setMappingError('Channel is required'); return }
    if (!mappingAccountName) { setMappingError('Account is required'); return }

    const acct = accounts.find(a => a.platform === mappingChannel && a.account_name === mappingAccountName)
    if (!acct) { setMappingError(`Account '${mappingAccountName}' not found`); return }

    setMappingSaving(true)
    setMappingError('')
    try {
      const res = await fetch('/api/catalog/sku-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          combo_product_id: mappingComboId,
          platform: mappingChannel,
          platform_sku: mappingSkuId.trim(),
          marketplace_account_id: acct.id,
        }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        setMappingError(error ?? 'Failed to add mapping')
        return
      }
      toast.success('Mapping added')
      setMappingDialogOpen(false)
      await loadData()
    } catch (e) {
      setMappingError((e as Error).message)
    } finally {
      setMappingSaving(false)
    }
  }

  async function handleDeleteMapping(mappingId: string) {
    try {
      const res = await fetch('/api/catalog/sku-mappings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: mappingId }),
      })
      if (!res.ok) throw new Error('Failed to delete mapping')
      toast.success('Mapping removed')
      await loadData()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────

  function getAccountName(id: string | null) {
    if (!id) return null
    return accounts.find(a => a.id === id)?.account_name ?? null
  }

  function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1)
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
              <TableHead>
                <span className="flex items-center gap-1">
                  Platform SKU Mappings
                  <InfoTooltip content="Map channel SKU IDs to this combo. Each channel listing that sells this combo should be mapped here." />
                </span>
              </TableHead>
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
                  <div className="space-y-1.5">
                    {combo.skuMappings.map(m => (
                      <div key={m.id} className="flex items-center gap-2 group/m">
                        <Badge variant="secondary" className="text-xs font-medium shrink-0">
                          {capitalize(m.platform)}
                        </Badge>
                        <span className="text-sm text-muted-foreground shrink-0">
                          {getAccountName(m.marketplaceAccountId) ?? '—'}
                        </span>
                        <span className="font-mono text-sm truncate">
                          {m.platformSku}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 opacity-0 group-hover/m:opacity-60 hover:!opacity-100 transition-opacity shrink-0 ml-auto text-red-500 hover:text-red-600"
                          onClick={() => handleDeleteMapping(m.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-muted-foreground hover:text-foreground px-1.5"
                      onClick={() => openAddMapping(combo)}
                    >
                      <Link2 className="h-3 w-3 mr-1" />
                      Add Mapping
                    </Button>
                  </div>
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

      {/* Create / Edit Combo Dialog */}
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
                      disabled={components.length <= 1}
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

      {/* Add Mapping Dialog */}
      <Dialog open={mappingDialogOpen} onOpenChange={setMappingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Map Platform SKU → {mappingComboName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Channel</Label>
              <Select
                value={mappingChannel || '__none__'}
                onValueChange={v => {
                  setMappingChannel(v === '__none__' ? '' : v)
                  setMappingAccountName('')
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select channel…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select channel…</SelectItem>
                  {mappingChannelOptions.map(c => (
                    <SelectItem key={c} value={c}>{capitalize(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Account</Label>
              <Select
                value={mappingAccountName || '__none__'}
                onValueChange={v => setMappingAccountName(v === '__none__' ? '' : v)}
                disabled={!mappingChannel}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select account…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select account…</SelectItem>
                  {mappingAccountOptions.map(a => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Platform SKU ID</Label>
              <Input
                className="font-mono"
                value={mappingSkuId}
                onChange={e => setMappingSkuId(e.target.value)}
                placeholder="e.g. COMBO-SOAP-3PK"
              />
            </div>

            {mappingError && (
              <p className="text-sm text-destructive">{mappingError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMappingDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddMapping} disabled={mappingSaving}>
              {mappingSaving ? 'Adding…' : 'Add Mapping'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
