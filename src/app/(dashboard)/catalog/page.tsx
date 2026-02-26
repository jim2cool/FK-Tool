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
import { Plus, Search, Upload, X, AlertTriangle, Pencil, ChevronRight } from 'lucide-react'
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

type DisplayRow =
  | { sku: MasterSku; variant: Variant; isVariant: true }
  | { sku: MasterSku; variant: null; isVariant: false }

type EditRow = { id: string; name: string }

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
  const [filterAccount, setFilterAccount] = useState('')
  const [showUnmappedOnly, setShowUnmappedOnly] = useState(false)

  // Add SKU dialog
  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addWarehouseId, setAddWarehouseId] = useState('')
  const [addLoading, setAddLoading] = useState(false)

  // Per-row edit dialog
  const [editRow, setEditRow] = useState<EditRow | null>(null)
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
      if (filterAccount) params.set('account_id', filterAccount)
      const res = await fetch(`/api/catalog/master-skus?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      setSkus(await res.json())
    } catch {
      toast.error('Failed to load catalog')
    } finally {
      setLoading(false)
    }
  }, [searchDebounced, filterWarehouse, filterPlatform, filterAccount])

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

  // Stocked but unmapped: has warehouse stock AND no channel mapping — these are critical
  // because you have real inventory that isn't listed on any sales channel
  const stockedUnmappedCount = skus.reduce((n, sku) => {
    if (sku.variants.length > 0) {
      return n + sku.variants.filter(v =>
        v.sku_mappings.length === 0 && v.warehouse_summaries.length > 0
      ).length
    }
    return (sku.sku_mappings.length === 0 && sku.warehouse_summaries.length > 0) ? n + 1 : n
  }, 0)

  const hasFilters = !!filterWarehouse || !!filterPlatform || !!filterAccount

  async function handleAdd() {
    if (!addName.trim()) return toast.error('SKU name is required')
    setAddLoading(true)
    try {
      const res = await fetch('/api/catalog/master-skus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addName.trim() }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Failed to create SKU')
        return
      }
      const newSku = await res.json()

      // If a warehouse was selected, create an initial stock entry (qty=1, cost=0)
      // so the SKU appears in the warehouse immediately.
      if (addWarehouseId && newSku?.id) {
        await fetch('/api/purchases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            master_sku_id: newSku.id,
            warehouse_id: addWarehouseId,
            quantity: 1,
            unit_cost: 0,
            purchase_date: new Date().toISOString().split('T')[0],
          }),
        })
      }

      toast.success('Master SKU created')
      setAddName('')
      setAddWarehouseId('')
      setAddOpen(false)
      fetchSkus()
    } finally {
      setAddLoading(false)
    }
  }

  async function handleEditSave() {
    if (!editRow || !editRow.name.trim()) return toast.error('Name cannot be empty')
    setEditSaving(true)
    try {
      const res = await fetch('/api/catalog/master-skus', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editRow.id, name: editRow.name.trim() }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Failed to update')
        return
      }
      await fetchSkus()
      setEditRow(null)
    } finally {
      setEditSaving(false)
    }
  }

  // Build display rows: flat SKUs as-is, parents as one row per variant
  const displayRows: DisplayRow[] = skus.flatMap((sku): DisplayRow[] => {
    if (sku.variants.length > 0) {
      const rows = sku.variants.map(variant => ({ sku, variant, isVariant: true as const }))
      if (showUnmappedOnly) {
        // Show variants that are stocked but not mapped to any channel
        return rows.filter(r =>
          r.variant.sku_mappings.length === 0 && r.variant.warehouse_summaries.length > 0
        )
      }
      return rows
    }
    const row = { sku, variant: null, isVariant: false as const }
    if (showUnmappedOnly && (sku.sku_mappings.length > 0 || sku.warehouse_summaries.length === 0)) return []
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

      {/* Stocked-but-unmapped banner — only fires for inventory that can't reach any channel */}
      {!loading && stockedUnmappedCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{stockedUnmappedCount} SKU{stockedUnmappedCount !== 1 ? 's are' : ' is'} in stock</strong>{' '}
            at a warehouse but not mapped to any channel — this inventory can&apos;t be sold or reported.
          </span>
          <Button
            variant="link" size="sm"
            className="text-red-800 h-auto p-0 underline underline-offset-2 ml-auto shrink-0"
            onClick={() => setShowUnmappedOnly(v => !v)}
          >
            {showUnmappedOnly ? 'Show all' : 'Show these SKUs ↓'}
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

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Account</Label>
          <Select
            value={filterAccount || 'all'}
            onValueChange={v => setFilterAccount(v === 'all' ? '' : v)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map(a => (
                <SelectItem key={a.id} value={a.id}>
                  {a.account_name}
                  <span className="text-muted-foreground ml-1 text-xs">
                    ({PLATFORM_SHORT[a.platform] ?? a.platform})
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(hasFilters || showUnmappedOnly) && (
          <Button
            variant="ghost" size="sm"
            onClick={() => { setFilterWarehouse(''); setFilterPlatform(''); setFilterAccount(''); setShowUnmappedOnly(false) }}
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
                <TableHead className="w-[240px]">Master Product</TableHead>
                <TableHead className="w-24">Channels</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>SKU IDs</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : displayRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    {showUnmappedOnly
                      ? 'No stocked SKUs are missing a channel mapping — great!'
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
                  const rowName = isVariant ? variant.name : sku.name

                  return (
                    <TableRow key={rowId} className="group">
                      {/* Master Product column */}
                      <TableCell>
                        {isVariant ? (
                          <div>
                            <div className="font-medium text-sm">{sku.name}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{variant.name}</div>
                          </div>
                        ) : (
                          <span className="font-medium text-sm">{sku.name}</span>
                        )}
                      </TableCell>

                      {/* Channels column — click to open mapping dialog */}
                      <TableCell
                        className="cursor-pointer"
                        onClick={() => setMappingSku(isVariant ? (variant as unknown as MasterSku) : sku)}
                      >
                        <ChannelBadges mappings={mappings} />
                      </TableCell>

                      {/* Account column */}
                      <TableCell>
                        <AccountNames mappings={mappings} accounts={accounts} />
                      </TableCell>

                      {/* SKU IDs column */}
                      <TableCell>
                        <SkuIds mappings={mappings} accounts={accounts} />
                      </TableCell>

                      {/* Warehouse column */}
                      <TableCell>
                        <WarehouseNames summaries={warehouseSummaries} />
                      </TableCell>

                      {/* Actions — edit icon on row hover */}
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                          onClick={() => setEditRow({ id: rowId, name: rowName })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
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
              <Label>Warehouse <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Select
                value={addWarehouseId || 'none'}
                onValueChange={v => setAddWarehouseId(v === 'none' ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select warehouse…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No warehouse</SelectItem>
                  {warehouses.map(w => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}{w.location ? ` — ${w.location}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

      {/* Per-row Edit Dialog */}
      <Dialog open={!!editRow} onOpenChange={open => !open && setEditRow(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename SKU</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Name <span className="text-destructive">*</span></Label>
            <Input
              autoFocus
              value={editRow?.name ?? ''}
              onChange={e => setEditRow(r => r ? { ...r, name: e.target.value } : null)}
              onKeyDown={e => {
                if (e.key === 'Escape') setEditRow(null)
                if (e.key === 'Enter') handleEditSave()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={editSaving || !editRow?.name.trim()}>
              {editSaving ? 'Saving…' : 'Save'}
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

function AccountNames({ mappings, accounts }: { mappings: SkuMapping[]; accounts: MarketplaceAccount[] }) {
  if (mappings.length === 0) return <span className="text-muted-foreground text-sm">—</span>
  const seen = new Set<string>()
  const names: string[] = []
  for (const m of mappings) {
    if (m.marketplace_account_id) {
      const name = accounts.find(a => a.id === m.marketplace_account_id)?.account_name
      if (name && !seen.has(name)) { seen.add(name); names.push(name) }
    }
  }
  if (names.length === 0) return <span className="text-muted-foreground text-sm">—</span>
  return (
    <div className="flex flex-col gap-0.5">
      {names.map(name => <span key={name} className="text-sm">{name}</span>)}
    </div>
  )
}

function SkuIds({ mappings, accounts }: { mappings: SkuMapping[]; accounts: MarketplaceAccount[] }) {
  if (mappings.length === 0) return <span className="text-muted-foreground text-xs">—</span>

  // Group by platform + account combination
  const groups = new Map<string, { platform: string; accountName: string | null; skus: string[] }>()
  for (const m of mappings) {
    const key = `${m.platform}::${m.marketplace_account_id ?? ''}`
    const accountName = m.marketplace_account_id
      ? (accounts.find(a => a.id === m.marketplace_account_id)?.account_name ?? null)
      : null
    if (!groups.has(key)) groups.set(key, { platform: m.platform, accountName, skus: [] })
    groups.get(key)!.skus.push(m.platform_sku)
  }

  return (
    <div className="flex flex-col gap-0.5">
      {[...groups.values()].map(({ platform, accountName, skus }, i) => (
        <div key={i} className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground font-medium">
            {PLATFORM_SHORT[platform] ?? platform}:
          </span>
          {accountName && (
            <>
              <span className="text-muted-foreground">{accountName}</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            </>
          )}
          <span className="font-mono">{skus.join(', ')}</span>
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
