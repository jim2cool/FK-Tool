# Purchases Page Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Overhaul the Purchases page with GST columns, bulk CSV import, month-accordion grouping (50 records paginated globally), and rename `unit_cost` → `unit_purchase_price` throughout.

**Architecture:** DB migration first (rename column + add 4 fields), then API updates, then new CSV import pipeline (same server-client pattern as catalog), then full page rewrite. No test framework — use `npx tsc --noEmit` + build as verification.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (server client via `@/lib/supabase/server`), PapaParse, Tailwind v4, shadcn/Radix UI, date-fns

**Design doc:** `docs/plans/2026-02-27-purchases-overhaul-design.md`

---

### Task 1: DB Migration

**Files:**
- No file edits — run migration via Supabase MCP tool

**Step 1: Apply migration**

Use `mcp__...__apply_migration` with project_id `aorcopafrixqlbgckrpu`, name `purchases_overhaul`, query:

```sql
-- Rename unit_cost to unit_purchase_price
ALTER TABLE purchases RENAME COLUMN unit_cost TO unit_purchase_price;

-- Add new columns
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS hsn_code       TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS gst_rate_slab  TEXT    DEFAULT '18%';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS tax_paid       BOOLEAN DEFAULT FALSE;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS invoice_number TEXT;
```

**Step 2: Verify**

Run SQL:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'purchases'
ORDER BY ordinal_position;
```
Expected: `unit_purchase_price` column exists, 4 new columns present.

**Step 3: Commit**
```bash
git commit --allow-empty -m "chore(db): rename unit_cost→unit_purchase_price, add gst/hsn/tax_paid/invoice columns"
```

---

### Task 2: Update TypeScript Types

**Files:**
- Modify: `src/types/database.ts`

**Step 1: Update Purchase interface**

Replace the existing `Purchase` interface:
```typescript
export interface Purchase {
  id: string
  tenant_id: string
  master_sku_id: string
  warehouse_id: string
  quantity: number
  unit_purchase_price: number   // renamed from unit_cost
  packaging_cost: number
  other_cost: number
  total_cogs: number | null
  supplier: string | null
  purchase_date: string
  received_date: string | null
  hsn_code: string | null       // new
  gst_rate_slab: string | null  // new — e.g. "18%"
  tax_paid: boolean             // new
  invoice_number: string | null // new
  created_at: string
  lot_id: string | null
}
```

**Step 2: Verify TypeScript**
```bash
npx tsc --noEmit
```
Expected: errors about `unit_cost` references in other files (we'll fix those next).

**Step 3: Commit**
```bash
git add src/types/database.ts
git commit -m "chore(types): update Purchase interface — unit_purchase_price + new GST fields"
```

---

### Task 3: Update `/api/purchases/route.ts`

**Files:**
- Modify: `src/app/api/purchases/route.ts`

**Step 1: Rewrite the route**

Replace entire file contents:

```typescript
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

function calcTotalCogs(unitPurchasePrice: number, packagingCost: number, otherCost: number, qty: number) {
  return (unitPurchasePrice + packagingCost + otherCost) * qty
}

export async function GET(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const warehouseId   = searchParams.get('warehouse_id')
    const masterSkuId   = searchParams.get('master_sku_id')
    const from          = searchParams.get('from')
    const to            = searchParams.get('to')
    const gstRateSlab   = searchParams.get('gst_rate_slab')
    const taxPaid       = searchParams.get('tax_paid') // 'true' | 'false' | null

    let query = supabase
      .from('purchases')
      .select(`*, master_skus(id, name, parent_id), warehouses(id, name)`)
      .eq('tenant_id', tenantId)
      .order('purchase_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (warehouseId)  query = query.eq('warehouse_id', warehouseId)
    if (masterSkuId)  query = query.eq('master_sku_id', masterSkuId)
    if (from)         query = query.gte('purchase_date', from)
    if (to)           query = query.lte('purchase_date', to)
    if (gstRateSlab)  query = query.eq('gst_rate_slab', gstRateSlab)
    if (taxPaid !== null) query = query.eq('tax_paid', taxPaid === 'true')

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const body = await request.json()
    const {
      master_sku_id, warehouse_id, quantity,
      unit_purchase_price, packaging_cost, other_cost,
      supplier, purchase_date, received_date,
      hsn_code, gst_rate_slab, tax_paid, invoice_number,
    } = body

    if (!quantity || quantity <= 0) throw new Error('Quantity must be greater than 0')
    if ((unit_purchase_price ?? 0) < 0) throw new Error('Unit purchase price cannot be negative')

    const total_cogs = calcTotalCogs(
      unit_purchase_price ?? 0,
      packaging_cost ?? 0,
      other_cost ?? 0,
      quantity
    )

    const { data, error } = await supabase
      .from('purchases')
      .insert({
        tenant_id: tenantId,
        master_sku_id,
        warehouse_id,
        quantity,
        unit_purchase_price: unit_purchase_price ?? 0,
        packaging_cost: packaging_cost ?? 0,
        other_cost: other_cost ?? 0,
        total_cogs,
        supplier: supplier || null,
        purchase_date,
        received_date: received_date || null,
        hsn_code: hsn_code || null,
        gst_rate_slab: gst_rate_slab || '18%',
        tax_paid: tax_paid ?? false,
        invoice_number: invoice_number || null,
      })
      .select(`*, master_skus(id, name, parent_id), warehouses(id, name)`)
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const body = await request.json()
    const {
      id, master_sku_id, warehouse_id, quantity,
      unit_purchase_price, packaging_cost, other_cost,
      supplier, purchase_date, received_date,
      hsn_code, gst_rate_slab, tax_paid, invoice_number,
    } = body

    if (!quantity || quantity <= 0) throw new Error('Quantity must be greater than 0')

    const total_cogs = calcTotalCogs(
      unit_purchase_price ?? 0,
      packaging_cost ?? 0,
      other_cost ?? 0,
      quantity
    )

    const { data, error } = await supabase
      .from('purchases')
      .update({
        master_sku_id,
        warehouse_id,
        quantity,
        unit_purchase_price: unit_purchase_price ?? 0,
        packaging_cost: packaging_cost ?? 0,
        other_cost: other_cost ?? 0,
        total_cogs,
        supplier: supplier || null,
        purchase_date,
        received_date: received_date || null,
        hsn_code: hsn_code || null,
        gst_rate_slab: gst_rate_slab || '18%',
        tax_paid: tax_paid ?? false,
        invoice_number: invoice_number || null,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(`*, master_skus(id, name, parent_id), warehouses(id, name)`)
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { id } = await request.json()
    const { error } = await supabase
      .from('purchases')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

**Step 2: Verify TypeScript**
```bash
npx tsc --noEmit
```
Expected: PASS (or only errors in purchases/page.tsx which we'll fix in Task 8)

**Step 3: Commit**
```bash
git add src/app/api/purchases/route.ts
git commit -m "feat(purchases): update API route — unit_purchase_price, GST fields, total_cogs recalc"
```

---

### Task 4: CSV Template Route

**Files:**
- Create: `src/app/api/purchases/csv-template/route.ts`

**Step 1: Create the file**

```typescript
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

const LABELS_ROW = [
  'Mandatory', 'Mandatory', 'Optional', 'Mandatory',
  'Optional - Will link to Taxation',
  'Mandatory - Default 18%',
  'Mandatory (Y/N)',
  'Mandatory',
  'Mandatory',
  'Optional',
  'Mandatory',
].join(',')

const HEADERS_ROW = [
  'Receipt Date',
  'Master Product',
  'Variant',
  'Qty.',
  'HSN Code',
  'GST Rate Slab',
  'Tax Paid (Y/N)',
  'Rate Per Unit (without Taxes)',
  'Vendor Name',
  'Invoice Number (Optional)',
  'Warehouse',
].join(',')

const EXAMPLE_ROW = [
  '27/06/2025',
  'Video Making Kit',
  '',
  '10',
  '',
  '18%',
  'Y',
  '200',
  'Rudra Enterprises',
  'RA/25-26/316',
  'GGN 1',
].join(',')

export async function GET() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()

    // Fetch existing master SKUs for reference
    const { data: skus } = await supabase
      .from('master_skus')
      .select('name, parent_id')
      .eq('tenant_id', tenantId)
      .order('name')

    // Fetch warehouses for reference
    const { data: warehouses } = await supabase
      .from('warehouses')
      .select('name')
      .eq('tenant_id', tenantId)
      .order('name')

    const lines: string[] = [LABELS_ROW, HEADERS_ROW, EXAMPLE_ROW, '']

    // Product reference section
    if (skus && skus.length > 0) {
      lines.push('# ── Existing Products (for reference — delete these rows before uploading) ──')
      // Show flat SKUs and parent names only
      const seen = new Set<string>()
      for (const s of skus) {
        if (!seen.has(s.name)) {
          seen.add(s.name)
          lines.push(`# ${s.name}`)
        }
      }
    }

    // Warehouse reference section
    if (warehouses && warehouses.length > 0) {
      lines.push('# ── Warehouses ──')
      for (const w of warehouses) {
        lines.push(`# ${w.name}`)
      }
    }

    const csv = lines.join('\r\n')
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="purchases-template.csv"',
      },
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

**Step 2: Verify TypeScript**
```bash
npx tsc --noEmit
```
Expected: PASS

**Step 3: Commit**
```bash
git add src/app/api/purchases/csv-template/route.ts
git commit -m "feat(purchases): add csv-template route with product/warehouse reference rows"
```

---

### Task 5: Server-Side Purchases Importer

**Files:**
- Create: `src/lib/importers/purchases-import-server.ts`

**Step 1: Create the file**

This is a server-only file (uses `@/lib/supabase/server`). Do NOT import it from any client component.

```typescript
/**
 * Server-only purchases importer.
 * Uses the server Supabase client — do NOT import from client components.
 */
import Papa from 'papaparse'
import { createClient } from '@/lib/supabase/server'

// ── Fixed column names (must match template exactly) ──────────────────────────

const COL_DATE      = 'Receipt Date'
const COL_MASTER    = 'Master Product'
const COL_VARIANT   = 'Variant'
const COL_QTY       = 'Qty.'
const COL_HSN       = 'HSN Code'
const COL_GST_RATE  = 'GST Rate Slab'
const COL_TAX_PAID  = 'Tax Paid (Y/N)'
const COL_RATE      = 'Rate Per Unit (without Taxes)'
const COL_VENDOR    = 'Vendor Name'
const COL_INVOICE   = 'Invoice Number (Optional)'
const COL_WAREHOUSE = 'Warehouse'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedPurchaseRow {
  rowIndex: number
  date: string
  master: string
  variant: string
  qty: number
  hsnCode: string
  gstRateSlab: string
  taxPaid: boolean
  ratePerUnit: number
  vendorName: string
  invoiceNumber: string
  warehouseName: string
  error?: string
}

export interface PurchaseImportResult {
  created: number
  skipped: number
  errors: Array<{ row: number; reason: string }>
}

// ── Parse (client-safe, pure) ─────────────────────────────────────────────────

export function parsePurchasesCsv(csvText: string): ParsedPurchaseRow[] {
  const { data } = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  })

  const rows: ParsedPurchaseRow[] = []

  for (let i = 0; i < data.length; i++) {
    const raw = data[i]
    const rowIndex = i + 2 // header row = 1

    // Skip comment/reference rows
    const firstVal = Object.values(raw)[0] ?? ''
    if (firstVal.startsWith('#') || firstVal.startsWith('Mandatory') || firstVal.startsWith('Optional')) continue

    const master       = raw[COL_MASTER]    ?? ''
    const variant      = raw[COL_VARIANT]   ?? ''
    const dateRaw      = raw[COL_DATE]      ?? ''
    const qtyRaw       = raw[COL_QTY]       ?? ''
    const hsnCode      = raw[COL_HSN]       ?? ''
    const gstRateSlab  = raw[COL_GST_RATE]  ?? '18%'
    const taxPaidRaw   = (raw[COL_TAX_PAID] ?? '').toUpperCase()
    const rateRaw      = raw[COL_RATE]      ?? ''
    const vendorName   = raw[COL_VENDOR]    ?? ''
    const invoiceNumber = raw[COL_INVOICE]  ?? ''
    const warehouseName = raw[COL_WAREHOUSE] ?? ''

    // Validate mandatory fields
    const missing: string[] = []
    if (!master)       missing.push(COL_MASTER)
    if (!dateRaw)      missing.push(COL_DATE)
    if (!qtyRaw)       missing.push(COL_QTY)
    if (!rateRaw)      missing.push(COL_RATE)
    if (!warehouseName) missing.push(COL_WAREHOUSE)

    if (missing.length > 0) {
      rows.push({
        rowIndex, date: dateRaw, master, variant,
        qty: 0, hsnCode, gstRateSlab, taxPaid: false,
        ratePerUnit: 0, vendorName, invoiceNumber, warehouseName,
        error: `Missing: ${missing.join(', ')}`,
      })
      continue
    }

    const qty = parseInt(qtyRaw, 10)
    if (isNaN(qty) || qty <= 0) {
      rows.push({
        rowIndex, date: dateRaw, master, variant,
        qty: 0, hsnCode, gstRateSlab, taxPaid: false,
        ratePerUnit: 0, vendorName, invoiceNumber, warehouseName,
        error: `Qty. must be a positive number, got "${qtyRaw}"`,
      })
      continue
    }

    const ratePerUnit = parseFloat(rateRaw)
    if (isNaN(ratePerUnit) || ratePerUnit < 0) {
      rows.push({
        rowIndex, date: dateRaw, master, variant,
        qty, hsnCode, gstRateSlab, taxPaid: false,
        ratePerUnit: 0, vendorName, invoiceNumber, warehouseName,
        error: `Rate Per Unit must be a number, got "${rateRaw}"`,
      })
      continue
    }

    // Parse date: supports DD/MM/YYYY and YYYY-MM-DD
    let date = dateRaw
    if (dateRaw.includes('/')) {
      const parts = dateRaw.split('/')
      if (parts.length === 3) {
        // Could be DD/MM/YYYY or MM/DD/YYYY — assume DD/MM/YYYY per Indian standard
        date = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`
      }
    }

    const taxPaid = taxPaidRaw === 'Y' || taxPaidRaw === 'YES'

    rows.push({
      rowIndex, date, master, variant, qty, hsnCode,
      gstRateSlab: gstRateSlab || '18%',
      taxPaid, ratePerUnit, vendorName, invoiceNumber, warehouseName,
    })
  }

  return rows
}

// ── Import (server-only) ──────────────────────────────────────────────────────

export async function importPurchasesCsv(
  csvText: string,
  tenantId: string
): Promise<PurchaseImportResult> {
  const supabase = await createClient()

  // Load warehouses lookup map: name_lowercase → id
  const { data: warehouses, error: warehousesErr } = await supabase
    .from('warehouses')
    .select('id, name')
    .eq('tenant_id', tenantId)

  if (warehousesErr) {
    return { created: 0, skipped: 0, errors: [{ row: 0, reason: `Failed to load warehouses: ${warehousesErr.message}` }] }
  }

  const warehouseMap = new Map<string, string>() // name_lc → id
  for (const w of warehouses ?? []) {
    warehouseMap.set(w.name.toLowerCase(), w.id)
  }

  const rows = parsePurchasesCsv(csvText)
  let created = 0
  let skipped = 0
  const errors: PurchaseImportResult['errors'] = []

  for (const row of rows) {
    if (row.error) {
      skipped++
      errors.push({ row: row.rowIndex, reason: row.error })
      continue
    }

    // Resolve warehouse
    const warehouseId = warehouseMap.get(row.warehouseName.toLowerCase())
    if (!warehouseId) {
      skipped++
      errors.push({ row: row.rowIndex, reason: `Warehouse '${row.warehouseName}' not found in Settings` })
      continue
    }

    // Resolve master_sku + variant (same logic as catalog importer)
    let masterSkuId: string

    if (row.variant) {
      // Has variant: find/create parent, then find/create variant
      const { data: existingParent } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', row.master)
        .is('parent_id', null)
        .maybeSingle()

      let parentId: string
      if (existingParent) {
        parentId = existingParent.id
      } else {
        const { data: newParent, error: parentErr } = await supabase
          .from('master_skus')
          .insert({ tenant_id: tenantId, name: row.master })
          .select('id')
          .single()
        if (parentErr || !newParent) {
          skipped++
          errors.push({ row: row.rowIndex, reason: `Failed to create product "${row.master}": ${parentErr?.message ?? 'unknown'}` })
          continue
        }
        parentId = newParent.id
      }

      const { data: existingVariant } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', row.variant)
        .eq('parent_id', parentId)
        .maybeSingle()

      if (existingVariant) {
        masterSkuId = existingVariant.id
      } else {
        const { data: newVariant, error: variantErr } = await supabase
          .from('master_skus')
          .insert({ tenant_id: tenantId, name: row.variant, parent_id: parentId })
          .select('id')
          .single()
        if (variantErr || !newVariant) {
          skipped++
          errors.push({ row: row.rowIndex, reason: `Failed to create variant "${row.variant}": ${variantErr?.message ?? 'unknown'}` })
          continue
        }
        masterSkuId = newVariant.id
      }
    } else {
      // Flat SKU
      const { data: existingMaster } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', row.master)
        .is('parent_id', null)
        .maybeSingle()

      if (existingMaster) {
        masterSkuId = existingMaster.id
      } else {
        const { data: newMaster, error: masterErr } = await supabase
          .from('master_skus')
          .insert({ tenant_id: tenantId, name: row.master })
          .select('id')
          .single()
        if (masterErr || !newMaster) {
          skipped++
          errors.push({ row: row.rowIndex, reason: `Failed to create product "${row.master}": ${masterErr?.message ?? 'unknown'}` })
          continue
        }
        masterSkuId = newMaster.id
      }
    }

    // Calculate total_cogs
    const total_cogs = row.ratePerUnit * row.qty // packaging/other = 0 on import

    // Insert purchase
    const { error: insertErr } = await supabase
      .from('purchases')
      .insert({
        tenant_id: tenantId,
        master_sku_id: masterSkuId,
        warehouse_id: warehouseId,
        quantity: row.qty,
        unit_purchase_price: row.ratePerUnit,
        packaging_cost: 0,
        other_cost: 0,
        total_cogs,
        supplier: row.vendorName || null,
        purchase_date: row.date,
        hsn_code: row.hsnCode || null,
        gst_rate_slab: row.gstRateSlab,
        tax_paid: row.taxPaid,
        invoice_number: row.invoiceNumber || null,
      })

    if (insertErr) {
      skipped++
      errors.push({ row: row.rowIndex, reason: `Insert failed: ${insertErr.message}` })
      continue
    }
    created++
  }

  return { created, skipped, errors }
}
```

**Step 2: Verify TypeScript**
```bash
npx tsc --noEmit
```
Expected: PASS

**Step 3: Commit**
```bash
git add src/lib/importers/purchases-import-server.ts
git commit -m "feat(purchases): server-side CSV importer — parse + import with master_sku auto-create"
```

---

### Task 6: Import CSV API Route

**Files:**
- Create: `src/app/api/purchases/import-csv/route.ts`

**Step 1: Create the file**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getTenantId } from '@/lib/db/tenant'
import { importPurchasesCsv } from '@/lib/importers/purchases-import-server'

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getTenantId()
    const body = await req.json()
    const { csv } = body as { csv: string }

    if (!csv || typeof csv !== 'string') {
      return NextResponse.json({ error: 'csv field is required' }, { status: 400 })
    }

    const result = await importPurchasesCsv(csv, tenantId)
    return NextResponse.json(result)
  } catch (e: unknown) {
    const msg = (e as Error).message
    if (msg === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[purchases/import-csv] error:', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
```

**Step 2: Verify TypeScript**
```bash
npx tsc --noEmit
```
Expected: PASS

**Step 3: Commit**
```bash
git add src/app/api/purchases/import-csv/route.ts
git commit -m "feat(purchases): add import-csv API route"
```

---

### Task 7: PurchasesImportDialog Component

**Files:**
- Create: `src/components/purchases/PurchasesImportDialog.tsx`

**Step 1: Create the file**

Same 4-state pattern as `src/components/catalog/CsvImportDialog.tsx`. Study that file for reference on react-dropzone usage, state machine, and preview table structure.

```typescript
'use client'
import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Upload, Download, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { parsePurchasesCsv, type ParsedPurchaseRow } from '@/lib/importers/purchases-import-server'
import type { PurchaseImportResult } from '@/lib/importers/purchases-import-server'

type State = 'idle' | 'preview' | 'importing' | 'results'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}

export function PurchasesImportDialog({ open, onOpenChange, onImported }: Props) {
  const [state, setState] = useState<State>('idle')
  const [csvText, setCsvText] = useState('')
  const [rows, setRows] = useState<ParsedPurchaseRow[]>([])
  const [result, setResult] = useState<PurchaseImportResult | null>(null)

  const validRows   = rows.filter(r => !r.error)
  const invalidRows = rows.filter(r => r.error)

  const reset = useCallback(() => {
    setState('idle')
    setCsvText('')
    setRows([])
    setResult(null)
  }, [])

  const onDrop = useCallback((files: File[]) => {
    const file = files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const parsed = parsePurchasesCsv(text)
      setCsvText(text)
      setRows(parsed)
      setState('preview')
    }
    reader.readAsText(file)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false,
    disabled: state !== 'idle',
  })

  async function handleDownloadTemplate() {
    const res = await fetch('/api/purchases/csv-template')
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'purchases-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImport() {
    if (validRows.length === 0) return
    setState('importing')
    try {
      const res = await fetch('/api/purchases/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText }),
      })
      const data: PurchaseImportResult = await res.json()
      setResult(data)
      setState('results')
      if (data.created > 0) onImported()
    } catch {
      setState('results')
      setResult({ created: 0, skipped: rows.length, errors: [{ row: 0, reason: 'Network error' }] })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o) }}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {state === 'idle'      ? 'Import Purchases'        : ''}
            {state === 'preview'   ? 'Preview Import'          : ''}
            {state === 'importing' ? 'Importing…'              : ''}
            {state === 'results'   ? 'Import Complete'         : ''}
          </DialogTitle>
        </DialogHeader>

        {/* ── IDLE ── */}
        {state === 'idle' && (
          <div className="space-y-4 flex-1">
            <Button variant="outline" className="w-full" onClick={handleDownloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors
                ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}`}
            >
              <input {...getInputProps()} />
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium">
                {isDragActive ? 'Drop your CSV here' : 'Drag & drop your CSV or click to browse'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Columns: Receipt Date, Master Product, Variant, Qty., HSN Code, GST Rate Slab, Tax Paid (Y/N), Rate Per Unit, Vendor Name, Invoice #, Warehouse</p>
            </div>
          </div>
        )}

        {/* ── PREVIEW ── */}
        {(state === 'preview' || state === 'importing') && (
          <div className="flex-1 flex flex-col min-h-0 space-y-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                {validRows.length} valid
              </span>
              {invalidRows.length > 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <XCircle className="h-4 w-4" />
                  {invalidRows.length} invalid (will be skipped)
                </span>
              )}
            </div>
            <ScrollArea className="flex-1 border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Rate/Unit</TableHead>
                    <TableHead>GST</TableHead>
                    <TableHead>Tax Paid</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.rowIndex} className={row.error ? 'bg-destructive/5' : ''}>
                      <TableCell className="text-xs text-muted-foreground">{row.rowIndex}</TableCell>
                      <TableCell className="text-sm">{row.date}</TableCell>
                      <TableCell className="text-sm font-medium">{row.master}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.variant || '—'}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums">{row.qty || '—'}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums">
                        {row.ratePerUnit ? `₹${row.ratePerUnit}` : '—'}
                      </TableCell>
                      <TableCell className="text-sm">{row.gstRateSlab}</TableCell>
                      <TableCell className="text-sm">{row.taxPaid ? 'Y' : 'N'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.vendorName || '—'}</TableCell>
                      <TableCell className="text-sm">{row.warehouseName}</TableCell>
                      <TableCell>
                        {row.error ? (
                          <span className="text-xs text-destructive">{row.error}</span>
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        )}

        {/* ── RESULTS ── */}
        {state === 'results' && result && (
          <div className="flex-1 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-green-50 p-4 text-center">
                <div className="text-2xl font-bold text-green-700">{result.created}</div>
                <div className="text-sm text-green-600 mt-1">created</div>
              </div>
              <div className="rounded-lg border bg-muted/50 p-4 text-center">
                <div className="text-2xl font-bold text-muted-foreground">{result.skipped}</div>
                <div className="text-sm text-muted-foreground mt-1">skipped</div>
              </div>
              <div className="rounded-lg border bg-muted/50 p-4 text-center">
                <div className="text-2xl font-bold text-muted-foreground">{result.errors.length}</div>
                <div className="text-sm text-muted-foreground mt-1">errors</div>
              </div>
            </div>
            {result.errors.length > 0 && (
              <ScrollArea className="h-40 border rounded-md p-3 space-y-1">
                {result.errors.map((e, i) => (
                  <div key={i} className="text-xs text-destructive flex gap-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span><span className="font-medium">Row {e.row}:</span> {e.reason}</span>
                  </div>
                ))}
              </ScrollArea>
            )}
          </div>
        )}

        <DialogFooter>
          {state === 'idle' && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          )}
          {state === 'preview' && (
            <>
              <Button variant="outline" onClick={reset}>Back</Button>
              <Button onClick={handleImport} disabled={validRows.length === 0}>
                Import {validRows.length} {validRows.length === 1 ? 'row' : 'rows'} →
              </Button>
            </>
          )}
          {state === 'importing' && (
            <Button disabled>Importing…</Button>
          )}
          {state === 'results' && (
            <>
              <Button variant="outline" onClick={reset}>Import Another</Button>
              <Button onClick={() => { onOpenChange(false); reset() }}>View Purchases</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 2: Verify TypeScript**
```bash
npx tsc --noEmit
```
Expected: PASS

**Step 3: Commit**
```bash
git add src/components/purchases/PurchasesImportDialog.tsx
git commit -m "feat(purchases): add PurchasesImportDialog — dropzone, preview, import, results"
```

---

### Task 8: Rewrite Purchases Page

**Files:**
- Modify: `src/app/(dashboard)/purchases/page.tsx`

**Step 1: Full rewrite**

This is the most complex task. Read the design doc for full spec.

Key implementation notes:
- All data loaded client-side then filtered/paginated client-side (same pattern as catalog page)
- `groupByMonth()` helper groups `pagedRows` by `purchase_date.slice(0,7)` → `"YYYY-MM"`
- `calcGST()` pure function for calculated columns
- `openMonths` Set<string> tracks which accordions are expanded
- Most recent month key auto-added to `openMonths` on data load
- Searchable Master Product: use `<Select>` with search — or `<Input>` with `<datalist>` for simplicity (full Combobox is complex; a filtered `<Select>` with max-height scroll is fine)
- Variant conditional: shown only if selected master SKU has `variants` (children in master_skus)

```typescript
'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { PurchasesImportDialog } from '@/components/purchases/PurchasesImportDialog'
import { toast } from 'sonner'
import { Plus, Upload, ChevronDown, ChevronRight, Pencil, Trash2, IndianRupee } from 'lucide-react'
import { format, parseISO } from 'date-fns'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MasterSku {
  id: string
  name: string
  parent_id: string | null
  variants?: MasterSku[]
}

interface Warehouse {
  id: string
  name: string
}

interface Purchase {
  id: string
  master_sku_id: string
  warehouse_id: string
  quantity: number
  unit_purchase_price: number
  packaging_cost: number
  other_cost: number
  total_cogs: number
  supplier: string | null
  purchase_date: string
  received_date: string | null
  hsn_code: string | null
  gst_rate_slab: string | null
  tax_paid: boolean
  invoice_number: string | null
  master_skus: { id: string; name: string; parent_id: string | null } | null
  warehouses: { id: string; name: string } | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE  = 50
const GST_SLABS  = ['0%', '5%', '12%', '18%', '28%']

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)
}

function calcGST(unitPrice: number, gstSlab: string | null, taxPaid: boolean, qty: number) {
  const rate      = parseFloat(gstSlab ?? '18') || 0
  const gstPerUnit  = unitPrice * rate / 100
  const unitIncl  = unitPrice + gstPerUnit
  const totalGst  = taxPaid ? 0 : gstPerUnit * qty
  const totalAmt  = unitIncl * qty
  return { gstPerUnit, unitIncl, totalGst, totalAmt }
}

function monthLabel(yearMonth: string) {
  // yearMonth = "2026-02"
  try { return format(parseISO(yearMonth + '-01'), 'MMMM yyyy') }
  catch { return yearMonth }
}

// ── Empty form ────────────────────────────────────────────────────────────────

const emptyForm = {
  master_sku_id: '',
  variant_sku_id: '',
  warehouse_id: '',
  quantity: '',
  unit_purchase_price: '',
  packaging_cost: '',
  other_cost: '',
  supplier: '',
  purchase_date: format(new Date(), 'yyyy-MM-dd'),
  received_date: '',
  hsn_code: '',
  gst_rate_slab: '18%',
  tax_paid: 'N' as 'Y' | 'N',
  invoice_number: '',
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PurchasesPage() {
  const [purchases, setPurchases]   = useState<Purchase[]>([])
  const [skus, setSkus]             = useState<MasterSku[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading]       = useState(true)

  // Filters
  const [search,          setSearch]          = useState('')
  const [filterWarehouse, setFilterWarehouse] = useState('')
  const [filterFrom,      setFilterFrom]      = useState('')
  const [filterTo,        setFilterTo]        = useState('')
  const [filterGst,       setFilterGst]       = useState('')
  const [filterTaxPaid,   setFilterTaxPaid]   = useState('')

  // Pagination
  const [page, setPage] = useState(1)

  // Accordion open state
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set())

  // Import dialog
  const [importOpen, setImportOpen] = useState(false)

  // Add/Edit dialog
  const [dialogOpen,  setDialogOpen]  = useState(false)
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [form,        setForm]        = useState(emptyForm)
  const [saving,      setSaving]      = useState(false)

  // ── Fetch data ───────────────────────────────────────────────────────────────

  const loadPurchases = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/purchases')
      if (!res.ok) throw new Error('Failed to fetch')
      setPurchases(await res.json())
    } catch {
      toast.error('Failed to load purchases')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPurchases() }, [loadPurchases])

  useEffect(() => {
    Promise.all([
      fetch('/api/catalog/master-skus').then(r => r.json()),
      fetch('/api/warehouses').then(r => r.json()),
    ]).then(([s, w]) => {
      setSkus(Array.isArray(s) ? s : [])
      setWarehouses(Array.isArray(w) ? w : [])
    }).catch(() => {})
  }, [])

  // Auto-open most recent month
  useEffect(() => {
    if (purchases.length > 0) {
      const firstKey = purchases[0]?.purchase_date?.slice(0, 7)
      if (firstKey) setOpenMonths(new Set([firstKey]))
    }
  }, [purchases])

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [search, filterWarehouse, filterFrom, filterTo, filterGst, filterTaxPaid])

  // ── Filtering ────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let data = purchases
    if (search) {
      const q = search.toLowerCase()
      data = data.filter(p =>
        p.master_skus?.name.toLowerCase().includes(q) ||
        (p.supplier ?? '').toLowerCase().includes(q)
      )
    }
    if (filterWarehouse) data = data.filter(p => p.warehouse_id === filterWarehouse)
    if (filterFrom)      data = data.filter(p => p.purchase_date >= filterFrom)
    if (filterTo)        data = data.filter(p => p.purchase_date <= filterTo)
    if (filterGst)       data = data.filter(p => p.gst_rate_slab === filterGst)
    if (filterTaxPaid === 'Y') data = data.filter(p => p.tax_paid)
    if (filterTaxPaid === 'N') data = data.filter(p => !p.tax_paid)
    return data
  }, [purchases, search, filterWarehouse, filterFrom, filterTo, filterGst, filterTaxPaid])

  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pagedRows   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const hasFilters  = !!(search || filterWarehouse || filterFrom || filterTo || filterGst || filterTaxPaid)

  // ── Group by month ────────────────────────────────────────────────────────────

  const monthGroups = useMemo(() => {
    const map = new Map<string, Purchase[]>()
    for (const p of pagedRows) {
      const key = p.purchase_date.slice(0, 7)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, rows]) => ({ key, label: monthLabel(key), rows }))
  }, [pagedRows])

  // ── Page totals ───────────────────────────────────────────────────────────────

  const pageTotals = useMemo(() => {
    let units = 0, gst = 0, amount = 0
    for (const p of pagedRows) {
      const { totalGst, totalAmt } = calcGST(p.unit_purchase_price, p.gst_rate_slab, p.tax_paid, p.quantity)
      units  += p.quantity
      gst    += totalGst
      amount += totalAmt
    }
    return { units, gst, amount }
  }, [pagedRows])

  // ── Month totals ──────────────────────────────────────────────────────────────

  function monthTotals(rows: Purchase[]) {
    let units = 0, gst = 0, amount = 0
    for (const p of rows) {
      const { totalGst, totalAmt } = calcGST(p.unit_purchase_price, p.gst_rate_slab, p.tax_paid, p.quantity)
      units += p.quantity
      gst   += totalGst
      amount += totalAmt
    }
    return { units, gst, amount }
  }

  // ── Dialog helpers ────────────────────────────────────────────────────────────

  // Flat list of all SKUs (parents + flat SKUs, no pure variants)
  const selectableSkus = useMemo(() => {
    return skus.filter(s => s.parent_id === null)
  }, [skus])

  // Variants of selected master SKU
  const selectedMasterSku = useMemo(() =>
    skus.find(s => s.id === form.master_sku_id), [skus, form.master_sku_id])

  const variantOptions = useMemo(() => {
    if (!selectedMasterSku) return []
    return skus.filter(s => s.parent_id === selectedMasterSku.id)
  }, [skus, selectedMasterSku])

  function setField<K extends keyof typeof emptyForm>(key: K, value: typeof emptyForm[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function openAdd() {
    setEditingId(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  function openEdit(p: Purchase) {
    setEditingId(p.id)
    setForm({
      master_sku_id:        p.master_sku_id,
      variant_sku_id:       '', // resolved below
      warehouse_id:         p.warehouse_id,
      quantity:             String(p.quantity),
      unit_purchase_price:  String(p.unit_purchase_price),
      packaging_cost:       String(p.packaging_cost),
      other_cost:           String(p.other_cost),
      supplier:             p.supplier ?? '',
      purchase_date:        p.purchase_date,
      received_date:        p.received_date ?? '',
      hsn_code:             p.hsn_code ?? '',
      gst_rate_slab:        p.gst_rate_slab ?? '18%',
      tax_paid:             p.tax_paid ? 'Y' : 'N',
      invoice_number:       p.invoice_number ?? '',
    })
    setDialogOpen(true)
  }

  // The effective master_sku_id to save: variant if selected, otherwise master
  function effectiveSkuId() {
    return form.variant_sku_id || form.master_sku_id
  }

  // Live preview
  const liveCalc = useMemo(() => {
    const rate = parseFloat(form.unit_purchase_price) || 0
    const qty  = parseInt(form.quantity) || 1
    return calcGST(rate, form.gst_rate_slab, form.tax_paid === 'Y', qty)
  }, [form.unit_purchase_price, form.quantity, form.gst_rate_slab, form.tax_paid])

  // ── Save ──────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.master_sku_id)            return toast.error('Please select a master product')
    if (!form.warehouse_id)             return toast.error('Please select a warehouse')
    if (!form.quantity || Number(form.quantity) <= 0) return toast.error('Quantity must be > 0')
    if (!form.purchase_date)            return toast.error('Receipt date is required')
    if (!form.unit_purchase_price)      return toast.error('Rate per unit is required')

    setSaving(true)
    try {
      const payload = {
        ...(editingId ? { id: editingId } : {}),
        master_sku_id:        effectiveSkuId(),
        warehouse_id:         form.warehouse_id,
        quantity:             Number(form.quantity),
        unit_purchase_price:  Number(form.unit_purchase_price) || 0,
        packaging_cost:       Number(form.packaging_cost) || 0,
        other_cost:           Number(form.other_cost) || 0,
        supplier:             form.supplier || null,
        purchase_date:        form.purchase_date,
        received_date:        form.received_date || null,
        hsn_code:             form.hsn_code || null,
        gst_rate_slab:        form.gst_rate_slab,
        tax_paid:             form.tax_paid === 'Y',
        invoice_number:       form.invoice_number || null,
      }
      const res = await fetch('/api/purchases', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const { error } = await res.json()
        toast.error(error ?? 'Failed to save')
        return
      }
      toast.success(editingId ? 'Purchase updated' : 'Purchase added')
      setDialogOpen(false)
      loadPurchases()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this purchase record?')) return
    const res = await fetch('/api/purchases', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) { toast.success('Purchase deleted'); loadPurchases() }
    else toast.error('Failed to delete')
  }

  function toggleMonth(key: string) {
    setOpenMonths(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function clearFilters() {
    setSearch(''); setFilterWarehouse(''); setFilterFrom(''); setFilterTo('')
    setFilterGst(''); setFilterTaxPaid('')
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Purchases</h2>
          <p className="text-sm text-muted-foreground mt-1">Track procurement and cost of goods</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Bulk Import
          </Button>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-2" />
            Add Purchase
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <Input
            className="w-48"
            placeholder="Product or vendor…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Warehouse</Label>
          <Select value={filterWarehouse || '__all__'} onValueChange={v => setFilterWarehouse(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All warehouses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All warehouses</SelectItem>
              {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" className="w-36" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" className="w-36" value={filterTo} onChange={e => setFilterTo(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">GST Rate</Label>
          <Select value={filterGst || '__all__'} onValueChange={v => setFilterGst(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All rates</SelectItem>
              {GST_SLABS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Tax Paid</Label>
          <Select value={filterTaxPaid || '__all__'} onValueChange={v => setFilterTaxPaid(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All</SelectItem>
              <SelectItem value="Y">Paid</SelectItem>
              <SelectItem value="N">Unpaid</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
        )}
      </div>

      {/* Month accordions */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border py-16 text-center text-muted-foreground text-sm">
          {hasFilters ? 'No purchases match your filters.' : 'No purchases yet. Add your first purchase above.'}
        </div>
      ) : (
        <div className="space-y-3">
          {monthGroups.map(({ key, label, rows }) => {
            const isOpen = openMonths.has(key)
            const totals = monthTotals(rows)
            return (
              <div key={key} className="rounded-lg border overflow-hidden">
                {/* Accordion header */}
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => toggleMonth(key)}
                >
                  {isOpen
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  }
                  <span className="font-semibold text-sm">{label}</span>
                  <span className="text-muted-foreground text-sm ml-1">— {rows.length} record{rows.length !== 1 ? 's' : ''}</span>
                  <div className="ml-auto flex items-center gap-4 text-sm text-muted-foreground">
                    <span>₹{fmt(totals.amount)} total</span>
                    {totals.gst > 0 && <span>₹{fmt(totals.gst)} GST</span>}
                  </div>
                </button>

                {/* Accordion body */}
                {isOpen && (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Master Product</TableHead>
                          <TableHead>Variant</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead>HSN</TableHead>
                          <TableHead>GST Rate</TableHead>
                          <TableHead>Tax Paid</TableHead>
                          <TableHead className="text-right">Rate/Unit (ex)</TableHead>
                          <TableHead className="text-right">GST/Unit</TableHead>
                          <TableHead className="text-right">Unit Price (incl.)</TableHead>
                          <TableHead className="text-right">Total GST</TableHead>
                          <TableHead className="text-right font-semibold">Total Amount</TableHead>
                          <TableHead>Vendor</TableHead>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Warehouse</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map(p => {
                          const { gstPerUnit, unitIncl, totalGst, totalAmt } = calcGST(
                            p.unit_purchase_price, p.gst_rate_slab, p.tax_paid, p.quantity
                          )
                          // Determine product/variant display
                          const skuName = p.master_skus?.name ?? '—'
                          const parentId = p.master_skus?.parent_id
                          const parentName = parentId
                            ? (skus.find(s => s.id === parentId)?.name ?? null)
                            : null

                          return (
                            <TableRow key={p.id}>
                              <TableCell className="text-sm tabular-nums whitespace-nowrap">
                                {p.purchase_date}
                              </TableCell>
                              <TableCell className="font-medium text-sm">
                                {parentName ?? skuName}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {parentName ? skuName : '—'}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{p.quantity}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {p.hsn_code ?? '—'}
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary" className="text-xs">
                                  {p.gst_rate_slab ?? '18%'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm">
                                {p.tax_paid
                                  ? <span className="text-green-600 font-medium">✓ Paid</span>
                                  : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm">
                                ₹{fmt(p.unit_purchase_price)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                                ₹{fmt(gstPerUnit)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm">
                                ₹{fmt(unitIncl)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                                {totalGst === 0 ? '—' : `₹${fmt(totalGst)}`}
                              </TableCell>
                              <TableCell className="text-right tabular-nums font-semibold">
                                ₹{fmt(totalAmt)}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {p.supplier ?? '—'}
                              </TableCell>
                              <TableCell className="text-sm font-mono text-muted-foreground">
                                {p.invoice_number ?? '—'}
                              </TableCell>
                              <TableCell className="text-sm">
                                {p.warehouses?.name ?? '—'}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost" size="sm"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => handleDelete(p.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination + totals */}
      {!loading && filtered.length > 0 && (
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-4 text-muted-foreground">
            <span>
              Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <Separator orientation="vertical" className="h-4" />
            <span>Units: <span className="font-semibold text-foreground">{fmt(pageTotals.units)}</span></span>
            {pageTotals.gst > 0 && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <span>GST: <span className="font-semibold text-foreground">₹{fmt(pageTotals.gst)}</span></span>
              </>
            )}
            <Separator orientation="vertical" className="h-4" />
            <span className="flex items-center gap-1">
              <IndianRupee className="h-3 w-3" />
              Total: <span className="font-semibold text-foreground ml-1">₹{fmt(pageTotals.amount)}</span>
            </span>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                ← Prev
              </Button>
              <span className="text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                Next →
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Purchase' : 'Add Purchase'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Master Product */}
            <div className="space-y-1">
              <Label>Master Product <span className="text-destructive">*</span></Label>
              <Select
                value={form.master_sku_id}
                onValueChange={v => { setField('master_sku_id', v); setField('variant_sku_id', '') }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select product…" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {selectableSkus.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Variant (conditional) */}
            {variantOptions.length > 0 && (
              <div className="space-y-1">
                <Label>Variant</Label>
                <Select
                  value={form.variant_sku_id || '__none__'}
                  onValueChange={v => setField('variant_sku_id', v === '__none__' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select variant…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No variant (use parent)</SelectItem>
                    {variantOptions.map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Warehouse + Qty */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Warehouse <span className="text-destructive">*</span></Label>
                <Select value={form.warehouse_id} onValueChange={v => setField('warehouse_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Quantity <span className="text-destructive">*</span></Label>
                <Input type="number" min={1} placeholder="0"
                  value={form.quantity} onChange={e => setField('quantity', e.target.value)} />
              </div>
            </div>

            {/* Rate + GST */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Rate Per Unit (ex-tax) <span className="text-destructive">*</span></Label>
                <Input type="number" min={0} step="0.01" placeholder="0.00"
                  value={form.unit_purchase_price}
                  onChange={e => setField('unit_purchase_price', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">GST Rate Slab</Label>
                <Select value={form.gst_rate_slab} onValueChange={v => setField('gst_rate_slab', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GST_SLABS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Tax Paid */}
            <div className="space-y-1">
              <Label className="text-xs">Tax Paid</Label>
              <Select value={form.tax_paid} onValueChange={v => setField('tax_paid', v as 'Y' | 'N')}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Y">Yes — already paid</SelectItem>
                  <SelectItem value="N">No — liability pending</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Live GST preview */}
            {form.unit_purchase_price && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1">
                <span>GST/unit: <span className="font-medium text-foreground">₹{fmt(liveCalc.gstPerUnit)}</span></span>
                <span>Unit price (incl.): <span className="font-medium text-foreground">₹{fmt(liveCalc.unitIncl)}</span></span>
                <span>Total GST: <span className="font-medium text-foreground">{liveCalc.totalGst === 0 ? '—' : `₹${fmt(liveCalc.totalGst)}`}</span></span>
                <span>Total amount: <span className="font-semibold text-foreground">₹{fmt(liveCalc.totalAmt)}</span></span>
              </div>
            )}

            {/* Packaging + Other */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Packaging Cost (₹)</Label>
                <Input type="number" min={0} step="0.01" placeholder="0.00"
                  value={form.packaging_cost}
                  onChange={e => setField('packaging_cost', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Other Cost (₹)</Label>
                <Input type="number" min={0} step="0.01" placeholder="0.00"
                  value={form.other_cost}
                  onChange={e => setField('other_cost', e.target.value)} />
              </div>
            </div>

            {/* HSN + Invoice */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">HSN Code</Label>
                <Input placeholder="e.g. 8523" value={form.hsn_code}
                  onChange={e => setField('hsn_code', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Invoice Number</Label>
                <Input placeholder="e.g. INV-001" value={form.invoice_number}
                  onChange={e => setField('invoice_number', e.target.value)} />
              </div>
            </div>

            {/* Vendor + Dates */}
            <div className="space-y-1">
              <Label className="text-xs">Vendor Name</Label>
              <Input placeholder="e.g. Rudra Enterprises" value={form.supplier}
                onChange={e => setField('supplier', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Receipt Date <span className="text-destructive">*</span></Label>
                <Input type="date" value={form.purchase_date}
                  onChange={e => setField('purchase_date', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Received Date</Label>
                <Input type="date" value={form.received_date}
                  onChange={e => setField('received_date', e.target.value)} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Purchase'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <PurchasesImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={loadPurchases}
      />
    </div>
  )
}
```

**Step 2: Verify TypeScript**
```bash
npx tsc --noEmit
```
Expected: PASS

**Step 3: Run build**
```bash
npm run build
```
Expected: ✓ Compiled successfully

**Step 4: Commit**
```bash
git add "src/app/(dashboard)/purchases/page.tsx"
git commit -m "feat(purchases): full page rewrite — GST columns, month accordions, pagination, bulk import"
```

---

### Task 9: Deploy

**Step 1: Push and deploy**
```bash
git push origin main
ssh root@46.225.117.86 "cd /opt/fk-tool && bash deploy.sh"
```

**Step 2: Verify live**

Visit https://ecommerceforall.in/catalog — check purchases page loads, month accordion opens/closes, all columns show, Bulk Import button opens dialog.
