# Product Variants Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add opt-in parent → variant hierarchy to the Master Catalog using a self-referential `master_skus` table.

**Architecture:** Two nullable columns (`parent_id`, `variant_attributes`) are added to `master_skus`. Existing flat SKUs are unchanged. The catalog page renders parent rows (expandable) and variant rows (indented). CSV import gains optional `parent_sku_name` and variant attribute column mappings. All existing FKs (`sku_mappings`, `purchases`, `dispatches`, `orders`, `returns`) are untouched.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres + MCP tool for migrations), shadcn/Radix UI, Tailwind CSS v4

**Design doc:** `docs/plans/2026-02-26-product-variants-design.md`

---

## Task 1: Apply DB migration

**Files:**
- Supabase dashboard / MCP migration tool

**Step 1: Apply the SQL migration using the Supabase MCP tool**

Use `mcp__7503a887-f115-435f-8429-f7341857e2a4__apply_migration` with:
- `name`: `add_variant_support_to_master_skus`
- `query`:
```sql
ALTER TABLE master_skus
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES master_skus(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS variant_attributes JSONB;

CREATE INDEX IF NOT EXISTS idx_master_skus_parent_id
  ON master_skus(parent_id)
  WHERE parent_id IS NOT NULL;
```

**Step 2: Verify columns exist**

Run via `mcp__7503a887-f115-435f-8429-f7341857e2a4__execute_sql`:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'master_skus'
  AND column_name IN ('parent_id', 'variant_attributes')
ORDER BY column_name;
```
Expected: 2 rows returned — `parent_id` (uuid, YES) and `variant_attributes` (jsonb, YES).

**Step 3: Commit**
```bash
git add -A
git commit -m "feat(catalog): DB migration — add parent_id + variant_attributes to master_skus"
```

---

## Task 2: Update TypeScript types

**Files:**
- Modify: `src/types/database.ts`
- Modify: `src/app/(dashboard)/catalog/page.tsx` (interface section at top)

**Step 1: Update `MasterSku` in `src/types/database.ts`**

Find:
```typescript
export interface MasterSku {
  id: string
  tenant_id: string
  name: string
  description: string | null
  created_at: string
}
```

Replace with:
```typescript
export interface MasterSku {
  id: string
  tenant_id: string
  name: string
  description: string | null
  parent_id: string | null
  variant_attributes: Record<string, string> | null
  is_archived: boolean
  created_at: string
}
```

**Step 2: Update the local `MasterSku` interface in `catalog/page.tsx`**

Find the interface at the top of the file:
```typescript
interface MasterSku {
  id: string
  name: string
  description: string | null
  is_archived: boolean
  created_at: string
  sku_mappings: SkuMapping[]
  warehouse_summaries: WarehouseSummary[]
}
```

Replace with:
```typescript
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
```

**Step 3: TypeScript check**
```bash
cd /path/to/FK-Tool && npx tsc --noEmit 2>&1 | grep -v "^$"
```
Expected: errors only in files we haven't updated yet (route.ts, etc.) — that's fine at this stage.

**Step 4: Commit**
```bash
git add src/types/database.ts src/app/'(dashboard)'/catalog/page.tsx
git commit -m "feat(catalog): add parent_id + variant_attributes + Variant type to TS types"
```

---

## Task 3: Update GET /api/catalog/master-skus

**Files:**
- Modify: `src/app/api/catalog/master-skus/route.ts`

The new strategy: fetch ALL non-archived SKUs in one query, then group into parent + variants in JS. This avoids PostgREST self-join complexity.

**Step 1: Replace the entire GET function**

```typescript
export async function GET(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')
    const warehouseId = searchParams.get('warehouse_id')
    const platform = searchParams.get('platform')

    // Fetch ALL non-archived SKUs (parents, variants, flat) in one query
    let query = supabase
      .from('master_skus')
      .select(`*, sku_mappings(id, platform, platform_sku, marketplace_account_id)`)
      .eq('tenant_id', tenantId)
      .eq('is_archived', false)
      .order('name')

    // Search only on top-level names (parent or flat SKU)
    if (search) query = query.ilike('name', `%${search}%`)

    const { data: allSkus, error } = await query
    if (error) throw error

    // Platform filter: find which SKU IDs have a mapping for this platform
    let platformFilterIds: string[] | null = null
    if (platform) {
      const { data: mapped } = await supabase
        .from('sku_mappings')
        .select('master_sku_id')
        .eq('tenant_id', tenantId)
        .eq('platform', platform)
      platformFilterIds = (mapped ?? []).map(m => m.master_sku_id)
    }

    // Build purchase summaries
    let purchaseQuery = supabase
      .from('purchases')
      .select('master_sku_id, warehouse_id, quantity, total_cogs, warehouses(id, name, location)')
      .eq('tenant_id', tenantId)
    if (warehouseId) purchaseQuery = purchaseQuery.eq('warehouse_id', warehouseId)
    const { data: purchases } = await purchaseQuery

    type WhSummary = {
      warehouse_id: string; warehouse_name: string; location: string | null
      total_qty: number; total_cogs: number; avg_cogs: number
    }
    const summaryMap: Record<string, WhSummary[]> = {}
    for (const p of purchases ?? []) {
      const wh = p.warehouses as unknown as { id: string; name: string; location: string | null } | null
      if (!wh) continue
      if (!summaryMap[p.master_sku_id]) summaryMap[p.master_sku_id] = []
      const existing = summaryMap[p.master_sku_id].find(s => s.warehouse_id === wh.id)
      if (existing) {
        existing.total_qty += p.quantity
        existing.total_cogs += Number(p.total_cogs)
        existing.avg_cogs = existing.total_cogs / existing.total_qty
      } else {
        summaryMap[p.master_sku_id].push({
          warehouse_id: wh.id, warehouse_name: wh.name, location: wh.location,
          total_qty: p.quantity, total_cogs: Number(p.total_cogs),
          avg_cogs: Number(p.total_cogs) / p.quantity,
        })
      }
    }

    // Separate variants from top-level rows
    const topLevel = (allSkus ?? []).filter(s => s.parent_id === null)
    const variantRows = (allSkus ?? []).filter(s => s.parent_id !== null)

    // Aggregate warehouse summaries for a parent from its variants
    function aggregateSummaries(ids: string[]): WhSummary[] {
      const agg: Record<string, WhSummary> = {}
      for (const id of ids) {
        for (const s of summaryMap[id] ?? []) {
          if (!agg[s.warehouse_id]) {
            agg[s.warehouse_id] = { ...s }
          } else {
            agg[s.warehouse_id].total_qty += s.total_qty
            agg[s.warehouse_id].total_cogs += s.total_cogs
            agg[s.warehouse_id].avg_cogs =
              agg[s.warehouse_id].total_cogs / agg[s.warehouse_id].total_qty
          }
        }
      }
      return Object.values(agg)
    }

    // Build enriched result
    let result = topLevel.map(sku => {
      const variants = variantRows
        .filter(v => v.parent_id === sku.id)
        .map(v => ({ ...v, warehouse_summaries: summaryMap[v.id] ?? [] }))

      const warehouseSummaries = variants.length > 0
        ? aggregateSummaries(variants.map(v => v.id))
        : (summaryMap[sku.id] ?? [])

      return { ...sku, variants, warehouse_summaries: warehouseSummaries }
    })

    // Apply platform filter: flat SKUs or parents with matching variant
    if (platformFilterIds !== null) {
      const ids = platformFilterIds
      result = result.filter(s =>
        s.variants.length === 0
          ? ids.includes(s.id)
          : s.variants.some(v => ids.includes(v.id))
      )
    }

    // Apply warehouse filter: only keep SKUs with stock in that warehouse
    if (warehouseId) {
      result = result.filter(s =>
        s.warehouse_summaries.some(w => w.warehouse_id === warehouseId)
      )
    }

    return NextResponse.json(result)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

**Step 2: TypeScript check**
```bash
npx tsc --noEmit 2>&1 | grep -v "^$"
```
Expected: no new errors in route.ts.

**Step 3: Commit**
```bash
git add src/app/api/catalog/master-skus/route.ts
git commit -m "feat(catalog): GET master-skus returns nested variants with aggregated warehouse summaries"
```

---

## Task 4: Update POST and PATCH endpoints

**Files:**
- Modify: `src/app/api/catalog/master-skus/route.ts`

**Step 1: Replace the POST function**

```typescript
export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { name, description, parent_id, variant_attributes } = await request.json()

    // If parent_id provided, validate it exists and is itself a top-level row
    if (parent_id) {
      const { data: parent, error: parentErr } = await supabase
        .from('master_skus')
        .select('id, parent_id')
        .eq('id', parent_id)
        .eq('tenant_id', tenantId)
        .single()
      if (parentErr || !parent) {
        return NextResponse.json({ error: 'Parent SKU not found' }, { status: 400 })
      }
      if (parent.parent_id !== null) {
        return NextResponse.json({ error: 'Cannot create a variant of a variant' }, { status: 400 })
      }
    }

    const { data, error } = await supabase
      .from('master_skus')
      .insert({ tenant_id: tenantId, name, description, parent_id: parent_id ?? null, variant_attributes: variant_attributes ?? null })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

**Step 2: Replace the PATCH function**

```typescript
export async function PATCH(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { id, name, description, variant_attributes } = await request.json()
    const update: Record<string, unknown> = { name, description }
    if (variant_attributes !== undefined) update.variant_attributes = variant_attributes
    const { data, error } = await supabase
      .from('master_skus')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

**Step 3: TypeScript check**
```bash
npx tsc --noEmit 2>&1 | grep -v "^$"
```
Expected: no errors.

**Step 4: Commit**
```bash
git add src/app/api/catalog/master-skus/route.ts
git commit -m "feat(catalog): POST/PATCH master-skus accept parent_id + variant_attributes"
```

---

## Task 5: Update catalog page UI — expandable parent rows

**Files:**
- Modify: `src/app/(dashboard)/catalog/page.tsx`

This is the largest UI change. The table gains expandable parent rows and indented variant rows.

**Step 1: Add expand state and Add Variant dialog state to the component**

Find the `// CSV Import dialog` state section and add after it:
```typescript
  // Expanded parents
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set())
  function toggleExpanded(id: string) {
    setExpandedParents(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Add Variant dialog
  const [addVariantParent, setAddVariantParent] = useState<MasterSku | null>(null)
```

**Step 2: Add `ChevronRight`, `ChevronDown` to lucide imports**

Change:
```typescript
import { Plus, Search, Edit2, Map, Upload, X } from 'lucide-react'
```
To:
```typescript
import { Plus, Search, Edit2, Map, Upload, X, ChevronRight, ChevronDown } from 'lucide-react'
```

**Step 3: Update the "Add Master SKU" dialog to support parent products**

Add `addHasVariants` state alongside `addOpen`:
```typescript
  const [addHasVariants, setAddHasVariants] = useState(false)
```

Find the Add SKU Dialog JSX and add a checkbox inside the form fields:
```tsx
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="hasVariants"
                checked={addHasVariants}
                onChange={e => setAddHasVariants(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="hasVariants" className="text-sm font-normal cursor-pointer">
                This product has variants (size, color, etc.)
              </Label>
            </div>
```

Update `handleAdd` to pass no-op when creating a parent product (no platform mapping needed — just create the parent row). No API change needed since POST already works — the UI just creates a flat or parent SKU based on the checkbox.

Find the dialog reset in `handleAdd` success and add:
```typescript
      setAddHasVariants(false)
```

**Step 4: Replace the table body rows section**

Find and replace the rows rendering section (the `skus.map(sku => ...)` block) with this new version that handles parents, variants, and flat SKUs:

```tsx
              ) : (
                skus.map(sku => {
                  const isParent = sku.variants.length > 0
                  const isExpanded = expandedParents.has(sku.id)

                  return (
                    <>
                      {/* Parent / flat SKU row */}
                      <TableRow key={sku.id} className={isParent ? 'bg-muted/20' : undefined}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1.5">
                            {isParent && (
                              <button
                                onClick={() => toggleExpanded(sku.id)}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                {isExpanded
                                  ? <ChevronDown className="h-4 w-4" />
                                  : <ChevronRight className="h-4 w-4" />}
                              </button>
                            )}
                            {!isParent && <span className="w-5" />}
                            <span>{sku.name}</span>
                            {isParent && (
                              <span className="text-xs text-muted-foreground ml-1">
                                ({sku.variants.length} variant{sku.variants.length !== 1 ? 's' : ''})
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm max-w-[160px] truncate">
                          {sku.description ?? '—'}
                        </TableCell>
                        <TableCell>
                          {isParent ? '—' : <PlatformSkuCell skus={getPlatformSkus(sku, 'flipkart')} platform="flipkart" />}
                        </TableCell>
                        <TableCell>
                          {isParent ? '—' : <PlatformSkuCell skus={getPlatformSkus(sku, 'amazon')} platform="amazon" />}
                        </TableCell>
                        <TableCell>
                          {isParent ? '—' : <PlatformSkuCell skus={getPlatformSkus(sku, 'd2c')} platform="d2c" />}
                        </TableCell>
                        <TableCell>
                          <WarehouseNameCell summaries={sku.warehouse_summaries} />
                        </TableCell>
                        <TableCell>
                          <WarehouseQtyCell summaries={sku.warehouse_summaries} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(sku)}>
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            {isParent ? (
                              <Button variant="ghost" size="sm" onClick={() => setAddVariantParent(sku)}>
                                <Plus className="h-3.5 w-3.5 mr-1" />
                                Variant
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" onClick={() => setMappingSku(sku)}>
                                <Map className="h-3.5 w-3.5 mr-1" />
                                Map
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* Expanded variant rows */}
                      {isParent && isExpanded && sku.variants.map(variant => (
                        <TableRow key={variant.id} className="bg-muted/5 border-l-2 border-l-muted">
                          <TableCell className="font-medium pl-10">
                            <div className="flex items-center gap-2">
                              <span className="text-sm">{variant.name}</span>
                              {variant.variant_attributes && Object.entries(variant.variant_attributes).map(([k, v]) => (
                                <span key={k} className="text-xs px-1.5 py-0.5 rounded bg-secondary border text-secondary-foreground">
                                  {k}: {v}
                                </span>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm max-w-[160px] truncate">
                            {variant.description ?? '—'}
                          </TableCell>
                          <TableCell>
                            <PlatformSkuCell skus={variant.sku_mappings.filter(m => m.platform === 'flipkart').map(m => m.platform_sku)} platform="flipkart" />
                          </TableCell>
                          <TableCell>
                            <PlatformSkuCell skus={variant.sku_mappings.filter(m => m.platform === 'amazon').map(m => m.platform_sku)} platform="amazon" />
                          </TableCell>
                          <TableCell>
                            <PlatformSkuCell skus={variant.sku_mappings.filter(m => m.platform === 'd2c').map(m => m.platform_sku)} platform="d2c" />
                          </TableCell>
                          <TableCell>
                            <WarehouseNameCell summaries={variant.warehouse_summaries} />
                          </TableCell>
                          <TableCell>
                            <WarehouseQtyCell summaries={variant.warehouse_summaries} />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => openEdit(variant as unknown as MasterSku)}>
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setMappingSku(variant as unknown as MasterSku)}>
                                <Map className="h-3.5 w-3.5 mr-1" />
                                Map
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </>
                  )
                })
              )}
```

**Step 5: Add the AddVariantDialog to the JSX**

Add an import at the top:
```typescript
import { AddVariantDialog } from '@/components/catalog/AddVariantDialog'
```

Add before the closing `</div>` of the return block (after CsvImportDialog):
```tsx
      {/* Add Variant Dialog */}
      {addVariantParent && (
        <AddVariantDialog
          open={!!addVariantParent}
          onOpenChange={open => !open && setAddVariantParent(null)}
          parentSku={addVariantParent}
          marketplaceAccounts={accounts}
          onSaved={fetchSkus}
        />
      )}
```

**Step 6: TypeScript check**
```bash
npx tsc --noEmit 2>&1 | grep -v "^$"
```
Expected: error about missing `AddVariantDialog` (it doesn't exist yet) — that's fine.

**Step 7: Commit**
```bash
git add src/app/'(dashboard)'/catalog/page.tsx
git commit -m "feat(catalog): expandable parent rows + variant display in catalog table"
```

---

## Task 6: Create AddVariantDialog component

**Files:**
- Create: `src/components/catalog/AddVariantDialog.tsx`

**Step 1: Create the file**

```typescript
// src/components/catalog/AddVariantDialog.tsx
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
          <DialogTitle>Add Variant to "{parentSku.name}"</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Variant Name <span className="text-destructive">*</span></Label>
            <Input
              placeholder="e.g. Premium Cotton T-Shirt - White - L"
              value={name}
              onChange={e => setName(e.target.value)}
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
```

**Step 2: TypeScript check**
```bash
npx tsc --noEmit 2>&1 | grep -v "^$"
```
Expected: no errors.

**Step 3: Run build**
```bash
npm run build 2>&1 | tail -20
```
Expected: all routes green.

**Step 4: Commit**
```bash
git add src/components/catalog/AddVariantDialog.tsx
git commit -m "feat(catalog): AddVariantDialog — create variant with attributes then map platform SKUs"
```

---

## Task 7: Update CSV importer to support parent_sku_name + variant attributes

**Files:**
- Modify: `src/lib/importers/sku-mapping-importer.ts`

**Step 1: Update `CsvColumnMapping` interface**

Find:
```typescript
export interface CsvColumnMapping {
  master_sku_name: string
  flipkart_sku: string | null
  amazon_sku: string | null
  d2c_sku: string | null
  description: string | null
}
```

Replace with:
```typescript
export interface CsvColumnMapping {
  master_sku_name: string
  flipkart_sku: string | null
  amazon_sku: string | null
  d2c_sku: string | null
  description: string | null
  parent_sku_name: string | null
  variant_attr_cols: Array<{ csv_col: string; attr_key: string }>
}
```

**Step 2: Update `importSkuMappingCsv` to handle the parent/variant flow**

Find the section that starts with:
```typescript
    const masterSkuName = row[mapping.master_sku_name]?.trim()
```

Replace the entire per-row logic block (from `const masterSkuName` down to and including `return { created, updated, failed, errors }`) with:

```typescript
    const variantSkuName = row[mapping.master_sku_name]?.trim()
    if (!variantSkuName) {
      failed++
      errors.push({ row: rowNum, sku: '(blank)', message: 'Master SKU Name is empty' })
      continue
    }

    const description = mapping.description ? row[mapping.description]?.trim() || null : null
    const parentSkuName = mapping.parent_sku_name ? row[mapping.parent_sku_name]?.trim() || null : null

    // ── Variant import path ─────────────────────────────────────────────────
    if (parentSkuName) {
      // Upsert parent product (no platform mappings on parent)
      let parentId: string
      const { data: existingParent } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', parentSkuName)
        .is('parent_id', null)
        .single()

      if (existingParent) {
        parentId = existingParent.id
      } else {
        const { data: newParent, error: parentErr } = await supabase
          .from('master_skus')
          .insert({ tenant_id: tenantId, name: parentSkuName })
          .select('id')
          .single()
        if (parentErr || !newParent) {
          failed++
          errors.push({ row: rowNum, sku: variantSkuName, message: `Failed to create parent "${parentSkuName}": ${parentErr?.message}` })
          continue
        }
        parentId = newParent.id
      }

      // Build variant_attributes from mapped columns
      const variantAttributes: Record<string, string> = {}
      for (const { csv_col, attr_key } of (mapping.variant_attr_cols ?? [])) {
        const val = row[csv_col]?.trim()
        if (val && attr_key.trim()) variantAttributes[attr_key.trim()] = val
      }

      // Upsert variant under parent
      const { data: existingVariant } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', variantSkuName)
        .eq('parent_id', parentId)
        .single()

      let skuId: string
      if (existingVariant) {
        if (description !== null || Object.keys(variantAttributes).length > 0) {
          const upd: Record<string, unknown> = {}
          if (description !== null) upd.description = description
          if (Object.keys(variantAttributes).length > 0) upd.variant_attributes = variantAttributes
          await supabase.from('master_skus').update(upd).eq('id', existingVariant.id)
        }
        skuId = existingVariant.id
        updated++
      } else {
        const { data: newVariant, error: vErr } = await supabase
          .from('master_skus')
          .insert({
            tenant_id: tenantId,
            name: variantSkuName,
            description,
            parent_id: parentId,
            variant_attributes: Object.keys(variantAttributes).length > 0 ? variantAttributes : null,
          })
          .select('id')
          .single()
        if (vErr || !newVariant) {
          failed++
          errors.push({ row: rowNum, sku: variantSkuName, message: vErr?.message ?? 'Insert failed' })
          continue
        }
        skuId = newVariant.id
        created++
      }

      // Upsert platform mappings onto the variant
      const platforms = [
        { platform: 'flipkart' as const, col: mapping.flipkart_sku },
        { platform: 'amazon' as const, col: mapping.amazon_sku },
        { platform: 'd2c' as const, col: mapping.d2c_sku },
      ]
      for (const { platform, col } of platforms) {
        if (!col) continue
        const platformSku = row[col]?.trim()
        if (!platformSku) continue
        const { data: existingMapping } = await supabase
          .from('sku_mappings').select('master_sku_id')
          .eq('tenant_id', tenantId).eq('platform', platform).eq('platform_sku', platformSku).single()
        if (existingMapping && existingMapping.master_sku_id !== skuId) {
          errors.push({ row: rowNum, sku: variantSkuName, message: `${platform} SKU "${platformSku}" already mapped to a different SKU` })
          continue
        }
        const { error } = await supabase.from('sku_mappings').upsert(
          { tenant_id: tenantId, master_sku_id: skuId, platform, platform_sku: platformSku },
          { onConflict: 'tenant_id,platform,platform_sku' }
        )
        if (error) {
          failed++
          errors.push({ row: rowNum, sku: variantSkuName, message: `${platform} mapping: ${error.message}` })
        }
      }

      continue  // done with this row
    }

    // ── Flat SKU import path (existing logic, unchanged) ───────────────────
    const masterSkuName = variantSkuName

    const { data: existing } = await supabase
      .from('master_skus')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', masterSkuName)
      .is('parent_id', null)
      .single()

    let skuId: string

    if (existing) {
      if (description !== null) {
        const { error: updateError } = await supabase
          .from('master_skus')
          .update({ description })
          .eq('id', existing.id)
        if (updateError) {
          errors.push({ row: rowNum, sku: masterSkuName, message: `Description update failed: ${updateError.message}` })
        }
      }
      skuId = existing.id
      updated++
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('master_skus')
        .insert({ tenant_id: tenantId, name: masterSkuName, description })
        .select('id')
        .single()
      if (insertError || !inserted) {
        failed++
        errors.push({ row: rowNum, sku: masterSkuName, message: insertError?.message ?? 'Insert failed' })
        continue
      }
      skuId = inserted.id
      created++
    }

    const platforms = [
      { platform: 'flipkart' as const, col: mapping.flipkart_sku },
      { platform: 'amazon' as const, col: mapping.amazon_sku },
      { platform: 'd2c' as const, col: mapping.d2c_sku },
    ]
    for (const { platform, col } of platforms) {
      if (!col) continue
      const platformSku = row[col]?.trim()
      if (!platformSku) continue
      const { data: existingMapping } = await supabase
        .from('sku_mappings').select('master_sku_id')
        .eq('tenant_id', tenantId).eq('platform', platform).eq('platform_sku', platformSku).single()
      if (existingMapping && existingMapping.master_sku_id !== skuId) {
        failed++
        errors.push({ row: rowNum, sku: masterSkuName, message: `${platform} SKU "${platformSku}" is already mapped to a different master SKU` })
        continue
      }
      const { error } = await supabase.from('sku_mappings').upsert(
        { tenant_id: tenantId, master_sku_id: skuId, platform, platform_sku: platformSku },
        { onConflict: 'tenant_id,platform,platform_sku' }
      )
      if (error) {
        failed++
        errors.push({ row: rowNum, sku: masterSkuName, message: `${platform} mapping: ${error.message}` })
      }
    }
  }

  return { created, updated, failed, errors }
}
```

**Step 3: TypeScript check**
```bash
npx tsc --noEmit 2>&1 | grep -v "^$"
```
Expected: no errors.

**Step 4: Commit**
```bash
git add src/lib/importers/sku-mapping-importer.ts
git commit -m "feat(catalog): importer supports parent_sku_name + variant_attr_cols for variant import"
```

---

## Task 8: Update CsvImportDialog — add parent SKU name field + variant attribute section

**Files:**
- Modify: `src/components/catalog/CsvImportDialog.tsx`

**Step 1: Add `parent_sku_name` to `MAPPING_FIELDS`**

Find:
```typescript
const MAPPING_FIELDS: MappingField[] = [
  { key: 'master_sku_name', label: 'Master SKU Name', required: true },
  { key: 'flipkart_sku',    label: 'Flipkart SKU',    required: false },
  { key: 'amazon_sku',      label: 'Amazon SKU',      required: false },
  { key: 'd2c_sku',         label: 'D2C SKU',         required: false },
  { key: 'description',     label: 'Description',     required: false },
]
```

Replace with:
```typescript
const MAPPING_FIELDS: MappingField[] = [
  { key: 'master_sku_name', label: 'Master SKU Name', required: true },
  { key: 'parent_sku_name', label: 'Parent Product',  required: false },
  { key: 'flipkart_sku',    label: 'Flipkart SKU',    required: false },
  { key: 'amazon_sku',      label: 'Amazon SKU',      required: false },
  { key: 'd2c_sku',         label: 'D2C SKU',         required: false },
  { key: 'description',     label: 'Description',     required: false },
]
```

**Step 2: Update `SYNONYMS` to include `parent_sku_name`**

Find the `SYNONYMS` object and add:
```typescript
  parent_sku_name: ['parent', 'parentsku', 'parentproduct', 'productgroup', 'group', 'parentname', 'basename'],
```

**Step 3: Update `CsvColumnMapping` initial state in `autoDetect` and component `useState`**

The `CsvColumnMapping` interface (imported from the importer) now includes `parent_sku_name` and `variant_attr_cols`. Update the initial mapping state in the component:

Find:
```typescript
  const [mapping, setMapping] = useState<CsvColumnMapping>({ master_sku_name: '', flipkart_sku: null, amazon_sku: null, d2c_sku: null, description: null })
```

Replace with:
```typescript
  const [mapping, setMapping] = useState<CsvColumnMapping>({ master_sku_name: '', flipkart_sku: null, amazon_sku: null, d2c_sku: null, description: null, parent_sku_name: null, variant_attr_cols: [] })
  const [variantAttrCols, setVariantAttrCols] = useState<Array<{ csv_col: string; attr_key: string }>>([])
```

Update `autoDetect` return default to include new fields:
```typescript
  const mapping: CsvColumnMapping = {
    master_sku_name: '',
    flipkart_sku: null,
    amazon_sku: null,
    d2c_sku: null,
    description: null,
    parent_sku_name: null,
    variant_attr_cols: [],
  }
```

**Step 4: Update `handleClose` to reset `variantAttrCols`**

Find:
```typescript
    setShowErrors(false)
    onOpenChange(false)
```

Add before `onOpenChange(false)`:
```typescript
    setVariantAttrCols([])
```

**Step 5: Update `handleImport` to pass `variant_attr_cols`**

Find:
```typescript
        body: JSON.stringify({ csv: parsed.rawText, mapping }),
```

Replace with:
```typescript
        body: JSON.stringify({ csv: parsed.rawText, mapping: { ...mapping, variant_attr_cols: variantAttrCols } }),
```

**Step 6: Add variant attribute rows section to `renderMapping`**

Find the closing of the mapping table block just before the preview separator:
```typescript
        {/* Row preview */}
        {parsed.rows.length > 0 && (
```

Add the variant attributes section before the row preview:
```tsx
        {/* Variant attribute columns — shown only when Parent Product is mapped */}
        {mapping.parent_sku_name && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Variant Attributes <span className="text-muted-foreground font-normal normal-case">(optional — maps CSV columns to attribute keys)</span>
              </p>
              {variantAttrCols.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select
                    value={row.csv_col || SKIP}
                    onValueChange={v => setVariantAttrCols(prev =>
                      prev.map((r, idx) => idx === i ? { ...r, csv_col: v === SKIP ? '' : v } : r)
                    )}
                  >
                    <SelectTrigger className="w-44 h-8 text-sm">
                      <SelectValue placeholder="CSV column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SKIP}><span className="text-muted-foreground italic">— pick column —</span></SelectItem>
                      {parsed.headers.filter(h => h.trim() !== '').map(h => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground text-sm">→</span>
                  <Input
                    className="w-32 h-8 text-sm"
                    placeholder="Attribute key"
                    value={row.attr_key}
                    onChange={e => setVariantAttrCols(prev =>
                      prev.map((r, idx) => idx === i ? { ...r, attr_key: e.target.value } : r)
                    )}
                  />
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => setVariantAttrCols(prev => prev.filter((_, idx) => idx !== i))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {variantAttrCols.length < 3 && (
                <Button
                  variant="ghost" size="sm" className="text-xs"
                  onClick={() => setVariantAttrCols(prev => [...prev, { csv_col: '', attr_key: '' }])}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add attribute column
                </Button>
              )}
            </div>
          </>
        )}
```

Add `Plus` to the lucide import in `CsvImportDialog.tsx` (it's already imported — verify at top of file; if not present, add it).

**Step 7: TypeScript check**
```bash
npx tsc --noEmit 2>&1 | grep -v "^$"
```
Expected: no errors.

**Step 8: Full build**
```bash
npm run build 2>&1 | tail -25
```
Expected: all routes green.

**Step 9: Commit**
```bash
git add src/components/catalog/CsvImportDialog.tsx
git commit -m "feat(catalog): CsvImportDialog — parent_sku_name field + variant attribute column mapping"
```

---

## Task 9: Push + update PR

**Step 1: Push**
```bash
git push origin feat/phase-4-imports
```

**Step 2: Verify the PR shows all new commits**

Check https://github.com/jim2cool/FK-Tool/pull/2

---

## Manual Smoke Tests

After all tasks complete:

1. **DB check** — confirm `parent_id` and `variant_attributes` columns exist in Supabase
2. **Flat SKU unchanged** — existing catalog rows still show, edit/map still works
3. **Create parent** — Add Master SKU → check "Has variants" → create → appears in table with chevron
4. **Add variant** — Expand parent → click "+ Variant" → fill name + attributes → "Create & Map" → platform mapping dialog opens → save → variant appears indented with attribute badges
5. **Aggregate qty** — Add purchases against a variant → parent row shows summed qty
6. **CSV import — flat** — upload CSV without parent_sku_name column → works as before
7. **CSV import — variants** — upload CSV with Parent Product + Variant Name + Size columns → map Size → "variant attribute key: size" → import → check parent created + variants nested under it
