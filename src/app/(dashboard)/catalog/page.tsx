'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { CsvImportDialog } from '@/components/catalog/CsvImportDialog'
import { CombosTab } from '@/components/catalog/CombosTab'
import { exportCsv, todayString } from '@/lib/utils/csv-export'
import { toast } from 'sonner'
import { AlertTriangle, Download, HelpCircle, Pencil, Upload, X } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SkuMappingEntry {
  id: string
  platform: string
  platformSku: string
  marketplaceAccountId: string
  accountName?: string
}

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

// One row per master SKU or variant — all channel mappings are stacked inside
interface DisplayRow {
  masterSkuId: string
  masterSkuName: string
  parentName?: string
  warehouseNames: string[]
  isUnmapped: boolean
  mappings: SkuMappingEntry[]
}

// Flat type used only by the edit dialog (single mapping fields)
interface EditDialogRow {
  masterSkuId: string
  masterSkuName: string
  parentName?: string
  mappingId: string
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
  const [editRow, setEditRow] = useState<EditDialogRow | null>(null)
  const [editName, setEditName] = useState('')
  const [editChannel, setEditChannel] = useState('')
  const [editAccountName, setEditAccountName] = useState('')
  const [editSkuId, setEditSkuId] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  // CSV Import dialog
  const [csvImportOpen, setCsvImportOpen] = useState(false)

  // Wipe data
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false)
  const [wiping, setWiping] = useState(false)

  async function handleWipe() {
    setWiping(true)
    try {
      const res = await fetch('/api/catalog/wipe', { method: 'DELETE' })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Wipe failed')
        return
      }
      toast.success('All catalog data wiped')
      setWipeConfirmOpen(false)
      await loadData()
    } finally {
      setWiping(false)
    }
  }

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

  // ── Flatten into DisplayRows (one per SKU/variant, mappings grouped) ─────

  const allRows = useMemo((): DisplayRow[] => {
    const rows: DisplayRow[] = []

    function toEntries(raw: SkuMapping[]): SkuMappingEntry[] {
      return raw.map(m => ({
        id: m.id,
        platform: m.platform,
        platformSku: m.platform_sku,
        marketplaceAccountId: m.marketplace_account_id,
        accountName: m.marketplace_accounts?.account_name
          ?? accounts.find(a => a.id === m.marketplace_account_id)?.account_name,
      }))
    }

    function warehouseNamesFrom(summaries: WarehouseSummary[]): string[] {
      return summaries.map(w => w.warehouse_name)
    }

    for (const sku of masterSkus) {
      const hasVariants = (sku.variants?.length ?? 0) > 0

      if (hasVariants) {
        // Parent with variants — emit one consolidated row per variant
        for (const variant of sku.variants ?? []) {
          const mappings = toEntries(variant.sku_mappings)
          rows.push({
            masterSkuId: variant.id,
            masterSkuName: variant.name,
            parentName: sku.name,
            warehouseNames: warehouseNamesFrom(variant.warehouse_summaries),
            isUnmapped: mappings.length === 0,
            mappings,
          })
        }
        continue // skip the parent container itself
      }

      // Skip pure-parent skus that appear as parent_id elsewhere
      if (masterSkus.some(s => s.parent_id === sku.id)) continue

      const mappings = toEntries(sku.sku_mappings)
      const parentName = sku.parent_id
        ? masterSkus.find(s => s.id === sku.parent_id)?.name
        : undefined

      rows.push({
        masterSkuId: sku.id,
        masterSkuName: sku.name,
        parentName,
        warehouseNames: warehouseNamesFrom(sku.warehouse_summaries),
        isUnmapped: mappings.length === 0,
        mappings,
      })
    }

    return rows
  }, [masterSkus, accounts])

  // ── Filter options ───────────────────────────────────────────────────────────

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
    for (const r of allRows) { for (const m of r.mappings) seen.add(m.platform) }
    return [...seen].sort()
  }, [allRows])

  const accountOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const r of allRows) {
      for (const m of r.mappings) { if (m.accountName) seen.add(m.accountName) }
    }
    return [...seen].sort()
  }, [allRows])

  const warehouseOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const r of allRows) { for (const w of r.warehouseNames) seen.add(w) }
    return [...seen].sort()
  }, [allRows])

  // ── Filtered rows ────────────────────────────────────────────────────────────

  const filteredRows = useMemo(() => {
    let rows = allRows
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(r => r.mappings.some(m => m.platformSku.toLowerCase().includes(q)))
    }
    if (filterProduct) {
      rows = rows.filter(r => (r.parentName ?? r.masterSkuName) === filterProduct)
    }
    if (filterChannel) {
      rows = rows.filter(r => r.mappings.some(m => m.platform === filterChannel))
    }
    if (filterAccount) {
      rows = rows.filter(r => r.mappings.some(m => m.accountName === filterAccount))
    }
    if (filterWarehouse) {
      rows = rows.filter(r => r.warehouseNames.includes(filterWarehouse))
    }
    if (showUnmappedOnly) {
      rows = rows.filter(r => r.isUnmapped)
    }
    return rows
  }, [allRows, search, filterProduct, filterChannel, filterAccount, filterWarehouse, showUnmappedOnly])

  useEffect(() => { setPage(1) }, [search, filterProduct, filterChannel, filterAccount, filterWarehouse, showUnmappedOnly])

  // ── Pagination ───────────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const pagedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const showingFrom = filteredRows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const showingTo = Math.min(page * PAGE_SIZE, filteredRows.length)

  // ── Banner ───────────────────────────────────────────────────────────────────

  const stockedUnmappedCount = useMemo(
    () => allRows.filter(r => r.isUnmapped && r.warehouseNames.length > 0).length,
    [allRows],
  )

  const hasFilters = !!(search || filterProduct || filterChannel || filterAccount || filterWarehouse || showUnmappedOnly)

  function clearFilters() {
    setSearch('')
    setFilterProduct('')
    setFilterChannel('')
    setFilterAccount('')
    setFilterWarehouse('')
    setShowUnmappedOnly(false)
  }

  // ── CSV Export ───────────────────────────────────────────────────────────────

  function handleExport() {
    const headers = ['Master Product', 'Variant', 'Channel', 'Account', 'SKU ID', 'Warehouse(s)']
    const rows: string[][] = []
    for (const r of filteredRows) {
      if (r.mappings.length === 0) {
        rows.push([
          r.parentName ?? r.masterSkuName,
          r.parentName ? r.masterSkuName : '',
          '',
          '',
          '',
          r.warehouseNames.join('; '),
        ])
      } else {
        for (const m of r.mappings) {
          rows.push([
            r.parentName ?? r.masterSkuName,
            r.parentName ? r.masterSkuName : '',
            capitalize(m.platform),
            m.accountName ?? '',
            m.platformSku,
            r.warehouseNames.join('; '),
          ])
        }
      }
    }
    exportCsv(headers, rows, `catalog-export-${todayString()}.csv`)
  }

  // ── Edit dialog ──────────────────────────────────────────────────────────────

  function openEdit(row: DisplayRow, mapping: SkuMappingEntry) {
    setEditRow({
      masterSkuId: row.masterSkuId,
      masterSkuName: row.masterSkuName,
      parentName: row.parentName,
      mappingId: mapping.id,
    })
    setEditName(row.parentName ?? row.masterSkuName)
    setEditChannel(mapping.platform)
    setEditAccountName(mapping.accountName ?? '')
    setEditSkuId(mapping.platformSku)
    setEditError('')
  }

  const editChannelOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const a of accounts) seen.add(a.platform)
    return [...seen].sort()
  }, [accounts])

  const editAccountOptions = useMemo(() => {
    if (!editChannel) return accounts.map(a => a.account_name)
    return accounts.filter(a => a.platform === editChannel).map(a => a.account_name)
  }, [accounts, editChannel])

  async function handleEditSave() {
    if (!editRow) return
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
      if (!editRow.parentName) {
        const newName = editName.trim()
        if (newName && newName !== editRow.masterSkuName) {
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

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Master Catalog</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Connect master products to platform SKU IDs across channels and accounts
            </p>
          </div>
        </div>

        <Tabs defaultValue="products">
          <TabsList>
            <TabsTrigger value="products">Products</TabsTrigger>
            <TabsTrigger value="combos">Combos</TabsTrigger>
          </TabsList>

          <TabsContent value="combos" className="mt-4">
            <CombosTab />
          </TabsContent>

          <TabsContent value="products" className="mt-4">

        {/* Products tab action bar */}
        <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              className="border-red-500 text-red-500 hover:bg-red-50 hover:text-red-600"
              onClick={() => setWipeConfirmOpen(true)}
            >
              Wipe Data
            </Button>
            <Button variant="outline" onClick={handleExport} disabled={filteredRows.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
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
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Search</Label>
            <Input
              className="w-52"
              placeholder="Search by SKU ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

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
                <TableHead>Channel &amp; Mappings</TableHead>
                <TableHead className="w-[200px]">
                  <span className="flex items-center gap-1.5">
                    Warehouse
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[240px] text-xs">
                        Warehouses are populated automatically from Purchases data. Import purchases for this product to see stock locations here.
                      </TooltipContent>
                    </Tooltip>
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 3 }).map((_, j) => (
                      <TableCell key={j}>
                        <div className="h-4 w-full rounded bg-muted animate-pulse" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : pagedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-12 text-muted-foreground">
                    {showUnmappedOnly
                      ? 'No stocked SKUs are missing a channel mapping — great!'
                      : hasFilters
                        ? 'No SKUs match your filters.'
                        : 'No master SKUs yet.'}
                  </TableCell>
                </TableRow>
              ) : (
                pagedRows.map((row, i) => (
                  <TableRow key={`${row.masterSkuId}-${i}`} className="align-top">

                    {/* Master Product / SKU */}
                    <TableCell className="py-3">
                      {row.parentName ? (
                        <div>
                          <div className="font-medium text-sm">{row.parentName}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{row.masterSkuName}</div>
                        </div>
                      ) : (
                        <span className="font-medium text-sm">{row.masterSkuName}</span>
                      )}
                    </TableCell>

                    {/* Channel & Mappings — all mappings stacked in one cell */}
                    <TableCell className="py-3">
                      {row.isUnmapped ? (
                        <Badge variant="destructive" className="text-xs font-normal">
                          Unmapped
                        </Badge>
                      ) : (
                        <div className="space-y-1.5">
                          {row.mappings.map(m => (
                            <div key={m.id} className="flex items-center gap-2 group/m">
                              <Badge variant="secondary" className="text-xs font-medium shrink-0">
                                {capitalize(m.platform)}
                              </Badge>
                              <span className="text-sm text-muted-foreground shrink-0">
                                {m.accountName ?? '—'}
                              </span>
                              <span className="font-mono text-sm truncate">
                                {m.platformSku}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-0 group-hover/m:opacity-60 hover:!opacity-100 transition-opacity shrink-0 ml-auto"
                                onClick={() => openEdit(row, m)}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCell>

                    {/* Warehouse */}
                    <TableCell className="py-3 text-sm">
                      {row.warehouseNames.length > 0
                        ? row.warehouseNames.join(', ')
                        : <span className="text-muted-foreground">—</span>
                      }
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
            <span>Showing {showingFrom}–{showingTo} of {filteredRows.length}</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Prev
              </Button>
              <span className="text-xs">Page {page} of {totalPages}</span>
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

        {/* Wipe Confirm Dialog */}
        <Dialog open={wipeConfirmOpen} onOpenChange={setWipeConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-red-600">Wipe all catalog data?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground py-2">
              This will permanently delete all master SKUs and channel mappings for this account.
              Warehouse stock data will not be affected. This cannot be undone.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setWipeConfirmOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={handleWipe}
                disabled={wiping}
              >
                {wiping ? 'Wiping…' : 'Yes, wipe everything'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

          </TabsContent>
        </Tabs>

      </div>
    </TooltipProvider>
  )
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}
