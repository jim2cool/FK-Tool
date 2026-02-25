'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { SkuMappingDialog } from '@/components/catalog/SkuMappingDialog'
import { toast } from 'sonner'
import { Plus, Search, Edit2, Map, Upload, X } from 'lucide-react'
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

interface MasterSku {
  id: string
  name: string
  description: string | null
  is_archived: boolean
  created_at: string
  sku_mappings: SkuMapping[]
  warehouse_summaries: WarehouseSummary[]
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

const platformColors: Record<Platform, string> = {
  flipkart: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  amazon: 'bg-orange-100 text-orange-800 border-orange-200',
  d2c: 'bg-blue-100 text-blue-800 border-blue-200',
}

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'flipkart', label: 'Flipkart' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'd2c', label: 'D2C' },
]

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)
}

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

  // Add SKU dialog
  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addDesc, setAddDesc] = useState('')
  const [addLoading, setAddLoading] = useState(false)

  // Edit SKU dialog
  const [editSku, setEditSku] = useState<MasterSku | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editLoading, setEditLoading] = useState(false)

  // Mapping dialog
  const [mappingSku, setMappingSku] = useState<MasterSku | null>(null)

  // Bulk CSV import
  const csvInputRef = useRef<HTMLInputElement>(null)
  const [csvUploading, setCsvUploading] = useState(false)

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

  function openEdit(sku: MasterSku) {
    setEditSku(sku)
    setEditName(sku.name)
    setEditDesc(sku.description ?? '')
  }

  async function handleEdit() {
    if (!editSku) return
    if (!editName.trim()) return toast.error('SKU name is required')
    setEditLoading(true)
    try {
      const res = await fetch('/api/catalog/master-skus', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editSku.id, name: editName.trim(), description: editDesc.trim() || null }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Failed to update SKU')
        return
      }
      toast.success('SKU updated')
      setEditSku(null)
      fetchSkus()
    } finally {
      setEditLoading(false)
    }
  }

  const getPlatformSkus = (sku: MasterSku, platform: Platform): string[] =>
    sku.sku_mappings.filter(m => m.platform === platform).map(m => m.platform_sku)

  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/catalog/import-csv', { method: 'POST', body: formData })
      const result = await res.json()
      if (!res.ok) {
        toast.error(result.error ?? 'Import failed')
      } else {
        toast.success(`Import complete: ${result.processed} processed, ${result.failed} failed`)
        fetchSkus()
      }
    } finally {
      setCsvUploading(false)
      if (csvInputRef.current) csvInputRef.current.value = ''
    }
  }

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
          <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
          <Button variant="outline" onClick={() => csvInputRef.current?.click()} disabled={csvUploading}>
            <Upload className="h-4 w-4 mr-2" />
            {csvUploading ? 'Importing…' : 'Bulk Import CSV'}
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Master SKU
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        {/* SKU search */}
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

        {/* Warehouse filter */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Warehouse</Label>
          <Select value={filterWarehouse} onValueChange={setFilterWarehouse}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All warehouses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All warehouses</SelectItem>
              {warehouses.map(w => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}{w.location ? ` · ${w.location}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Channel / Platform filter */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Channel</Label>
          <Select value={filterPlatform} onValueChange={setFilterPlatform}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All channels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All channels</SelectItem>
              {PLATFORMS.map(p => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFilterWarehouse(''); setFilterPlatform('') }}
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
                <TableHead>Master SKU Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Flipkart SKUs</TableHead>
                <TableHead>Amazon SKUs</TableHead>
                <TableHead>D2C SKUs</TableHead>
                <TableHead>Warehouse Stock & COGS</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : skus.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    {search || hasFilters
                      ? 'No SKUs match your filters.'
                      : 'No master SKUs yet. Add your first SKU above.'}
                  </TableCell>
                </TableRow>
              ) : (
                skus.map(sku => (
                  <TableRow key={sku.id}>
                    <TableCell className="font-medium">{sku.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[160px] truncate">
                      {sku.description ?? '—'}
                    </TableCell>
                    <TableCell>
                      <PlatformSkuCell skus={getPlatformSkus(sku, 'flipkart')} platform="flipkart" />
                    </TableCell>
                    <TableCell>
                      <PlatformSkuCell skus={getPlatformSkus(sku, 'amazon')} platform="amazon" />
                    </TableCell>
                    <TableCell>
                      <PlatformSkuCell skus={getPlatformSkus(sku, 'd2c')} platform="d2c" />
                    </TableCell>
                    <TableCell>
                      <WarehouseStockCell summaries={sku.warehouse_summaries} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(sku)}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setMappingSku(sku)}>
                          <Map className="h-3.5 w-3.5 mr-1" />
                          Map
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
              <Input placeholder="Short description" value={addDesc} onChange={e => setAddDesc(e.target.value)} />
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

      {/* Edit SKU Dialog */}
      <Dialog open={!!editSku} onOpenChange={open => !open && setEditSku(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Master SKU</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>SKU Name <span className="text-destructive">*</span></Label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleEdit()} />
            </div>
            <div className="space-y-1">
              <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input value={editDesc} onChange={e => setEditDesc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSku(null)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={editLoading || !editName.trim()}>
              {editLoading ? 'Saving…' : 'Save Changes'}
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
    </div>
  )
}

function PlatformSkuCell({ skus, platform }: { skus: string[]; platform: Platform }) {
  const colors: Record<Platform, string> = {
    flipkart: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    amazon: 'bg-orange-100 text-orange-800 border-orange-200',
    d2c: 'bg-blue-100 text-blue-800 border-blue-200',
  }
  if (skus.length === 0) return <span className="text-xs text-muted-foreground italic">Not mapped</span>
  return (
    <div className="flex flex-wrap gap-1">
      {skus.map(s => (
        <span key={s} className={`text-xs px-1.5 py-0.5 rounded border font-mono ${colors[platform]}`}>{s}</span>
      ))}
    </div>
  )
}

function WarehouseStockCell({ summaries }: { summaries: WarehouseSummary[] }) {
  if (summaries.length === 0) {
    return <span className="text-xs text-muted-foreground italic">No stock data</span>
  }
  return (
    <div className="space-y-1">
      {summaries.map(s => (
        <div key={s.warehouse_id} className="flex items-center gap-2 text-xs">
          <span className="font-medium text-foreground truncate max-w-[100px]" title={s.warehouse_name}>
            {s.warehouse_name}
          </span>
          {s.location && (
            <span className="text-muted-foreground">· {s.location}</span>
          )}
          <span className="ml-auto tabular-nums text-muted-foreground whitespace-nowrap">
            {s.total_qty} units · ₹{fmt(s.avg_cogs)}/u
          </span>
        </div>
      ))}
    </div>
  )
}
