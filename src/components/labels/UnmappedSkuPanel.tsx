'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Package } from 'lucide-react'
import { toast } from 'sonner'
import type { UnmappedSku, ComboComponent } from '@/lib/labels/types'

interface MasterSkuOption { id: string; name: string }

interface ComboOption {
  id: string
  name: string
  components: ComboComponent[]
}

export type MappingResult =
  | { type: 'simple'; masterSkuId: string; masterSkuName: string }
  | { type: 'combo'; comboProductId: string; comboProductName: string; components: ComboComponent[] }

interface UnmappedSkuPanelProps {
  unmapped: UnmappedSku[]
  masterSkus: MasterSkuOption[]
  userRole: 'owner' | 'admin' | 'manager' | 'staff' | 'member'
  onMapped: (platformSku: string, result: MappingResult) => void
}

export function UnmappedSkuPanel({ unmapped, masterSkus, userRole, onMapped }: UnmappedSkuPanelProps) {
  const [mappingSelections, setMappingSelections] = useState<Record<string, string>>({})
  const [mappingMode, setMappingMode] = useState<Record<string, 'simple' | 'combo'>>({})
  const [comboSelections, setComboSelections] = useState<Record<string, string>>({})
  const [combos, setCombos] = useState<ComboOption[]>([])
  const [saving, setSaving] = useState<string | null>(null)
  const canMap = userRole === 'owner' || userRole === 'admin' || userRole === 'manager'

  // Load combos when panel mounts
  useEffect(() => {
    if (!canMap || unmapped.length === 0) return
    fetch('/api/catalog/combos')
      .then(res => res.ok ? res.json() : [])
      .then((data: Array<{ id: string; name: string; components: Array<{ masterSkuId: string; masterSkuName: string; quantity: number }> }>) => {
        setCombos(data.map(c => ({
          id: c.id,
          name: c.name,
          components: c.components.map(comp => ({
            masterSkuId: comp.masterSkuId,
            masterSkuName: comp.masterSkuName,
            quantity: comp.quantity,
          })),
        })))
      })
      .catch(() => { /* ignore — combo dropdown just won't show */ })
  }, [canMap, unmapped.length])

  function getMode(platformSku: string): 'simple' | 'combo' {
    return mappingMode[platformSku] ?? 'simple'
  }

  async function handleSaveMapping(platformSku: string) {
    const mode = getMode(platformSku)

    if (mode === 'simple') {
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
        const skuName = masterSkus.find(s => s.id === masterSkuId)?.name ?? ''
        toast.success(`Mapped "${platformSku}" successfully`)
        onMapped(platformSku, { type: 'simple', masterSkuId, masterSkuName: skuName })
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setSaving(null)
      }
    } else {
      const comboId = comboSelections[platformSku]
      if (!comboId) return
      const combo = combos.find(c => c.id === comboId)
      if (!combo) return
      setSaving(platformSku)
      try {
        const res = await fetch('/api/catalog/sku-mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform_sku: platformSku, combo_product_id: comboId, platform: 'flipkart' }),
        })
        if (!res.ok) throw new Error(await res.text())
        toast.success(`Mapped "${platformSku}" to combo "${combo.name}"`)
        onMapped(platformSku, {
          type: 'combo',
          comboProductId: combo.id,
          comboProductName: combo.name,
          components: combo.components,
        })
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setSaving(null)
      }
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
        {unmapped.map(item => {
          const mode = getMode(item.platformSku)
          return (
            <div key={item.platformSku} className="flex items-center gap-3 text-sm">
              <Badge variant="outline" className="shrink-0">{item.count}</Badge>
              <span className="font-mono text-xs truncate max-w-[200px]" title={item.platformSku}>{item.platformSku}</span>
              <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={item.productDescription}>{item.productDescription}</span>
              {canMap && (
                <>
                  {/* Mode toggle */}
                  {combos.length > 0 && (
                    <Button
                      variant={mode === 'combo' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7 text-xs px-2 shrink-0"
                      onClick={() => setMappingMode(prev => ({ ...prev, [item.platformSku]: mode === 'combo' ? 'simple' : 'combo' }))}
                      title={mode === 'combo' ? 'Switch to single product' : 'Map as combo'}
                    >
                      <Package className="h-3 w-3 mr-1" />
                      Combo
                    </Button>
                  )}

                  {mode === 'simple' ? (
                    <Select value={mappingSelections[item.platformSku] ?? ''} onValueChange={v => setMappingSelections(prev => ({ ...prev, [item.platformSku]: v }))}>
                      <SelectTrigger className="w-[200px] h-8 text-xs"><SelectValue placeholder="Map to product..." /></SelectTrigger>
                      <SelectContent>{masterSkus.map(sku => <SelectItem key={sku.id} value={sku.id}>{sku.name}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : (
                    <Select value={comboSelections[item.platformSku] ?? ''} onValueChange={v => setComboSelections(prev => ({ ...prev, [item.platformSku]: v }))}>
                      <SelectTrigger className="w-[200px] h-8 text-xs"><SelectValue placeholder="Map to combo..." /></SelectTrigger>
                      <SelectContent>
                        {combos.map(combo => (
                          <SelectItem key={combo.id} value={combo.id}>
                            {combo.name} ({combo.components.map(c => `${c.quantity}x ${c.masterSkuName}`).join(', ')})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      (mode === 'simple' ? !mappingSelections[item.platformSku] : !comboSelections[item.platformSku])
                      || saving === item.platformSku
                    }
                    onClick={() => handleSaveMapping(item.platformSku)}
                  >
                    {saving === item.platformSku ? 'Saving...' : 'Map'}
                  </Button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
