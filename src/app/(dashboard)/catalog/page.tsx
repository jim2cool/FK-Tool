'use client'
import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { SkuMappingDialog } from '@/components/catalog/SkuMappingDialog'
import { CsvImportDialog } from '@/components/catalog/CsvImportDialog'
import { toast } from 'sonner'
import { Plus, Search, Upload, X, AlertTriangle, Pencil, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Platform } from '@/types'

interface SkuMapping {
  id: string
  platform: Platform
  platform_sku: string
  marketplace_account_id: string | null
}

interface WarehouseSummary {
  warehouse_id: string
  warehouse_name: string
  location: string | null
  total_qty: number
  total_cogs: number
  avg_cogs: number
}

interface Variant {
  id: string
  name: string
  description: string | null
  parent_id: string
  variant_attributes: Record<string, string> | null
  is_archived: boolean
  created_at: string
  sku_mappings: SkuMapping[]
  warehouse_summaries: WarehouseSummary[]
}

interface MasterSku {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  variant_attributes: Record<string, string> | null
  is_archived: boolean
  created_at: string
  sku_mappings: SkuMapping[]
  warehouse_summaries: WarehouseSummary[]
  variants: Variant[]
}

interface Warehouse {
  id: string
  name: string
  location: string | null
}

interface MarketplaceAccount {
  id: string
  platform: Platform
  account_name: string
}

type EditingCell = { skuId: string; field: 'name' | 'description'; value: string }
type DisplayRow =
  | { sku: MasterSku; variant: Variant; isVariant: true }
  | { sku: MasterSku; variant: null; isVariant: false }

const PLATFORM_SHORT: Record<string, string> = {
  flipkart: 'FK',
  amazon: 'AMZ',
  d2c: 'D2C',
}

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'flipkart', label: 'Flipkart' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'd2c', label: 'D2C' },
]

export default function CatalogPage() {
  const [skus, setSkus] = useState<MasterSku[]>([])
  const [accounts, setAccounts] = useState<MarketplaceAccount[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [filterWarehouse, setFilterWarehouse] = useState('')
  const [filterPlatform, setFilterPlatform] = useState('')
  const [showUnmappedOnly, setShowUnmappedOnly] = useState(false)

  // Add SKU dialog
  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addDesc, setAddDesc] = useState('')
  const [addLoading, setAddLoading] = useState(false)

  // Inline editing
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  // Mapping dialog
  const [mappingSku, setMappingSku] = useState<MasterSku | null>(null)

  // CSV Import dialog
  const [csvImportOpen, setCsvImportOpen] = useState(false)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const fetchSkus = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (searchDebounced) params.set('search', searchDebounced)
      if (filterWarehouse) params.set('warehouse_id', filterWarehouse)
      if (filterPlatform) params.set('platform', filterPlatform)
      const res = await fetch(`/api/catalog/master-skus?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      setSkus(await res.json())
    } catch {
      toast.error('Failed to load catalog')
    } finally {
      setLoading(false)
    }
  }, [searchDebounced, filterWarehouse, filterPlatform])

  useEffect(() => { fetchSkus() }, [fetchSkus])

  useEffect(() => {
    Promise.all([
      fetch('/api/marketplace-accounts').then(r => r.json()),
      fetch('/api/warehouses').then(r => r.json()),
    ]).then(([a, w]) => {
      setAccounts(a)
      setWarehouses(w)
    }).catch(() => {})
  }, [])

  // Derived: count of unmapped SKUs/variants
  const unmappedCount = skus.reduce((n, sku) => {
    if (sku.variants.length > 0) {
      return n + sku.variants.filter(v => v.sku_mappings.length === 0).length
    }
    return sku.sku_mappings.length === 0 ? n + 1 : n
  }, 0)

  const hasFilters = !!filterWarehouse || !!filterPlatform

  async function handleAdd() {
    if (!addName.trim()) return toast.error('SKU name is required')
    setAddLoading(true)
    try {
      const res = await fetch('/api/catalog/master-skus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addName.trim(), description: addDesc.trim() || null }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Failed to create SKU')
        return
      }
      toast.success('Master SKU created')
      setAddName('')
      setAddDesc('')
      setAddOpen(false)
      fetchSkus()
    } finally {
      setAddLoading(false)
    }
  }

  async function handleInlineSave() {
    if (!editingCell) return
    if (!editingCell.value.trim() && editingCell.field === 'name') {
      return toast.error('SKU name cannot be empty')
    }
    setEditSaving(true)
    try {
      const res = await fetch('/api/catalog/master-skus', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingCell.skuId,
          [editingCell.field]: editingCell.value.trim() || null,
        }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Failed to update')
        return
      }
      await fetchSkus()
      setEditingCell(null)
    } finally {
      setEditSaving(false)
    }
  }

  // Inline editable cell — renders as text+pencil or input+save/cancel
  function renderEditableCell(
    skuId: string,
    field: 'name' | 'description',
    value: string | null,
    opts?: { bold?: boolean; small?: boolean }
  ) {
    const isEditing = editingCell?.skuId === skuId && editingCell?.field === field
    if (isEditing) {
      return (
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={editingCell.value}
            onChange={e => setEditingCell(c => c ? { ...c, value: e.target.value } : null)}
            onKeyDown={e => {
              if (e.key === 'Escape') setEditingCell(null)
              if (e.key === 'Enter') handleInlineSave()
            }}
            className="h-7 text-sm py-0 min-w-0"
          />
          <Button
            size="icon" variant="ghost" className="h-6 w-6 shrink-0"
            onClick={handleInlineSave} disabled={editSaving}
          >
            <Check className="h-3 w-3" />
          </Button>
          <Button
            size="icon" variant="ghost" className="h-6 w-6 shrink-0"
            onClick={() => setEditingCell(null)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )
    }
    return (
      <div className="group/cell flex items-center gap-1 min-w-0">
        <span className={cn(
          'truncate',
          opts?.bold ? 'font-medium text-sm' : 'text-sm text-muted-foreground',
          opts?.small && 'text-xs'
        )}>
          {value ?? '—'}
        </span>
        <button
          className="opacity-0 group-hover/cell:opacity-40 hover:!opacity-100 transition-opacity shrink-0"
          onClick={() => setEditingCell({ skuId, field, value: value ?? '' })}
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    )
  }

  // Build display rows: flat SKUs as-is, parents as one row per variant
  const displayRows: DisplayRow[] = skus.flatMap((sku): DisplayRow[] => {
    if (sku.variants.length > 0) {
      const rows = sku.variants.map(variant => ({ sku, variant, isVariant: true as const }))
      if (showUnmappedOnly) return rows.filter(r => r.variant.sku_mappings.length === 0)
      return rows
    }
    const row = { sku, variant: null, isVariant: false as const }
    if (showUnmappedOnly && sku.sku_mappings.length > 0) return []
    return [row]
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Master Catalog</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage master SKUs, platform mappings, and warehouse stock
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setCsvImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Bulk Import CSV
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Master SKU
          </Button>
        </div>
      </div>

      {/* Unmapped banner */}
      {!loading && unmappedCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{unmappedCount} SKU{unmappedCount !== 1 ? 's' : ''}</strong> have no platform
            mapping — they won&apos;t appear in channel reports.
          </span>
          <Button
            variant="link" size="sm"
            className="text-amber-800 h-auto p-0 underline underline-offset-2 ml-auto shrink-0"
            onClick={() => setShowUnmappedOnly(v => !v)}
          >
            {showUnmappedOnly ? 'Show all' : 'Filter to unmapped ↓'}
          </Button>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Search SKU</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9 w-52"
              placeholder="Search SKUs…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Warehouse</Label>
          <Select
            value={filterWarehouse || 'all'}
            onValueChange={v => setFilterWarehouse(v === 'all' ? '' : v)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All warehouses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All warehouses</SelectItem>
              {warehouses.map(w => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}{w.location ? ` · ${w.location}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Channel</Label>
          <Select
            value={filterPlatform || 'all'}
            onValueChange={v => setFilterPlatform(v === 'all' ? '' : v)}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All channels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              {PLATFORMS.map(p => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(hasFilters || showUnmappedOnly) && (
          <Button
            variant="ghost" size="sm"
            onClick={() => {
              setFilterWarehouse('')
              setFilterPlatform('')
              setShowUnmappedOnly(false)
            }}
          >
            <X className="h-3.5 w-3.5 mr-1" />
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
                <TableHead className="w-[260px]">Master Product</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead>SKU IDs</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : displayRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    {showUnmappedOnly
                      ? 'No unmapped SKUs — all SKUs have platform mappings.'
                      : search || hasFilters
                        ? 'No SKUs match your filters.'
                        : 'No master SKUs yet. Add your first SKU above.'}
                  </TableCell>
                </TableRow>
              ) : (
                displayRows.map(row => {
                  const { sku, variant, isVariant } = row
                  const mappings = isVariant ? variant.sku_mappings : sku.sku_mappings
                  const warehouseSummaries = isVariant ? variant.warehouse_summaries : sku.warehouse_summaries
                  const rowId = isVariant ? variant.id : sku.id
                  const rowDesc = isVariant ? variant.description : sku.description

                  return (
                    <TableRow key={rowId} className="group">
                      {/* Master Product column */}
                      <TableCell>
                        {isVariant ? (
                          <div>
                            <div className="font-medium text-sm">{sku.name}</div>
                            <div className="flex items-center gap-1 mt-0.5">
                              {renderEditableCell(variant.id, 'name', variant.name, { small: true })}
                            </div>
                          </div>
                        ) : (
                          renderEditableCell(sku.id, 'name', sku.name, { bold: true })
                        )}
                      </TableCell>

                      {/* Channels column — click to open mapping dialog */}
                      <TableCell
                        className="cursor-pointer"
                        onClick={() => setMappingSku(isVariant ? (variant as unknown as MasterSku) : sku)}
                      >
                        <ChannelBadges mappings={mappings} />
                      </TableCell>

                      {/* SKU IDs column */}
                      <TableCell>
                        <SkuIds mappings={mappings} />
                      </TableCell>

                      {/* Warehouse column */}
                      <TableCell>
                        <WarehouseNames summaries={warehouseSummaries} />
                      </TableCell>

                      {/* Description column */}
                      <TableCell>
                        {renderEditableCell(rowId, 'description', rowDesc)}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add SKU Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Master SKU</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>SKU Name <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. Premium Cotton T-Shirt - White - L"
                value={addName}
                onChange={e => setAddName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <div className="space-y-1">
              <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                placeholder="Short description"
                value={addDesc}
                onChange={e => setAddDesc(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={addLoading || !addName.trim()}>
              {addLoading ? 'Creating…' : 'Create SKU'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SKU Mapping Dialog */}
      {mappingSku && (
        <SkuMappingDialog
          open={!!mappingSku}
          onOpenChange={open => !open && setMappingSku(null)}
          masterSkuId={mappingSku.id}
          masterSkuName={mappingSku.name}
          existingMappings={mappingSku.sku_mappings}
          marketplaceAccounts={accounts}
          onSaved={fetchSkus}
        />
      )}

      {/* CSV Import Dialog */}
      <CsvImportDialog
        open={csvImportOpen}
        onOpenChange={setCsvImportOpen}
        onImported={fetchSkus}
      />
    </div>
  )
}

// ── Helper components (no state needed, defined outside) ─────────────────────

function ChannelBadges({ mappings }: { mappings: SkuMapping[] }) {
  if (mappings.length === 0) {
    return (
      <Badge
        variant="outline"
        className="border-amber-400 text-amber-700 gap-1 text-xs font-normal cursor-pointer hover:bg-amber-50"
      >
        <AlertTriangle className="h-3 w-3" />
        Unmapped
      </Badge>
    )
  }
  const platforms = [...new Set(mappings.map(m => m.platform))]
  return (
    <div className="flex flex-wrap gap-1">
      {platforms.map(p => (
        <Badge
          key={p}
          className="bg-emerald-100 text-emerald-800 border-0 text-xs font-medium hover:bg-emerald-200 cursor-pointer"
        >
          {PLATFORM_SHORT[p] ?? p}
        </Badge>
      ))}
    </div>
  )
}

function SkuIds({ mappings }: { mappings: SkuMapping[] }) {
  if (mappings.length === 0) return <span className="text-muted-foreground text-xs">—</span>
  const byPlatform: Record<string, string[]> = {}
  for (const m of mappings) {
    if (!byPlatform[m.platform]) byPlatform[m.platform] = []
    byPlatform[m.platform].push(m.platform_sku)
  }
  return (
    <div className="flex flex-col gap-0.5">
      {Object.entries(byPlatform).map(([platform, ids]) => (
        <div key={platform} className="text-xs">
          <span className="text-muted-foreground font-medium mr-1">
            {PLATFORM_SHORT[platform] ?? platform}:
          </span>
          <span className="font-mono">{ids.join(', ')}</span>
        </div>
      ))}
    </div>
  )
}

function WarehouseNames({ summaries }: { summaries: WarehouseSummary[] }) {
  if (summaries.length === 0) return <span className="text-muted-foreground text-sm">—</span>
  return (
    <div className="flex flex-col gap-0.5">
      {summaries.map(s => (
        <span key={s.warehouse_id} className="text-sm" title={s.location ?? undefined}>
          {s.warehouse_name}
        </span>
      ))}
    </div>
  )
}
