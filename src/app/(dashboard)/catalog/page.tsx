'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { SkuMappingDialog } from '@/components/catalog/SkuMappingDialog'
import { toast } from 'sonner'
import { Plus, Search, Edit2, Map, Upload } from 'lucide-react'
import type { Platform } from '@/types'

interface SkuMapping {
  id: string
  platform: Platform
  platform_sku: string
  marketplace_account_id: string | null
}

interface MasterSku {
  id: string
  name: string
  description: string | null
  is_archived: boolean
  created_at: string
  sku_mappings: SkuMapping[]
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

const platformLabels: Record<Platform, string> = {
  flipkart: 'FK',
  amazon: 'AMZ',
  d2c: 'D2C',
}

export default function CatalogPage() {
  const [skus, setSkus] = useState<MasterSku[]>([])
  const [accounts, setAccounts] = useState<MarketplaceAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')

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
      const url = searchDebounced
        ? `/api/catalog/master-skus?search=${encodeURIComponent(searchDebounced)}`
        : '/api/catalog/master-skus'
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch')
      setSkus(await res.json())
    } catch {
      toast.error('Failed to load catalog')
    } finally {
      setLoading(false)
    }
  }, [searchDebounced])

  useEffect(() => { fetchSkus() }, [fetchSkus])

  useEffect(() => {
    fetch('/api/marketplace-accounts')
      .then(r => r.json())
      .then(setAccounts)
      .catch(() => {})
  }, [])

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
        if (result.errors?.length > 0) {
          console.warn('Import errors:', result.errors)
        }
        fetchSkus()
      }
    } finally {
      setCsvUploading(false)
      if (csvInputRef.current) csvInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Master Catalog</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage master SKUs and their marketplace mappings
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleCsvImport}
          />
          <Button
            variant="outline"
            onClick={() => csvInputRef.current?.click()}
            disabled={csvUploading}
          >
            <Upload className="h-4 w-4 mr-2" />
            {csvUploading ? 'Importing…' : 'Bulk Import CSV'}
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Master SKU
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search SKUs…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
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
                <TableHead className="text-right">Actions</TableHead>
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
              ) : skus.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    {search ? 'No SKUs match your search.' : 'No master SKUs yet. Add your first SKU above.'}
                  </TableCell>
                </TableRow>
              ) : (
                skus.map(sku => (
                  <TableRow key={sku.id}>
                    <TableCell className="font-medium">{sku.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
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
          <DialogHeader>
            <DialogTitle>Add Master SKU</DialogTitle>
          </DialogHeader>
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

      {/* Edit SKU Dialog */}
      <Dialog open={!!editSku} onOpenChange={open => !open && setEditSku(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Master SKU</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>SKU Name <span className="text-destructive">*</span></Label>
              <Input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleEdit()}
              />
            </div>
            <div className="space-y-1">
              <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
              />
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
  if (skus.length === 0) {
    return <span className="text-xs text-muted-foreground italic">Not mapped</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {skus.map(s => (
        <span key={s} className={`text-xs px-1.5 py-0.5 rounded border font-mono ${colors[platform]}`}>
          {s}
        </span>
      ))}
    </div>
  )
}
