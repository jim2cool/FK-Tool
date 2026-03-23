'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import type { UnmappedSku } from '@/lib/labels/types'

interface MasterSkuOption { id: string; name: string }

interface UnmappedSkuPanelProps {
  unmapped: UnmappedSku[]
  masterSkus: MasterSkuOption[]
  userRole: 'owner' | 'admin' | 'manager' | 'staff' | 'member'
  onMapped: (platformSku: string, masterSkuId: string) => void
}

export function UnmappedSkuPanel({ unmapped, masterSkus, userRole, onMapped }: UnmappedSkuPanelProps) {
  const [mappingSelections, setMappingSelections] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const canMap = userRole === 'owner' || userRole === 'admin' || userRole === 'manager'

  async function handleSaveMapping(platformSku: string) {
    const masterSkuId = mappingSelections[platformSku]
    if (!masterSkuId) return
    setSaving(platformSku)
    try {
      const res = await fetch('/api/catalog/sku-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform_sku: platformSku, master_sku_id: masterSkuId, platform: 'flipkart' }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success(`Mapped "${platformSku}" successfully`)
      onMapped(platformSku, masterSkuId)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  if (unmapped.length === 0) return null

  return (
    <div className="border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-yellow-600" />
        <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">{unmapped.length} unknown SKU{unmapped.length > 1 ? 's' : ''} — labels not sorted</span>
      </div>
      {!canMap && <p className="text-xs text-muted-foreground mb-3">Contact your manager to map these SKUs to master products.</p>}
      <div className="space-y-2">
        {unmapped.map(item => (
          <div key={item.platformSku} className="flex items-center gap-3 text-sm">
            <Badge variant="outline" className="shrink-0">{item.count}</Badge>
            <span className="font-mono text-xs truncate max-w-[200px]" title={item.platformSku}>{item.platformSku}</span>
            <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={item.productDescription}>{item.productDescription}</span>
            {canMap && (
              <>
                <Select value={mappingSelections[item.platformSku] ?? ''} onValueChange={v => setMappingSelections(prev => ({ ...prev, [item.platformSku]: v }))}>
                  <SelectTrigger className="w-[200px] h-8 text-xs"><SelectValue placeholder="Map to product..." /></SelectTrigger>
                  <SelectContent>{masterSkus.map(sku => <SelectItem key={sku.id} value={sku.id}>{sku.name}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" variant="outline" disabled={!mappingSelections[item.platformSku] || saving === item.platformSku} onClick={() => handleSaveMapping(item.platformSku)}>
                  {saving === item.platformSku ? 'Saving...' : 'Map'}
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
