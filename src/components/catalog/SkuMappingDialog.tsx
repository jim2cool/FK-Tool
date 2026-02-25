'use client'
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import type { Platform } from '@/types'

interface SkuMapping {
  id: string
  platform: Platform
  platform_sku: string
  marketplace_account_id: string | null
}

interface MarketplaceAccount {
  id: string
  platform: Platform
  account_name: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  masterSkuId: string
  masterSkuName: string
  existingMappings: SkuMapping[]
  marketplaceAccounts: MarketplaceAccount[]
  onSaved: () => void
}

const PLATFORMS: Platform[] = ['flipkart', 'amazon', 'd2c']

const platformLabels: Record<Platform, string> = {
  flipkart: 'Flipkart',
  amazon: 'Amazon',
  d2c: 'D2C',
}

const platformColors: Record<Platform, string> = {
  flipkart: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  amazon: 'bg-orange-100 text-orange-800 border-orange-200',
  d2c: 'bg-blue-100 text-blue-800 border-blue-200',
}

export function SkuMappingDialog({
  open, onOpenChange, masterSkuId, masterSkuName,
  existingMappings, marketplaceAccounts, onSaved
}: Props) {
  const [platform, setPlatform] = useState<Platform>('flipkart')
  const [platformSku, setPlatformSku] = useState('')
  const [marketplaceAccountId, setMarketplaceAccountId] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const accountsForPlatform = marketplaceAccounts.filter(a => a.platform === platform)

  async function handleAdd() {
    if (!platformSku.trim()) return toast.error('Platform SKU is required')
    setSaving(true)
    try {
      const res = await fetch('/api/catalog/sku-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          master_sku_id: masterSkuId,
          platform,
          platform_sku: platformSku.trim(),
          marketplace_account_id: marketplaceAccountId || undefined,
        }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Failed to add mapping')
      } else {
        toast.success('Mapping added')
        setPlatformSku('')
        setMarketplaceAccountId('')
        onSaved()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch('/api/catalog/sku-mappings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Failed to delete mapping')
      } else {
        toast.success('Mapping removed')
        onSaved()
      }
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>SKU Mappings — {masterSkuName}</DialogTitle>
        </DialogHeader>

        {/* Existing mappings */}
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {existingMappings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No mappings yet.</p>
          ) : (
            existingMappings.map(m => (
              <div key={m.id} className="flex items-center justify-between bg-muted/40 rounded-md px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${platformColors[m.platform]}`}>
                    {platformLabels[m.platform]}
                  </span>
                  <span className="text-sm font-mono">{m.platform_sku}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(m.id)}
                  disabled={deletingId === m.id}
                >
                  {deletingId === m.id ? '…' : 'Remove'}
                </Button>
              </div>
            ))
          )}
        </div>

        <Separator />

        {/* Add new mapping */}
        <div className="space-y-3">
          <p className="text-sm font-medium">Add new mapping</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Platform</Label>
              <Select value={platform} onValueChange={v => { setPlatform(v as Platform); setMarketplaceAccountId('') }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => (
                    <SelectItem key={p} value={p}>{platformLabels[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Platform SKU</Label>
              <Input
                placeholder="e.g. FK_SKU_001"
                value={platformSku}
                onChange={e => setPlatformSku(e.target.value)}
              />
            </div>
          </div>
          {accountsForPlatform.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Account (optional)</Label>
              <Select value={marketplaceAccountId} onValueChange={setMarketplaceAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Any account" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any account</SelectItem>
                  {accountsForPlatform.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={handleAdd} disabled={saving || !platformSku.trim()}>
            {saving ? 'Adding…' : 'Add Mapping'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
