'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'
import { SkuMappingDialog } from '@/components/catalog/SkuMappingDialog'

interface MarketplaceAccount {
  id: string
  platform: 'flipkart' | 'amazon' | 'd2c'
  account_name: string
}

interface MasterSku {
  id: string
  name: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  parentSku: MasterSku
  marketplaceAccounts: MarketplaceAccount[]
  onSaved: () => void
}

export function AddVariantDialog({ open, onOpenChange, parentSku, marketplaceAccounts, onSaved }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [attrs, setAttrs] = useState<Array<{ key: string; value: string }>>([{ key: '', value: '' }])
  const [loading, setLoading] = useState(false)
  const [createdVariantId, setCreatedVariantId] = useState<string | null>(null)
  const [showMapping, setShowMapping] = useState(false)

  function handleClose() {
    if (loading) return
    setName('')
    setDescription('')
    setAttrs([{ key: '', value: '' }])
    setCreatedVariantId(null)
    setShowMapping(false)
    onOpenChange(false)
  }

  function updateAttr(i: number, field: 'key' | 'value', val: string) {
    setAttrs(prev => prev.map((a, idx) => idx === i ? { ...a, [field]: val } : a))
  }

  function addAttr() {
    if (attrs.length >= 5) return
    setAttrs(prev => [...prev, { key: '', value: '' }])
  }

  function removeAttr(i: number) {
    setAttrs(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handleCreate() {
    if (!name.trim()) return toast.error('Variant name is required')
    setLoading(true)
    try {
      const variantAttributes = attrs
        .filter(a => a.key.trim() && a.value.trim())
        .reduce<Record<string, string>>((acc, a) => { acc[a.key.trim()] = a.value.trim(); return acc }, {})

      const res = await fetch('/api/catalog/master-skus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          parent_id: parentSku.id,
          variant_attributes: Object.keys(variantAttributes).length > 0 ? variantAttributes : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) return toast.error(data.error ?? 'Failed to create variant')

      toast.success('Variant created')
      setCreatedVariantId(data.id)
      setShowMapping(true)
      onSaved()
    } finally {
      setLoading(false)
    }
  }

  if (showMapping && createdVariantId) {
    return (
      <SkuMappingDialog
        open={open}
        onOpenChange={open => { if (!open) handleClose() }}
        masterSkuId={createdVariantId}
        masterSkuName={name}
        existingMappings={[]}
        marketplaceAccounts={marketplaceAccounts}
        onSaved={() => { onSaved(); handleClose() }}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Variant to &ldquo;{parentSku.name}&rdquo;</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Variant Name <span className="text-destructive">*</span></Label>
            <Input
              placeholder="e.g. Premium Cotton T-Shirt - White - L"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <div className="space-y-1">
            <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Variant Attributes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            {attrs.map((attr, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="w-28 text-sm"
                  placeholder="Key (e.g. size)"
                  value={attr.key}
                  onChange={e => updateAttr(i, 'key', e.target.value)}
                />
                <Input
                  className="flex-1 text-sm"
                  placeholder="Value (e.g. L)"
                  value={attr.value}
                  onChange={e => updateAttr(i, 'value', e.target.value)}
                />
                {attrs.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeAttr(i)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            {attrs.length < 5 && (
              <Button variant="ghost" size="sm" className="text-xs" onClick={addAttr}>
                <Plus className="h-3 w-3 mr-1" /> Add attribute
              </Button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={loading || !name.trim()}>
            {loading ? 'Creating…' : 'Create & Map Platform SKUs →'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
