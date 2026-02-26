'use client'
import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { AlertTriangle, ChevronRight } from 'lucide-react'
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
  const accountRequired = accountsForPlatform.length > 0
  const canAdd = !!platformSku.trim() && (!accountRequired || !!marketplaceAccountId)

  function handlePlatformChange(p: Platform) {
    setPlatform(p)
    setMarketplaceAccountId('')
  }

  async function handleAdd() {
    if (!platformSku.trim()) return toast.error('Platform SKU is required')
    if (accountRequired && !marketplaceAccountId) return toast.error('Account is required')
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
          <DialogTitle>Channel Mappings — {masterSkuName}</DialogTitle>
        </DialogHeader>

        {/* Existing mappings */}
        <div className="space-y-2 max-h-52 overflow-y-auto">
          {existingMappings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No mappings yet.</p>
          ) : (
            existingMappings.map(m => {
              const accountName = m.marketplace_account_id
                ? marketplaceAccounts.find(a => a.id === m.marketplace_account_id)?.account_name
                : null
              return (
                <div key={m.id} className="flex items-center justify-between bg-muted/40 rounded-md px-3 py-2">
                  {/* Hierarchy: Channel › Account › SKU */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${platformColors[m.platform]}`}>
                      {platformLabels[m.platform]}
                    </span>
                    {accountName && (
                      <>
                        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground shrink-0">{accountName}</span>
                      </>
                    )}
                    <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-sm font-mono truncate">{m.platform_sku}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-destructive hover:text-destructive shrink-0 ml-2"
                    onClick={() => handleDelete(m.id)}
                    disabled={deletingId === m.id}
                  >
                    {deletingId === m.id ? '…' : 'Remove'}
                  </Button>
                </div>
              )
            })
          )}
        </div>

        <Separator />

        {/* Add new mapping — Channel → Account → SKU ID */}
        <div className="space-y-3">
          <p className="text-sm font-medium">Add new mapping</p>

          {/* Step 1: Channel */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Channel</Label>
            <Select value={platform} onValueChange={v => handlePlatformChange(v as Platform)}>
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

          {/* Step 2: Account (required when accounts exist) */}
          {accountsForPlatform.length > 0 ? (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Account <span className="text-destructive">*</span>
              </Label>
              <Select
                value={marketplaceAccountId || ''}
                onValueChange={setMarketplaceAccountId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select account…" />
                </SelectTrigger>
                <SelectContent>
                  {accountsForPlatform.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                No {platformLabels[platform]} accounts configured.
                Add one in <strong>Settings → Marketplace Accounts</strong> first.
              </span>
            </div>
          )}

          {/* Step 3: SKU ID */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              SKU ID <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="e.g. FK_SKU_001"
              value={platformSku}
              onChange={e => setPlatformSku(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canAdd && handleAdd()}
            />
          </div>

          {/* Visual hierarchy hint */}
          {(marketplaceAccountId || platformSku) && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 rounded px-3 py-1.5">
              <Badge variant="outline" className={`text-xs border ${platformColors[platform]}`}>
                {platformLabels[platform]}
              </Badge>
              {marketplaceAccountId && (
                <>
                  <ChevronRight className="h-3 w-3" />
                  <span>{accountsForPlatform.find(a => a.id === marketplaceAccountId)?.account_name}</span>
                </>
              )}
              {platformSku.trim() && (
                <>
                  <ChevronRight className="h-3 w-3" />
                  <span className="font-mono">{platformSku.trim()}</span>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={handleAdd} disabled={saving || !canAdd}>
            {saving ? 'Adding…' : 'Add Mapping'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
