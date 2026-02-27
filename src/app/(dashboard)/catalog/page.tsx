'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
// @ts-ignore — CsvImportDialog is being rewritten in a parallel task
import { CsvImportDialog } from '@/components/catalog/CsvImportDialog'
import { toast } from 'sonner'
import { AlertTriangle, Pencil, Upload, X } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SkuMapping {
  id: string
  platform: string
  platform_sku: string
  marketplace_account_id: string
  marketplace_accounts?: { account_name: string } | null
}

interface WarehouseSummary {
  warehouse_id: string
  warehouse_name: string
  quantity?: number
  total_qty?: number
}

interface MasterSku {
  id: string
  name: string
  parent_id: string | null
  sku_mappings: SkuMapping[]
  warehouse_summaries: WarehouseSummary[]
  variants?: MasterSku[]
}

interface Account {
  id: string
  platform: string
  account_name: string
}

interface DisplayRow {
  masterSkuId: string
  masterSkuName: string
  parentName?: string
  mappingId?: string
  platform?: string
  platformSku?: string
  marketplaceAccountId?: string
  accountName?: string
  warehouseNames: string[]
  isUnmapped: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CatalogPage() {
  const [masterSkus, setMasterSkus] = useState<MasterSku[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const [filterProduct, setFilterProduct] = useState('')
  const [filterChannel, setFilterChannel] = useState('')
  const [filterAccount, setFilterAccount] = useState('')
  const [filterWarehouse, setFilterWarehouse] = useState('')
  const [showUnmappedOnly, setShowUnmappedOnly] = useState(false)

  // Pagination
  const [page, setPage] = useState(1)

  // Edit dialog
  const [editRow, setEditRow] = useState<DisplayRow | null>(null)
  const [editName, setEditName] = useState('')
  const [editChannel, setEditChannel] = useState('')
  const [editAccountName, setEditAccountName] = useState('')
  const [editSkuId, setEditSkuId] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  // CSV Import dialog
  const [csvImportOpen, setCsvImportOpen] = useState(false)

  // ── Data fetching ───────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [skusRes, accountsRes] = await Promise.all([
        fetch('/api/catalog/master-skus'),
        fetch('/api/marketplace-accounts'),
      ])
      if (!skusRes.ok) throw new Error('Failed to fetch catalog')
      if (!accountsRes.ok) throw new Error('Failed to fetch accounts')
      const skusData: MasterSku[] = await skusRes.json()
      const accountsData: Account[] = await accountsRes.json()
      setMasterSkus(skusData ?? [])
      setAccounts(accountsData ?? [])
    } catch {
      toast.error('Failed to load catalog')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Flatten into DisplayRows ────────────────────────────────────────────────

  const allRows = useMemo((): DisplayRow[] => {
    // Build parentNames map: id → name for all top-level skus (parent_id === null)
    const parentNames = new Map<string, string>()
    for (const sku of masterSkus) {
      if (sku.parent_id === null) {
        parentNames.set(sku.id, sku.name)
      }
    }

    // Collect all ids that appear as parent_id — these are pure parent skus to skip
    const parentIds = new Set<string>()
    for (const sku of masterSkus) {
      if (sku.parent_id !== null) {
        parentIds.add(sku.parent_id)
      }
    }

    // Also handle skus that have a variants array (the route nests variants)
    // Parents are detected either by parentIds or by having variants.length > 0
    // In the GET route, variants are nested inside the parent — those raw variants
    // are NOT present as separate entries in the top-level array, so we need to
    // flatten them out manually.
    const rows: DisplayRow[] = []

    for (const sku of masterSkus) {
      const hasVariants = (sku.variants?.length ?? 0) > 0

      if (hasVariants) {
        // This is a parent — emit rows for each variant
        for (const variant of sku.variants ?? []) {
          const qty = (whName: WarehouseSummary) =>
            (whName.quantity ?? whName.total_qty ?? 0) > 0
          const warehouseNames = variant.warehouse_summaries
            .filter(qty)
            .map(w => w.warehouse_name)

          if (variant.sku_mappings.length === 0) {
            rows.push({
              masterSkuId: variant.id,
              masterSkuName: variant.name,
              parentName: sku.name,
              warehouseNames,
              isUnmapped: true,
            })
          } else {
            for (const m of variant.sku_mappings) {
              rows.push({
                masterSkuId: variant.id,
                masterSkuName: variant.name,
                parentName: sku.name,
                mappingId: m.id,
                platform: m.platform,
                platformSku: m.platform_sku,
                marketplaceAccountId: m.marketplace_account_id,
                accountName: m.marketplace_accounts?.account_name
                  ?? accounts.find(a => a.id === m.marketplace_account_id)?.account_name,
                warehouseNames,
                isUnmapped: false,
              })
            }
          }
        }
        // Skip the parent itself — it's just a container
        continue
      }

      // Skip skus that appear as parent_id in another sku (pure parents without nested variants)
      if (parentIds.has(sku.id)) continue

      const qty = (w: WarehouseSummary) => (w.quantity ?? w.total_qty ?? 0) > 0
      const warehouseNames = sku.warehouse_summaries.filter(qty).map(w => w.warehouse_name)
      const parentName = sku.parent_id ? parentNames.get(sku.parent_id) : undefined

      if (sku.sku_mappings.length === 0) {
        rows.push({
          masterSkuId: sku.id,
          masterSkuName: sku.name,
          parentName,
          warehouseNames,
          isUnmapped: true,
        })
      } else {
        for (const m of sku.sku_mappings) {
          rows.push({
            masterSkuId: sku.id,
            masterSkuName: sku.name,
            parentName,
            mappingId: m.id,
            platform: m.platform,
            platformSku: m.platform_sku,
            marketplaceAccountId: m.marketplace_account_id,
            accountName: m.marketplace_accounts?.account_name
              ?? accounts.find(a => a.id === m.marketplace_account_id)?.account_name,
            warehouseNames,
            isUnmapped: false,
          })
        }
      }
    }

    return rows
  }, [masterSkus, accounts])

  // ── Filter options (computed from all rows) ─────────────────────────────────

  const productOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: string[] = []
    for (const r of allRows) {
      const label = r.parentName ?? r.masterSkuName
      if (!seen.has(label)) { seen.add(label); opts.push(label) }
    }
    return opts.sort()
  }, [allRows])

  const channelOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const r of allRows) { if (r.platform) seen.add(r.platform) }
    return [...seen].sort()
  }, [allRows])

  const accountOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const r of allRows) { if (r.accountName) seen.add(r.accountName) }
    return [...seen].sort()
  }, [allRows])

  const warehouseOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const r of allRows) { for (const w of r.warehouseNames) seen.add(w) }
    return [...seen].sort()
  }, [allRows])

  // ── Filtered rows ───────────────────────────────────────────────────────────

  const filteredRows = useMemo(() => {
    let rows = allRows
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(r => r.platformSku?.toLowerCase().includes(q))
    }
    if (filterProduct) {
      rows = rows.filter(r => (r.parentName ?? r.masterSkuName) === filterProduct)
    }
    if (filterChannel) {
      rows = rows.filter(r => r.platform === filterChannel)
    }
    if (filterAccount) {
      rows = rows.filter(r => r.accountName === filterAccount)
    }
    if (filterWarehouse) {
      rows = rows.filter(r => r.warehouseNames.includes(filterWarehouse))
    }
    if (showUnmappedOnly) {
      rows = rows.filter(r => r.isUnmapped)
    }
    return rows
  }, [allRows, search, filterProduct, filterChannel, filterAccount, filterWarehouse, showUnmappedOnly])

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [search, filterProduct, filterChannel, filterAccount, filterWarehouse, showUnmappedOnly])

  // ── Pagination ──────────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const pagedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const showingFrom = filteredRows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const showingTo = Math.min(page * PAGE_SIZE, filteredRows.length)

  // ── Banner ──────────────────────────────────────────────────────────────────

  const stockedUnmappedCount = useMemo(
    () => allRows.filter(r => r.isUnmapped && r.warehouseNames.length > 0).length,
    [allRows],
  )

  // ── Filters active? ─────────────────────────────────────────────────────────

  const hasFilters = !!(search || filterProduct || filterChannel || filterAccount || filterWarehouse || showUnmappedOnly)

  function clearFilters() {
    setSearch('')
    setFilterProduct('')
    setFilterChannel('')
    setFilterAccount('')
    setFilterWarehouse('')
    setShowUnmappedOnly(false)
  }

  // ── Edit dialog helpers ─────────────────────────────────────────────────────

  function openEdit(row: DisplayRow) {
    setEditRow(row)
    setEditName(row.parentName ?? row.masterSkuName)
    setEditChannel(row.platform ?? '')
    setEditAccountName(row.accountName ?? '')
    setEditSkuId(row.platformSku ?? '')
    setEditError('')
  }

  // Channels available in the edit dialog — derived from accounts list
  const editChannelOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const a of accounts) seen.add(a.platform)
    return [...seen].sort()
  }, [accounts])

  // Accounts filtered by selected channel in the edit dialog
  const editAccountOptions = useMemo(() => {
    if (!editChannel) return accounts.map(a => a.account_name)
    return accounts.filter(a => a.platform === editChannel).map(a => a.account_name)
  }, [accounts, editChannel])

  async function handleEditSave() {
    if (!editRow || !editRow.mappingId) return
    if (!editSkuId.trim()) { setEditError('SKU ID cannot be empty'); return }
    if (!editChannel) { setEditError('Channel is required'); return }
    if (!editAccountName) { setEditError('Account is required'); return }

    const acct = accounts.find(a => a.platform === editChannel && a.account_name === editAccountName)
    if (!acct) {
      setEditError(`'${editChannel} / ${editAccountName}' not found in Settings`)
      return
    }

    setEditSaving(true)
    setEditError('')
    try {
      // 1. Patch master SKU name if changed and not a variant
      if (!editRow.parentName) {
        const currentName = editRow.masterSkuName
        const newName = editName.trim()
        if (newName && newName !== currentName) {
          const res = await fetch('/api/catalog/master-skus', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: editRow.masterSkuId, name: newName }),
          })
          if (!res.ok) {
            const { error } = await res.json()
            setEditError(error ?? 'Failed to update SKU name')
            return
          }
        }
      }

      // 2. Patch the sku mapping
      const res = await fetch('/api/catalog/sku-mappings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editRow.mappingId,
          platform: editChannel,
          platform_sku: editSkuId.trim(),
          marketplace_account_id: acct.id,
        }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        setEditError(error ?? 'Failed to update mapping')
        return
      }

      toast.success('Mapping updated')
      setEditRow(null)
      await loadData()
    } finally {
      setEditSaving(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Master Catalog</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Connect master products to platform SKU IDs across channels and accounts
          </p>
        </div>
        <Button onClick={() => setCsvImportOpen(true)}>
          <Upload className="h-4 w-4 mr-2" />
          Bulk Import
        </Button>
      </div>

      {/* Stocked-but-unmapped banner */}
      {!loading && stockedUnmappedCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>
              {stockedUnmappedCount} SKU{stockedUnmappedCount !== 1 ? 's' : ''} are in stock
            </strong>{' '}
            at a warehouse but not mapped to any channel — this inventory can&apos;t be sold.
          </span>
          <Button
            variant="link"
            size="sm"
            className="text-red-800 h-auto p-0 underline underline-offset-2 ml-auto shrink-0"
            onClick={() => setShowUnmappedOnly(v => !v)}
          >
            {showUnmappedOnly ? 'Show all' : 'Show these SKUs ↓'}
          </Button>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Search by SKU ID */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <Input
            className="w-52"
            placeholder="Search by SKU ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Filter: Master Product */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Master Product</Label>
          <Select
            value={filterProduct || '__all__'}
            onValueChange={v => setFilterProduct(v === '__all__' ? '' : v)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All products" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All products</SelectItem>
              {productOptions.map(p => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Filter: Channel */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Channel</Label>
          <Select
            value={filterChannel || '__all__'}
            onValueChange={v => setFilterChannel(v === '__all__' ? '' : v)}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All channels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All channels</SelectItem>
              {channelOptions.map(c => (
                <SelectItem key={c} value={c}>{capitalize(c)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Filter: Account */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Account</Label>
          <Select
            value={filterAccount || '__all__'}
            onValueChange={v => setFilterAccount(v === '__all__' ? '' : v)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All accounts</SelectItem>
              {accountOptions.map(a => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Filter: Warehouse */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Warehouse</Label>
          <Select
            value={filterWarehouse || '__all__'}
            onValueChange={v => setFilterWarehouse(v === '__all__' ? '' : v)}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All warehouses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All warehouses</SelectItem>
              {warehouseOptions.map(w => (
                <SelectItem key={w} value={w}>{w}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Clear filters */}
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-3.5 w-3.5 mr-1" />
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[260px]">Master Product / SKU</TableHead>
              <TableHead className="w-28">Channel</TableHead>
              <TableHead className="w-[180px]">Account</TableHead>
              <TableHead>SKU ID</TableHead>
              <TableHead className="w-[200px]">Warehouse</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}>
                      <div className="h-4 w-full rounded bg-muted animate-pulse" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : pagedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  {showUnmappedOnly
                    ? 'No stocked SKUs are missing a channel mapping — great!'
                    : hasFilters
                      ? 'No SKUs match your filters.'
                      : 'No master SKUs yet.'}
                </TableCell>
              </TableRow>
            ) : (
              pagedRows.map((row, i) => (
                <TableRow key={`${row.masterSkuId}-${row.mappingId ?? 'unmapped'}-${i}`} className="group">
                  {/* Master Product / SKU */}
                  <TableCell>
                    {row.parentName ? (
                      <div>
                        <div className="font-medium text-sm">{row.parentName}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{row.masterSkuName}</div>
                      </div>
                    ) : (
                      <span className="font-medium text-sm">{row.masterSkuName}</span>
                    )}
                  </TableCell>

                  {/* Channel */}
                  <TableCell>
                    {row.isUnmapped ? (
                      <Badge variant="destructive" className="text-xs font-normal">
                        Unmapped
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs font-medium">
                        {capitalize(row.platform ?? '')}
                      </Badge>
                    )}
                  </TableCell>

                  {/* Account */}
                  <TableCell className="text-sm">
                    {row.accountName ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>

                  {/* SKU ID */}
                  <TableCell>
                    {row.platformSku
                      ? <span className="font-mono text-sm">{row.platformSku}</span>
                      : <span className="text-muted-foreground">—</span>
                    }
                  </TableCell>

                  {/* Warehouse */}
                  <TableCell className="text-sm">
                    {row.warehouseNames.length > 0
                      ? row.warehouseNames.join(', ')
                      : <span className="text-muted-foreground">—</span>
                    }
                  </TableCell>

                  {/* Edit icon — only for mapped rows */}
                  <TableCell>
                    {!row.isUnmapped && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                        onClick={() => openEdit(row)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {!loading && filteredRows.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {showingFrom}–{showingTo} of {filteredRows.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              Prev
            </Button>
            <span className="text-xs">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Inline Edit Dialog */}
      <Dialog open={!!editRow} onOpenChange={open => !open && setEditRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Mapping</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Master Product / SKU name */}
            <div className="space-y-1">
              <Label>Master Product / SKU</Label>
              <Input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                disabled={!!(editRow?.parentName)}
                placeholder="SKU name"
              />
              {editRow?.parentName && (
                <p className="text-xs text-muted-foreground">
                  Variant names can only be changed from the parent product.
                </p>
              )}
            </div>

            {/* Channel */}
            <div className="space-y-1">
              <Label>Channel</Label>
              <Select
                value={editChannel || '__none__'}
                onValueChange={v => {
                  setEditChannel(v === '__none__' ? '' : v)
                  setEditAccountName('')
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select channel…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select channel…</SelectItem>
                  {editChannelOptions.map(c => (
                    <SelectItem key={c} value={c}>{capitalize(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Account */}
            <div className="space-y-1">
              <Label>Account</Label>
              <Select
                value={editAccountName || '__none__'}
                onValueChange={v => setEditAccountName(v === '__none__' ? '' : v)}
                disabled={!editChannel}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select account…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select account…</SelectItem>
                  {editAccountOptions.map(a => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* SKU ID */}
            <div className="space-y-1">
              <Label>SKU ID</Label>
              <Input
                className="font-mono"
                value={editSkuId}
                onChange={e => setEditSkuId(e.target.value)}
                placeholder="Platform SKU ID"
              />
            </div>

            {editError && (
              <p className="text-sm text-destructive">{editError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={editSaving}>
              {editSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV Import Dialog */}
      <CsvImportDialog
        open={csvImportOpen}
        onOpenChange={setCsvImportOpen}
        onImported={loadData}
      />
    </div>
  )
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}
